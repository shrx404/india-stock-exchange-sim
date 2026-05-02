"""
Simulation agents — run as asyncio background tasks inside FastAPI.

MarketMakerBot:
  Every `interval` seconds, places a symmetric 5-level bid/ask ladder
  around the mid price (LTP or seed price) for every active scrip.
  Cancels its own previous resting orders before re-quoting so the book
  doesn't fill up with stale levels.
  Uses AgentConfig for personality and dynamic spread/iceberg logic.

RetailBot:
  Every `interval` seconds, picks a random scrip and places either a
  LIMIT or MARKET order near the current LTP, simulating retail flow.
"""

import asyncio
import random
import time
from typing import Callable, Optional
from dataclasses import dataclass, field

from core.order import Order, Side, OrderType
from core.matcher import Matcher
from core.trade_store import TradeStore
from core.analytics import Analytics
from simulation.price_feed import SEED_PRICES
import config

START_TIME = time.time()

def get_volume_multiplier() -> float:
    """
    Subtask 1.6 - Volume Profile: Time-based multiplier.
    Simulates a full trading day (9:15 to 15:30 = 375 mins) over 375 seconds.
    Returns a multiplier for agent activity (lower interval / higher qty).
    """
    elapsed_sec = time.time() - START_TIME
    day_sec = elapsed_sec % 375.0
    
    if day_sec < 30: # 9:15 - 9:45 (High volume open)
        return 2.0
    elif 105 <= day_sec < 225: # 11:00 - 13:00 (Midday lull)
        return 0.5
    elif day_sec >= 345: # 15:00 - 15:30 (High volume close)
        return 2.0
    return 1.0

from core.scrip_metadata import SCRIP_METADATA

# Active scrips the bots trade (all 50 Nifty scrips)
BOT_SCRIPS = list(SCRIP_METADATA.keys())

def _mid(matcher: Matcher, scrip: str) -> float:
    """Return LTP if available, else fall back to seed price."""
    ltp = matcher.get_ltp(scrip)
    return ltp if ltp is not None else SEED_PRICES.get(scrip, 1000.0)

def _round_to_tick(price: float, scrip: str) -> float:
    meta = SCRIP_METADATA.get(scrip)
    tick = meta["tick_size"] if meta else 0.05
    return round(round(price / tick) * tick, 2)


@dataclass
class AgentConfig:
    capital: float = 1_000_000.0
    risk_tolerance: float = 0.5  # 0.0 to 1.0
    aggression: float = 0.5      # 0.0 to 1.0
    reaction_delay: float = 1.0  # seconds
    preferred_scrips: list[str] = field(default_factory=lambda: BOT_SCRIPS.copy())


class BaseAgent:
    """Base class for all simulation agents with shared place_order logic."""
    def __init__(self, agent_id: str, matcher: Matcher, broadcast_fn: Callable, config: AgentConfig):
        self.agent_id = agent_id
        self._matcher = matcher
        self._broadcast = broadcast_fn
        self.config = config
        self._active = False

    async def place_order(self, order: Order):
        # Apply reaction delay
        if self.config.reaction_delay > 0:
            await asyncio.sleep(self.config.reaction_delay / config.SIM_SPEED_MULTIPLIER)
        
        order.trader_id = self.agent_id
        trades = self._matcher.place_order(order)
        
        # Broadcast depth
        depth = self._matcher.get_depth(order.scrip)
        await self._broadcast({**depth, "event": "depth"})
        
        # Broadcast trades
        for t in trades:
            await self._broadcast({
                "event"    : "trade",
                "scrip"    : t.scrip,
                "price"    : t.price,
                "quantity" : t.quantity,
                "buyer_id" : t.buyer_id,
                "seller_id": t.seller_id,
                "trade_id" : t.trade_id,
            })
        return trades

    async def run(self):
        self._active = True
        await asyncio.sleep(1) # Let FastAPI finish startup
        while self._active:
            try:
                await self.step()
            except Exception as exc:
                print(f"[{self.agent_id}] error: {exc}")
            # Step functions handle their own interval delays usually,
            # but we can yield control briefly to ensure we don't block
            await asyncio.sleep(0.1)

    async def step(self):
        raise NotImplementedError

    def stop(self):
        self._active = False


