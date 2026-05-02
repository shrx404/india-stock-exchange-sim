from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import asyncio
import json

from core.order import Order, Side, OrderType
from core.matcher import Matcher
from simulation.agents import MarketMakerBot, RetailBot, AgentConfig, MomentumBot, MeanReversionBot, EnvironmentBot
from db.session import init_db, get_session
from db.models import OrderRecord, TradeRecord

from core.trade_store import TradeStore
from core.analytics import Analytics
from core.candle_aggregator import CandleAggregator
from simulation.price_feed import load_base_prices_from_db


# ------------------------------------------------------------------
# State
# ------------------------------------------------------------------
trade_store: TradeStore = TradeStore()
analytics:   Analytics  = Analytics(trade_store)
matcher:     Matcher    = Matcher(trade_store)
candle_aggregator       = CandleAggregator()

# ------------------------------------------------------------------
# Connection Manager — per-scrip topic routing + 100ms batch buffer
# ------------------------------------------------------------------
class ConnectionManager:
    """
    Maintains a registry of connected WebSocket clients.

    Each client can subscribe to exactly ONE scrip's high-frequency
    depth/candle feed. The market-watch LTP heartbeat is sent to ALL
    clients, but only when a scrip's LTP actually changes (diff-only).

    Batching: events are queued into a per-client deque and flushed
    every BATCH_INTERVAL_MS as a single JSON array, dramatically
    reducing the number of WS frames.
    """

    BATCH_INTERVAL_MS = 100  # flush window (milliseconds)

    def __init__(self) -> None:
        # ws -> scrip (the scrip this client is currently watching)
        self._subscriptions: dict[WebSocket, str] = {}
        # ws -> list of pending outgoing messages
        self._queues: dict[WebSocket, list] = {}
        # last LTP we sent for each scrip (diff gate)
        self._last_ltp: dict[str, float | None] = {}

    # ---------------------------------------------------------------- connection lifecycle
    def connect(self, ws: WebSocket, initial_scrip: str = "") -> None:
        self._subscriptions[ws] = initial_scrip.upper()
        self._queues[ws] = []

    def disconnect(self, ws: WebSocket) -> None:
        self._subscriptions.pop(ws, None)
        self._queues.pop(ws, None)

    def set_subscription(self, ws: WebSocket, scrip: str) -> None:
        self._subscriptions[ws] = scrip.upper()

    @property
    def connections(self) -> list[WebSocket]:
        return list(self._subscriptions.keys())

    # ---------------------------------------------------------------- enqueue helpers
    def _enqueue_for_scrip(self, scrip: str, msg: dict) -> None:
        """Enqueue msg only to clients subscribed to `scrip`."""
        for ws, sub in self._subscriptions.items():
            if sub == scrip.upper():
                self._queues[ws].append(msg)

    def _enqueue_all(self, msg: dict) -> None:
        """Enqueue msg to every connected client."""
        for q in self._queues.values():
            q.append(msg)

    # ---------------------------------------------------------------- public event methods
    def enqueue_depth(self, scrip: str, depth: dict) -> None:
        """Depth update — only routed to clients watching `scrip`."""
        self._enqueue_for_scrip(scrip, {**depth, "event": "depth"})

    def enqueue_trade(self, scrip: str, trade: dict) -> None:
        """Trade event — routed to clients watching `scrip` PLUS always
        queued globally so the Trade Log (which shows all scrips) stays live."""
        self._enqueue_all(trade)

    def enqueue_candle(self, scrip: str, candle: dict) -> None:
        """Candle update — only routed to clients watching `scrip`."""
        self._enqueue_for_scrip(scrip, candle)

    def enqueue_vwap(self, scrip: str, vwap: dict) -> None:
        """VWAP update — only to the watching client."""
        self._enqueue_for_scrip(scrip, vwap)

    def enqueue_ltp_if_changed(self, scrip: str, ltp_msg: dict) -> None:
        """
        Market-watch heartbeat. Compares the new LTP against the last
        broadcast value; skips the enqueue if nothing changed (diff-only).
        Sent to ALL clients (market watch shows every scrip to everyone).
        """
        new_ltp = ltp_msg.get("ltp")
        if new_ltp == self._last_ltp.get(scrip, object()):
            return  # no change — skip broadcast
        self._last_ltp[scrip] = new_ltp
        self._enqueue_all(ltp_msg)

    def enqueue_circuit(self, msg: dict) -> None:
        """Circuit-breaker status — global."""
        self._enqueue_all(msg)

    # ---------------------------------------------------------------- flush loop
    async def flush_loop(self) -> None:
        """Background task: every BATCH_INTERVAL_MS, drain all queues
        and send each client a single JSON array containing all pending
        events. Zero-copy: swap the list rather than popping item-by-item."""
        interval = self.BATCH_INTERVAL_MS / 1_000
        while True:
            await asyncio.sleep(interval)
            dead: list[WebSocket] = []
            for ws, q in list(self._queues.items()):
                if not q:
                    continue
                # Swap queue atomically
                batch, self._queues[ws] = q, []
                try:
                    await ws.send_text(json.dumps(batch, default=str))
                except Exception:
                    dead.append(ws)
            for ws in dead:
                self.disconnect(ws)


