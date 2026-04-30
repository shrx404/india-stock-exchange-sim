"""
Simulation agents — run as asyncio background tasks inside FastAPI.

MarketMakerBot:
  Every `interval` seconds, places a symmetric 5-level bid/ask ladder
  around the mid price (LTP or seed price) for every active scrip.
  Cancels its own previous resting orders before re-quoting so the book
  doesn't fill up with stale levels.

RetailBot:
  Every `interval` seconds, picks a random scrip and places either a
  LIMIT or MARKET order near the current LTP, simulating retail flow.
"""

import asyncio
import random
from typing import Callable

from core.order import Order, Side, OrderType
from core.matcher import Matcher
from simulation.price_feed import SEED_PRICES

# Active scrips the bots trade (subset of SEED_PRICES)
BOT_SCRIPS = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK"]

# Number of quote levels on each side
MM_LEVELS = 5
# Spread per tick (₹ distance between each level)
MM_TICK   = 1.00
# Quantity per level
MM_QTY    = 50


def _mid(matcher: Matcher, scrip: str) -> float:
    """Return LTP if available, else fall back to seed price."""
    ltp = matcher.get_ltp(scrip)
    return ltp if ltp is not None else SEED_PRICES.get(scrip, 1000.0)


class MarketMakerBot:
    """
    Keeps the order book alive by continuously quoting a bid/ask ladder.
    """

    def __init__(self, matcher: Matcher, broadcast_fn: Callable, interval: float = 3.0):
        self._matcher   = matcher
        self._broadcast = broadcast_fn
        self._interval  = interval
        # Track own order_ids so we can cancel stale quotes
        self._my_orders: dict[str, list[str]] = {s: [] for s in BOT_SCRIPS}

    async def run(self):
        await asyncio.sleep(1)  # let FastAPI finish startup
        while True:
            try:
                await self._requote_all()
            except Exception as exc:
                print(f"[MM] error: {exc}")
            await asyncio.sleep(self._interval)

    async def _requote_all(self):
        for scrip in BOT_SCRIPS:
            # Cancel previous resting quotes
            for oid in self._my_orders[scrip]:
                self._matcher.cancel_order(scrip, oid)
            self._my_orders[scrip] = []

            mid = _mid(self._matcher, scrip)

            # Place bid ladder (below mid)
            for i in range(1, MM_LEVELS + 1):
                price = round(mid - i * MM_TICK, 2)
                qty   = MM_QTY + random.randint(-10, 10)
                order = Order(
                    scrip=scrip, side=Side.BUY, order_type=OrderType.LIMIT,
                    quantity=max(1, qty), price=price, trader_id="bot_mm_01",
                )
                self._matcher.place_order(order)
                self._my_orders[scrip].append(order.order_id)

            # Place ask ladder (above mid)
            for i in range(1, MM_LEVELS + 1):
                price = round(mid + i * MM_TICK, 2)
                qty   = MM_QTY + random.randint(-10, 10)
                order = Order(
                    scrip=scrip, side=Side.SELL, order_type=OrderType.LIMIT,
                    quantity=max(1, qty), price=price, trader_id="bot_mm_01",
                )
                self._matcher.place_order(order)
                self._my_orders[scrip].append(order.order_id)

            # Broadcast updated depth
            depth = self._matcher.get_depth(scrip)
            await self._broadcast(depth)


class RetailBot:
    """
    Simulates retail order flow — random direction, quantity and price.
    """

    def __init__(self, matcher: Matcher, broadcast_fn: Callable, interval: float = 2.0):
        self._matcher   = matcher
        self._broadcast = broadcast_fn
        self._interval  = interval

    async def run(self):
        await asyncio.sleep(2)  # start after market maker seeds the book
        while True:
            try:
                await self._place_random_order()
            except Exception as exc:
                print(f"[Retail] error: {exc}")
            await asyncio.sleep(self._interval + random.uniform(-0.5, 0.5))

    async def _place_random_order(self):
        scrip = random.choice(BOT_SCRIPS)
        side  = random.choice([Side.BUY, Side.SELL])
        mid   = _mid(self._matcher, scrip)
        qty   = random.randint(1, 30)

        # 30% market orders, 70% limit orders
        if random.random() < 0.30:
            order = Order(
                scrip=scrip, side=side, order_type=OrderType.MARKET,
                quantity=qty, price=0.0, trader_id="bot_retail_01",
            )
        else:
            # Limit price within ±2% of mid
            offset = mid * random.uniform(0.001, 0.02)
            price  = round(mid + offset if side == Side.BUY else mid - offset, 2)
            order  = Order(
                scrip=scrip, side=side, order_type=OrderType.LIMIT,
                quantity=qty, price=price, trader_id="bot_retail_01",
            )

        trades = self._matcher.place_order(order)
        depth  = self._matcher.get_depth(scrip)
        await self._broadcast(depth)

        # If trades happened, also broadcast trade events
        for t in trades:
            await self._broadcast({
                "event"    : "trade",
                "scrip"    : scrip,
                "price"    : t.price,
                "quantity" : t.quantity,
                "buyer_id" : t.buyer_id,
                "seller_id": t.seller_id,
                "trade_id" : t.trade_id,
            })