class MarketMakerBot(BaseAgent):
    """
    Keeps the order book alive by continuously quoting a bid/ask ladder.
    Features: cancel-replace, volatility spread widening, iceberg orders.
    """
    def __init__(self, agent_id: str, matcher: Matcher, broadcast_fn: Callable, config: AgentConfig, interval: float = 3.0):
        super().__init__(agent_id, matcher, broadcast_fn, config)
        self._interval = interval
        self._my_orders: dict[str, list[str]] = {s: [] for s in config.preferred_scrips}
        self._last_mid: dict[str, float] = {}

        # Base config for ladders
        self.mm_levels = 8

    async def step(self):
        vm = get_volume_multiplier()
        await asyncio.sleep((self._interval / vm) / config.SIM_SPEED_MULTIPLIER)
        for scrip in self.config.preferred_scrips:
            # Cancel previous resting quotes directly (faster than going through agent delay)
            for oid in self._my_orders[scrip]:
                self._matcher.cancel_order(scrip, oid)
            self._my_orders[scrip].clear()

            mid = _mid(self._matcher, scrip)
            prev_mid = self._last_mid.get(scrip, mid)
            self._last_mid[scrip] = mid

            meta = SCRIP_METADATA.get(scrip)
            scrip_tick = meta["tick_size"] if meta else 0.05

            # Spread management: widen spread if volatility is high
            volatility = abs(mid - prev_mid) / prev_mid if prev_mid else 0
            # Market Maker multiplier for tick size (usually 1 or 2 to stay close, but scaled to scrip tick)
            # base_tick should be a sensible distance, like 5 ticks
            base_tick = scrip_tick * 5
            tick_size = base_tick * (2.0 if volatility > 0.002 else 1.0)

            # Generate new quotes
            for i in range(1, self.mm_levels + 1):
                intent_qty = 50 + random.randint(-10, 10)
                
                # Iceberg logic: actual size is larger, but visible_qty is smaller
                visible_qty = int(intent_qty * self.config.aggression * vm)
                visible_qty = max(1, visible_qty)

                # Buy
                bid_price = _round_to_tick(mid - i * tick_size, scrip)
                o_bid = Order(
                    scrip=scrip, side=Side.BUY, order_type=OrderType.LIMIT,
                    quantity=intent_qty, price=bid_price, trader_id=self.agent_id,
                    visible_qty=visible_qty
                )
                self._matcher.place_order(o_bid)
                self._my_orders[scrip].append(o_bid.order_id)

                # Sell
                ask_price = _round_to_tick(mid + i * tick_size, scrip)
                o_ask = Order(
                    scrip=scrip, side=Side.SELL, order_type=OrderType.LIMIT,
                    quantity=intent_qty, price=ask_price, trader_id=self.agent_id,
                    visible_qty=visible_qty
                )
                self._matcher.place_order(o_ask)
                self._my_orders[scrip].append(o_ask.order_id)

            # Broadcast depth
            depth = self._matcher.get_depth(scrip)
            await self._broadcast({**depth, "event": "depth"})


class RetailBot(BaseAgent):
    """
    Simulates retail order flow — random direction, quantity and price.
    """
    def __init__(self, agent_id: str, matcher: Matcher, broadcast_fn: Callable, config: AgentConfig, interval: float = 2.0):
        super().__init__(agent_id, matcher, broadcast_fn, config)
        self._interval = interval

    async def step(self):
        vm = get_volume_multiplier()
        await asyncio.sleep(((self._interval + random.uniform(-0.5, 0.5)) / vm) / config.SIM_SPEED_MULTIPLIER)
        scrip = random.choice(self.config.preferred_scrips)
        side  = random.choice([Side.BUY, Side.SELL])
        mid   = _mid(self._matcher, scrip)
        qty   = max(1, int(random.randint(1, 30) * vm))

        # 30% market orders, 70% limit orders
        if random.random() < 0.30:
            order = Order(
                scrip=scrip, side=side, order_type=OrderType.MARKET,
                quantity=qty, price=0.0, trader_id=self.agent_id
            )
        else:
            # Limit price within ±2% of mid
            offset = mid * random.uniform(0.001, 0.02)
            raw_price = mid + offset if side == Side.BUY else mid - offset
            price = _round_to_tick(raw_price, scrip)
            order  = Order(
                scrip=scrip, side=side, order_type=OrderType.LIMIT,
                quantity=qty, price=price, trader_id=self.agent_id
            )

        # Use BaseAgent's place_order wrapper
        await self.place_order(order)


class MomentumBot(BaseAgent):
    """
    Detects price direction from last N trades.
    Buys aggressively when trending up, sells when trending down.
    Uses cooldown timer to prevent overtrading.
    """
    def __init__(self, agent_id: str, matcher: Matcher, broadcast_fn: Callable, config: AgentConfig, trade_store: TradeStore, interval: float = 2.0):
        super().__init__(agent_id, matcher, broadcast_fn, config)
        self._interval = interval
        self._trade_store = trade_store
        self._cooldown_until: dict[str, float] = {}

    async def step(self):
        vm = get_volume_multiplier()
        await asyncio.sleep((self._interval / vm) / config.SIM_SPEED_MULTIPLIER)
        now = time.time()
        for scrip in self.config.preferred_scrips:
            if now < self._cooldown_until.get(scrip, 0):
                continue
                
            trades = self._trade_store.get_recent_trades(scrip, limit=10)
            if len(trades) < 5:
                continue
                
            first_price = trades[0].price
            last_price = trades[-1].price
            
            # Very simple momentum heuristic
            change = (last_price - first_price) / first_price
            
            side = None
            if change > 0.001:  # uptrend > 0.1%
                side = Side.BUY
            elif change < -0.001: # downtrend > 0.1%
                side = Side.SELL
                
            if side:
                qty = int((100 * self.config.aggression + random.randint(1, 10)) * vm)
                order = Order(
                    scrip=scrip, side=side, order_type=OrderType.MARKET,
                    quantity=qty, price=0.0, trader_id=self.agent_id
                )
                await self.place_order(order)
                # Cooldown for 5 to 15 seconds
                self._cooldown_until[scrip] = time.time() + random.uniform(5.0, 15.0)