manager = ConnectionManager()

# ------------------------------------------------------------------ Legacy shim
# `broadcast` is kept so existing code (candle_aggregator, agents) that
# calls it still works without changes. It routes through the manager.
async def broadcast(data: dict) -> None:
    event = data.get("event", "")
    scrip = data.get("scrip", "")

    if event == "depth":
        manager.enqueue_depth(scrip, data)
    elif event == "trade":
        manager.enqueue_trade(scrip, data)
    elif event == "candle":
        manager.enqueue_candle(scrip, data)
    elif event == "vwap":
        manager.enqueue_vwap(scrip, data)
    elif event == "circuit":
        manager.enqueue_circuit(data)
    else:
        # Unknown event type — fan-out to everyone
        manager._enqueue_all(data)


# Wire broadcast to aggregator
candle_aggregator._broadcast_fn = broadcast


async def record_market_depth_task(interval: float = 30.0) -> None:
    """Periodically snapshots top 5 levels of the order book to DB."""
    await asyncio.sleep(5.0)  # Wait for startup
    while True:
        try:
            snapshots = []
            for scrip in matcher.active_scrips:
                depth = matcher.get_depth(scrip, levels=8)
                if depth["bids"] or depth["asks"]:
                    snapshots.append({
                        "scrip": scrip,
                        "bids":  depth["bids"],
                        "asks":  depth["asks"],
                    })
            if snapshots:
                from db.models import MarketDepthSnapshotRecord
                async with get_session() as session:
                    for s in snapshots:
                        session.add(MarketDepthSnapshotRecord(
                            scrip=s["scrip"],
                            bids=s["bids"],
                            asks=s["asks"],
                        ))
                    await session.commit()
        except Exception as e:
            print(f"[DepthRecorder] Error saving snapshot: {e}")

        await asyncio.sleep(interval)


async def ltp_heartbeat_task(interval: float = 0.5) -> None:
    """
    Diff-only LTP broadcast for the market-watch panel.
    Runs every 500 ms; for each scrip checks whether LTP has changed
    since the last broadcast — if not, the event is silently dropped
    by `enqueue_ltp_if_changed`.
    """
    from core.scrip_metadata import SCRIP_METADATA
    await asyncio.sleep(2.0)  # Wait for engine to warm up
    while True:
        for scrip in SCRIP_METADATA.keys():
            depth = matcher.get_depth(scrip)
            ltp   = depth.get("ltp")
            seed  = depth.get("prev_close", 0)
            change    = round(ltp - seed, 2)       if ltp is not None and seed > 0 else 0
            change_pct = round((ltp - seed) / seed * 100, 2) if ltp is not None and seed > 0 else 0.0

            manager.enqueue_ltp_if_changed(scrip, {
                "event":         "ltp_update",
                "scrip":         scrip,
                "ltp":           ltp,
                "change":        change,
                "changePct":     change_pct,
                "session_state": depth.get("session_state", "OPEN"),
            })
        await asyncio.sleep(interval)


