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

# ------------------------------------------------------------------
# State
# ------------------------------------------------------------------
trade_store: TradeStore = TradeStore()
analytics: Analytics = Analytics(trade_store)
matcher: Matcher = Matcher(trade_store)
clients: list[WebSocket] = []

# In-memory candle accumulator per scrip (for chart endpoint)
# Structure: { scrip: { candle_time_str: {open,high,low,close,volume} } }
_candles: dict[str, dict] = {}


# ------------------------------------------------------------------
# Broadcast helper
# ------------------------------------------------------------------
async def broadcast(data: dict):
    dead: list[WebSocket] = []
    msg = json.dumps(data, default=str)
    for ws in clients:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.remove(ws)


def _update_candle(scrip: str, price: float, qty: int):
    """Accumulate 1-minute OHLCV candles in memory."""
    import datetime
    now  = datetime.datetime.utcnow()
    key  = now.strftime("%Y-%m-%dT%H:%M:00")
    book = _candles.setdefault(scrip, {})
    if key not in book:
        book[key] = {"time": key, "open": price, "high": price, "low": price, "close": price, "volume": 0}
    c = book[key]
    c["high"]   = max(c["high"],  price)
    c["low"]    = min(c["low"],   price)
    c["close"]  = price
    c["volume"] += qty


# ------------------------------------------------------------------
# Lifespan — startup / shutdown
# ------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Init DB (creates tables if they don't exist yet)
    try:
        await init_db()
        print("[DB] tables ready")
    except Exception as e:
        print(f"[DB] skipped (no DB?): {e}")

    # 2. Start simulation bots
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
        asyncio.create_task(mm.run(), name="market_maker"),
        asyncio.create_task(retail.run(), name="retail_bot"),
        asyncio.create_task(momentum.run(), name="momentum_bot"),
        asyncio.create_task(reversion.run(), name="reversion_bot"),
        asyncio.create_task(env_bot.run(), name="env_bot"),
    ]
    print("[Bots] market maker + retail + momentum + reversion + environment bots started")

    yield  # ← app is running

    for t in tasks:
        t.cancel()


# ------------------------------------------------------------------
# App
# ------------------------------------------------------------------
app = FastAPI(title="India Exchange Sim", version="0.2.0", lifespan=lifespan)

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


# ------------------------------------------------------------------
# REST routes
# ------------------------------------------------------------------
@app.get("/")
def root():
    return {"status": "exchange running", "version": "0.2.0"}


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

    trades = matcher.place_order(order)

    # Persist to DB (best-effort; skip if DB not available)
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
                _update_candle(t.scrip, t.price, t.quantity)
    except Exception as db_err:
        print(f"[DB write skip] {db_err}")

    # Broadcast updated depth + trade events
    depth = matcher.get_depth(req.scrip.upper())
    await broadcast({**depth, "event": "depth"})
    for t in trades:
        await broadcast({
            "event"    : "trade",
            "scrip"    : t.scrip,
            "price"    : t.price,
            "quantity" : t.quantity,
            "buyer_id" : t.buyer_id,
            "seller_id": t.seller_id,
            "trade_id" : t.trade_id,
        })
        _update_candle(t.scrip, t.price, t.quantity)

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


@app.get("/depth/{scrip}")
def get_depth(scrip: str, levels: int = 5):
    return matcher.get_depth(scrip.upper(), levels)


@app.get("/ltp/{scrip}")
def get_ltp(scrip: str):
    return {"scrip": scrip.upper(), "ltp": matcher.get_ltp(scrip.upper())}


@app.get("/market-watch")
def market_watch():
    """LTP for all active scrips."""
    from simulation.price_feed import SEED_PRICES
    result = []
    for scrip in ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK"]:
        ltp  = matcher.get_ltp(scrip)
        seed = SEED_PRICES.get(scrip, 0)
        result.append({
            "scrip"    : scrip,
            "ltp"      : ltp,
            "seed"     : seed,
            "change"   : round(ltp - seed, 2) if ltp else 0,
            "changePct": round((ltp - seed) / seed * 100, 2) if ltp else 0.0,
        })
    return result


@app.get("/candles/{scrip}")
def get_candles(scrip: str):
    """Return sorted 1-min OHLCV candles for a scrip (in-memory)."""
    book = _candles.get(scrip.upper(), {})
    return sorted(book.values(), key=lambda c: c["time"])


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
# WebSocket — pushes order book / trade events to frontend
# ------------------------------------------------------------------
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    clients.append(websocket)
    # Send current depth for all scrips on connect
    for scrip in ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK"]:
        depth = matcher.get_depth(scrip)
        try:
            await websocket.send_text(json.dumps({**depth, "event": "depth"}, default=str))
        except Exception:
            break
    try:
        while True:
            await websocket.receive_text()   # keep alive
    except WebSocketDisconnect:
        clients.remove(websocket)