class MeanReversionBot(BaseAgent):
    """
    Tracks rolling VWAP per scrip.
    Buys when price is below VWAP, sells when above.
    Position size scales with distance.
    """
    def __init__(self, agent_id: str, matcher: Matcher, broadcast_fn: Callable, config: AgentConfig, analytics: Analytics, interval: float = 3.0):
        super().__init__(agent_id, matcher, broadcast_fn, config)
        self._interval = interval
        self._analytics = analytics

    async def step(self):
        vm = get_volume_multiplier()
        await asyncio.sleep((self._interval / vm) / config.SIM_SPEED_MULTIPLIER)
        for scrip in self.config.preferred_scrips:
            vwap = self._analytics.get_vwap(scrip, limit=100)
            mid = _mid(self._matcher, scrip)
            
            if vwap is None or mid is None:
                continue
                
            distance = (mid - vwap) / vwap
            
            side = None
            if distance < -0.005:  # 0.5% below VWAP -> BUY
                side = Side.BUY
            elif distance > 0.005: # 0.5% above VWAP -> SELL
                side = Side.SELL
                
            if side:
                # Scale quantity with distance
                base_qty = 50
                qty_multiplier = min(10.0, abs(distance) * 200) # e.g. 0.005 * 200 = 1.0x, 0.01 * 200 = 2.0x
                qty = int(base_qty * qty_multiplier * self.config.aggression * vm)
                qty = max(1, qty)
                
                # Place limit order close to mid to revert
                offset = mid * 0.001
                raw_price = mid - offset if side == Side.BUY else mid + offset
                price = _round_to_tick(raw_price, scrip)
                
                order = Order(
                    scrip=scrip, side=side, order_type=OrderType.LIMIT,
                    quantity=qty, price=price, trader_id=self.agent_id
                )
                await self.place_order(order)

class EnvironmentBot(BaseAgent):
    """
    Handles macro market events:
    1. Panic / Greed Cascade (if a scrip moves > 1%)
    2. Correlated Scrip Moves (if a scrip moves > 0.5%, nudge peers in sector)
    """
    def __init__(self, agent_id: str, matcher: Matcher, broadcast_fn: Callable, config: AgentConfig, interval: float = 10.0):
        super().__init__(agent_id, matcher, broadcast_fn, config)
        self._interval = interval
        self._last_prices: dict[str, float] = {}
        self._sectors = {
            "IT": ["TCS", "INFY"],
            "BANKING": ["HDFCBANK", "ICICIBANK"],
            "ENERGY": ["RELIANCE"]
        }

    async def step(self):
        await asyncio.sleep(self._interval / config.SIM_SPEED_MULTIPLIER)
        
        for scrip in self.config.preferred_scrips:
            mid = _mid(self._matcher, scrip)
            prev = self._last_prices.get(scrip, SEED_PRICES.get(scrip, mid))
            self._last_prices[scrip] = mid
            
            if prev == 0:
                continue
                
            change = (mid - prev) / prev
            
            # Subtask 1.5 - Panic/Greed Cascade (> 1% move)
            if abs(change) >= 0.01:
                side = Side.BUY if change > 0 else Side.SELL
                qty = int(200 * self.config.aggression)
                print(f"[CASCADE] {scrip} moved {change*100:.2f}%. Flooding {side.name}!")
                for _ in range(3):
                    await self.place_order(Order(
                        scrip=scrip, side=side, order_type=OrderType.MARKET,
                        quantity=qty + random.randint(10, 50), price=0.0, trader_id=self.agent_id
                    ))
                    await asyncio.sleep(0.1 / config.SIM_SPEED_MULTIPLIER)

            # Subtask 1.7 - Correlated Scrip Moves (> 0.5% move)
            elif abs(change) >= 0.005:
                my_sector = None
                for sec, scrips in self._sectors.items():
                    if scrip in scrips:
                        my_sector = sec
                        break
                
                if my_sector:
                    peers = [s for s in self._sectors[my_sector] if s != scrip]
                    for peer in peers:
                        side = Side.BUY if change > 0 else Side.SELL
                        qty = int(50 * self.config.aggression)
                        print(f"[CORRELATION] {scrip} moved {change*100:.2f}%. Nudging {peer} {side.name}!")
                        await self.place_order(Order(
                            scrip=peer, side=side, order_type=OrderType.MARKET,
                            quantity=qty, price=0.0, trader_id=self.agent_id
                        ))