# ------------------------------------------------------------------
# Lifespan — startup / shutdown
# ------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await init_db()
        print("[DB] tables ready")
        await load_base_prices_from_db()
    except Exception as e:
        print(f"[DB] skipped (no DB?): {e}")

    mm_config = AgentConfig(capital=10_000_000.0, aggression=0.5, reaction_delay=0.0)
    mm = MarketMakerBot(agent_id="bot_mm_01", matcher=matcher, broadcast_fn=broadcast, config=mm_config, interval=4.0)

    retail_config = AgentConfig(capital=100_000.0, aggression=0.8, reaction_delay=0.5)
    retail = RetailBot(agent_id="bot_retail_01", matcher=matcher, broadcast_fn=broadcast, config=retail_config, interval=2.5)

    momentum_config = AgentConfig(capital=500_000.0, aggression=0.7, reaction_delay=0.2)
    momentum = MomentumBot(agent_id="bot_momentum_01", matcher=matcher, broadcast_fn=broadcast, config=momentum_config, trade_store=trade_store, interval=2.0)

    reversion_config = AgentConfig(capital=2_000_000.0, aggression=0.6, reaction_delay=0.3)
    reversion = MeanReversionBot(agent_id="bot_reversion_01", matcher=matcher, broadcast_fn=broadcast, config=reversion_config, analytics=analytics, interval=3.0)

    env_config = AgentConfig(capital=100_000_000.0, aggression=1.0)
    env_bot = EnvironmentBot(agent_id="bot_environment", matcher=matcher, broadcast_fn=broadcast, config=env_config, interval=5.0)

    tasks = [
        asyncio.create_task(mm.run(),                        name="market_maker"),
        asyncio.create_task(retail.run(),                    name="retail_bot"),
        asyncio.create_task(momentum.run(),                  name="momentum_bot"),
        asyncio.create_task(reversion.run(),                 name="reversion_bot"),
        asyncio.create_task(env_bot.run(),                   name="env_bot"),
        asyncio.create_task(candle_aggregator.run(interval=10), name="candle_aggregator"),
        asyncio.create_task(record_market_depth_task(30.0),  name="depth_recorder"),
        asyncio.create_task(manager.flush_loop(),            name="ws_batch_flusher"),
        asyncio.create_task(ltp_heartbeat_task(0.5),         name="ltp_heartbeat"),
    ]
    print("[Bots] all bots started | WS batch flusher @ 100ms | LTP heartbeat @ 500ms")

    yield  # ← app is running

    for t in tasks:
        t.cancel()


# ------------------------------------------------------------------
# App
# ------------------------------------------------------------------
app = FastAPI(title="India Exchange Sim", version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------
# Schemas
# ------------------------------------------------------------------
class PlaceOrderRequest(BaseModel):
    scrip:      str
    side:       str        # BUY | SELL
    order_type: str        # MARKET | LIMIT
    quantity:   int
    price:      float = 0.0
    trader_id:  str


class CancelOrderRequest(BaseModel):
    scrip:    str
    order_id: str


class SessionStateRequest(BaseModel):
    state: str


# ------------------------------------------------------------------
# REST routes
# ------------------------------------------------------------------
@app.get("/")
def root():
    return {"status": "exchange running", "version": "0.3.0"}


@app.post("/orders")
async def place_order(req: PlaceOrderRequest):
    try:
        order = Order(
            scrip      = req.scrip.upper(),
            side       = Side(req.side.upper()),
            order_type = OrderType(req.order_type.upper()),
            quantity   = req.quantity,
            price      = req.price,
            trader_id  = req.trader_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        trades = matcher.place_order(order)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Persist to DB (best-effort)
    try:
        async with get_session() as session:
            session.add(OrderRecord(
                order_id   = order.order_id,
                scrip      = order.scrip,
                trader_id  = order.trader_id,
                side       = order.side.value,
                order_type = order.order_type.value,
                quantity   = order.quantity,
                price      = order.price,
                filled_qty = order.filled_qty,
                status     = order.status.value,
            ))
            for t in trades:
                session.add(TradeRecord(
                    trade_id   = t.trade_id,
                    scrip      = t.scrip,
                    buy_order  = t.buy_order,
                    sell_order = t.sell_order,
                    price      = t.price,
                    quantity   = t.quantity,
                ))
                await candle_aggregator.update_candle(t.scrip, t.price, t.quantity)
    except Exception as db_err:
        print(f"[DB write skip] {db_err}")

    # Enqueue batched WS events
    depth = matcher.get_depth(req.scrip.upper())
    manager.enqueue_depth(req.scrip.upper(), {**depth, "event": "depth"})

    for t in trades:
        manager.enqueue_trade(t.scrip, {
            "event"    : "trade",
            "scrip"    : t.scrip,
            "price"    : t.price,
            "quantity" : t.quantity,
            "buyer_id" : t.buyer_id,
            "seller_id": t.seller_id,
            "trade_id" : t.trade_id,
        })
        await candle_aggregator.update_candle(t.scrip, t.price, t.quantity)
        vwap = analytics.get_vwap(t.scrip)
        if vwap is not None:
            manager.enqueue_vwap(t.scrip, {
                "event": "vwap",
                "scrip": t.scrip,
                "vwap":  round(vwap, 2),
            })

    return {
        "order_id": order.order_id,
        "status"  : order.status.value,
        "trades"  : [
            {
                "trade_id" : t.trade_id,
                "price"    : t.price,
                "quantity" : t.quantity,
                "buyer_id" : t.buyer_id,
                "seller_id": t.seller_id,
            }
            for t in trades
        ],
    }


@app.delete("/orders")
def cancel_order(req: CancelOrderRequest):
    success = matcher.cancel_order(req.scrip.upper(), req.order_id)
    if not success:
        raise HTTPException(status_code=404, detail="Order not found or already done")
    return {"cancelled": req.order_id}


@app.get("/scrips")
def get_scrips():
    from core.scrip_metadata import SCRIP_METADATA
    return SCRIP_METADATA


@app.get("/depth/{scrip}")
def get_depth(scrip: str, levels: int = 8):
    return matcher.get_depth(scrip.upper(), levels)


@app.get("/ltp/{scrip}")
def get_ltp(scrip: str):
    return {"scrip": scrip.upper(), "ltp": matcher.get_ltp(scrip.upper())}


@app.get("/vwap/{scrip}")
def get_vwap(scrip: str):
    return {"scrip": scrip.upper(), "vwap": analytics.get_vwap(scrip.upper())}


@app.get("/market-watch")
def market_watch():
    """LTP for all active scrips (REST — used for initial hydration only)."""
    from core.scrip_metadata import SCRIP_METADATA
    result = []
    for scrip in SCRIP_METADATA.keys():
        depth = matcher.get_depth(scrip)
        ltp   = depth.get("ltp")
        seed  = depth.get("prev_close", 0)

        change    = round(ltp - seed, 2)            if ltp is not None and seed > 0 else 0
        pct       = round((ltp - seed) / seed * 100, 2) if ltp is not None and seed > 0 else 0.0

        result.append({
            "scrip"        : scrip,
            "ltp"          : ltp,
            "seed"         : seed,
            "change"       : change,
            "changePct"    : pct,
            "session_state": depth.get("session_state", "OPEN"),
        })
    return result


@app.post("/admin/session/{scrip}")
async def set_session_state(scrip: str, req: SessionStateRequest):
    state = req.state.upper()
    if state == "PRE_OPEN":
        matcher.set_pre_open(scrip.upper())
    elif state == "HALTED":
        matcher.halt_market(scrip.upper())
    elif state == "OPEN":
        trades = matcher.open_market(scrip.upper())
        try:
            async with get_session() as session:
                for t in trades:
                    session.add(TradeRecord(
                        trade_id   = t.trade_id,
                        scrip      = t.scrip,
                        buy_order  = t.buy_order,
                        sell_order = t.sell_order,
                        price      = t.price,
                        quantity   = t.quantity,
                    ))
                    await candle_aggregator.update_candle(t.scrip, t.price, t.quantity)
        except Exception as e:
            print(f"[DB] Call auction trades persist error: {e}")

        depth = matcher.get_depth(scrip.upper())
        manager.enqueue_depth(scrip.upper(), {**depth, "event": "depth"})
        for t in trades:
            manager.enqueue_trade(t.scrip, {
                "event"    : "trade",
                "scrip"    : t.scrip,
                "price"    : t.price,
                "quantity" : t.quantity,
                "buyer_id" : t.buyer_id,
                "seller_id": t.seller_id,
                "trade_id" : t.trade_id,
            })
            vwap = analytics.get_vwap(t.scrip)
            if vwap is not None:
                manager.enqueue_vwap(t.scrip, {
                    "event": "vwap",
                    "scrip": t.scrip,
                    "vwap":  round(vwap, 2),
                })
        return {"status": "OPEN", "trades_executed": len(trades)}
    else:
        raise HTTPException(status_code=400, detail="Invalid state")

    depth = matcher.get_depth(scrip.upper())
    manager.enqueue_depth(scrip.upper(), {**depth, "event": "depth"})
    return {"status": state}


@app.get("/candles/{scrip}")
def get_candles(scrip: str):
    """Return sorted 1-min OHLCV candles for a scrip (in-memory)."""
    return candle_aggregator.get_candles(scrip)


@app.get("/trades/{scrip}")
async def get_trades(scrip: str, limit: int = 50):
    """Return last N trades from the DB for a scrip."""
    try:
        from sqlalchemy import select, desc
        async with get_session() as session:
            rows = (await session.execute(
                select(TradeRecord)
                .where(TradeRecord.scrip == scrip.upper())
                .order_by(desc(TradeRecord.traded_at))
                .limit(limit)
            )).scalars().all()
            return [
                {
                    "trade_id" : r.trade_id,
                    "scrip"    : r.scrip,
                    "price"    : float(r.price),
                    "quantity" : r.quantity,
                    "traded_at": str(r.traded_at),
                }
                for r in rows
            ]
    except Exception as e:
        return {"error": str(e), "trades": []}


# ------------------------------------------------------------------
# WebSocket — per-scrip subscriptions, 100ms batch flusher
# ------------------------------------------------------------------
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    manager.connect(websocket, initial_scrip="")

    # Send full market-watch snapshot on connect (REST data via WS)
    from core.scrip_metadata import SCRIP_METADATA
    init_batch = []
    for scrip in SCRIP_METADATA.keys():
        depth = matcher.get_depth(scrip)
        ltp   = depth.get("ltp")
        seed  = depth.get("prev_close", 0)
        change    = round(ltp - seed, 2)            if ltp is not None and seed > 0 else 0
        change_pct = round((ltp - seed) / seed * 100, 2) if ltp is not None and seed > 0 else 0.0
        init_batch.append({
            "event"        : "ltp_update",
            "scrip"        : scrip,
            "ltp"          : ltp,
            "change"       : change,
            "changePct"    : change_pct,
            "session_state": depth.get("session_state", "OPEN"),
        })
    try:
        await websocket.send_text(json.dumps(init_batch, default=str))
    except Exception:
        manager.disconnect(websocket)
        return

    try:
        while True:
            raw = await websocket.receive_text()
            # Client can send: {"action": "subscribe", "scrip": "RELIANCE"}
            try:
                msg = json.loads(raw)
                if msg.get("action") == "subscribe" and msg.get("scrip"):
                    scrip = msg["scrip"].upper()
                    manager.set_subscription(websocket, scrip)
                    # Immediately push current depth for the newly subscribed scrip
                    depth = matcher.get_depth(scrip)
                    manager.enqueue_depth(scrip, {**depth, "event": "depth"})
            except Exception:
                pass  # malformed client message — ignore
    except WebSocketDisconnect:
        manager.disconnect(websocket)