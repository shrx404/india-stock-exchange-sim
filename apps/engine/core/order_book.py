import heapq
from collections import defaultdict
from typing import Optional
from .order import Order, Side, OrderType, OrderStatus
from .trade import Trade
from .market_session import SessionState


class OrderBook:
    """
    Central Limit Order Book for a single scrip.
    Bids → max-heap (negate price so heapq works as max-heap)
    Asks → min-heap
    Each heap entry: (price, timestamp, order_id)  ← price-time priority
    """

    def __init__(self, scrip: str, prev_close: float = 0.0):
        self.scrip   = scrip
        self._bids   = []   # max-heap: [(-price, timestamp, order_id)]
        self._asks   = []   # min-heap: [(price,  timestamp, order_id)]
        self._orders : dict[str, Order] = {}   # order_id → Order
        self._ltp    : Optional[float] = None  # last traded price
        self._trades : list[Trade] = []        # trade log
        
        self.session_state: SessionState = SessionState.OPEN
        self.prev_close: float = prev_close

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add_order(self, order: Order) -> list[Trade]:
        if self.session_state == SessionState.HALTED:
            raise ValueError(f"Trading is HALTED for {self.scrip}.")
            
        if order.order_type == OrderType.LIMIT and self.prev_close > 0:
            # Check circuit limits (±20%)
            upper_limit = self.prev_close * 1.20
            lower_limit = self.prev_close * 0.80
            if order.price > upper_limit or order.price < lower_limit:
                raise ValueError(f"Order price {order.price} is outside circuit limits (±20% of {self.prev_close}).")

        self._orders[order.order_id] = order
        
        if self.session_state == SessionState.PRE_OPEN:
            self._push_to_book(order)
            return []

        if order.order_type == OrderType.MARKET:
            return self._match_market(order)
        else:
            return self._match_limit(order)

    def cancel_order(self, order_id: str) -> bool:
        order = self._orders.get(order_id)
        if not order or not order.is_active:
            return False
        order.status = OrderStatus.CANCELLED
        return True

    @property
    def ltp(self) -> Optional[float]:
        return self._ltp

    def best_bid(self) -> Optional[float]:
        self._clean_heap(self._bids, is_bid=True)
        if self._bids:
            return -self._bids[0][0]
        return None

    def best_ask(self) -> Optional[float]:
        self._clean_heap(self._asks, is_bid=False)
        if self._asks:
            return self._asks[0][0]
        return None

    def get_depth(self, levels: int = 8) -> dict:
        bids = self._aggregate_side(self._bids, is_bid=True,  levels=levels)
        asks = self._aggregate_side(self._asks, is_bid=False, levels=levels)
        return {
            "scrip": self.scrip,
            "ltp"  : self._ltp,
            "bids" : bids,
            "asks" : asks,
            "session_state": self.session_state.value,
            "prev_close": self.prev_close
        }

    def calculate_equilibrium_price(self) -> Optional[float]:
        bids = self._aggregate_side(self._bids, is_bid=True, levels=10000)
        asks = self._aggregate_side(self._asks, is_bid=False, levels=10000)
        
        if not bids or not asks:
            return None
            
        prices = sorted(list(set([b["price"] for b in bids] + [a["price"] for a in asks])))
        
        max_vol = 0
        best_price = None
        
        for p in prices:
            demand = sum(b["quantity"] for b in bids if b["price"] >= p)
            supply = sum(a["quantity"] for a in asks if a["price"] <= p)
            tradable_vol = min(demand, supply)
            
            if tradable_vol > max_vol:
                max_vol = tradable_vol
                best_price = p
                
        return best_price if max_vol > 0 else None

    def execute_call_auction(self) -> list[Trade]:
        ep = self.calculate_equilibrium_price()
        if not ep:
            self.session_state = SessionState.OPEN
            return []
            
        trades = []
        eligible_bids = []
        for neg_p, ts, oid in self._bids:
            order = self._orders.get(oid)
            if order and order.is_active and (order.order_type == OrderType.MARKET or -neg_p >= ep):
                eligible_bids.append(order)
                
        eligible_asks = []
        for p, ts, oid in self._asks:
            order = self._orders.get(oid)
            if order and order.is_active and (order.order_type == OrderType.MARKET or p <= ep):
                eligible_asks.append(order)
                
        eligible_bids.sort(key=lambda x: (0 if x.order_type == OrderType.MARKET else 1, -x.price, x.timestamp))
        eligible_asks.sort(key=lambda x: (0 if x.order_type == OrderType.MARKET else 1, x.price, x.timestamp))
        
        b_idx, a_idx = 0, 0
        while b_idx < len(eligible_bids) and a_idx < len(eligible_asks):
            b = eligible_bids[b_idx]
            a = eligible_asks[a_idx]
            
            if not b.is_active:
                b_idx += 1; continue
            if not a.is_active:
                a_idx += 1; continue
                
            trade = self._execute(b, a, ep)
            if trade:
                trades.append(trade)
                
        self.session_state = SessionState.OPEN
        return trades


    # ------------------------------------------------------------------
    # Internal matching
    # ------------------------------------------------------------------

    def _match_limit(self, order: Order) -> list[Trade]:
        trades = []
        if order.side == Side.BUY:
            # match against asks where ask_price <= order.price
            while order.is_active and self._asks:
                self._clean_heap(self._asks, is_bid=False)
                if not self._asks:
                    break
                best_ask_price, _, best_ask_id = self._asks[0]
                if best_ask_price > order.price:
                    break   # no match possible
                ask_order = self._orders[best_ask_id]
                trade = self._execute(order, ask_order, best_ask_price)
                if trade:
                    trades.append(trade)
        else:
            # SELL — match against bids where bid_price >= order.price
            while order.is_active and self._bids:
                self._clean_heap(self._bids, is_bid=True)
                if not self._bids:
                    break
                neg_best_bid, _, best_bid_id = self._bids[0]
                best_bid_price = -neg_best_bid
                if best_bid_price < order.price:
                    break
                bid_order = self._orders[best_bid_id]
                trade = self._execute(bid_order, order, best_bid_price)
                if trade:
                    trades.append(trade)

        # If still has quantity remaining → rest in book
        if order.is_active:
            self._push_to_book(order)

        return trades

    def _match_market(self, order: Order) -> list[Trade]:
        trades = []
        if order.side == Side.BUY:
            while order.is_active and self._asks:
                self._clean_heap(self._asks, is_bid=False)
                if not self._asks:
                    break
                ask_price, _, ask_id = self._asks[0]
                ask_order = self._orders[ask_id]
                trade = self._execute(order, ask_order, ask_price)
                if trade:
                    trades.append(trade)
        else:
            while order.is_active and self._bids:
                self._clean_heap(self._bids, is_bid=True)
                if not self._bids:
                    break
                neg_price, _, bid_id = self._bids[0]
                bid_order = self._orders[bid_id]
                trade = self._execute(bid_order, order, -neg_price)
                if trade:
                    trades.append(trade)

        # market orders that couldn't fill → cancel remainder
        if order.is_active:
            order.status = OrderStatus.CANCELLED

        return trades

    def _execute(self, buy: Order, sell: Order, price: float) -> Optional[Trade]:
        if not buy.is_active or not sell.is_active:
            return None

        qty = min(buy.pending_qty, sell.pending_qty)
        if qty <= 0:
            return None

        buy.filled_qty  += qty
        sell.filled_qty += qty

        buy.status  = OrderStatus.FILLED if buy.pending_qty  == 0 else OrderStatus.PARTIAL
        sell.status = OrderStatus.FILLED if sell.pending_qty == 0 else OrderStatus.PARTIAL

        self._ltp = price
        
        # Check circuit limits after trade
        if self.prev_close > 0:
            upper_limit = self.prev_close * 1.20
            lower_limit = self.prev_close * 0.80
            if price >= upper_limit or price <= lower_limit:
                self.session_state = SessionState.HALTED

        trade = Trade(
            scrip      = self.scrip,
            buy_order  = buy.order_id,
            sell_order = sell.order_id,
            price      = price,
            quantity   = qty,
            buyer_id   = buy.trader_id,
            seller_id  = sell.trader_id,
        )
        self._trades.append(trade)

        # Pop fully filled orders off the heap tops
        if not buy.is_active and self._bids:
            self._clean_heap(self._bids, is_bid=True)
        if not sell.is_active and self._asks:
            self._clean_heap(self._asks, is_bid=False)

        return trade

    # ------------------------------------------------------------------
    # Heap helpers
    # ------------------------------------------------------------------

    def _push_to_book(self, order: Order):
        if order.side == Side.BUY:
            heapq.heappush(self._bids, (-order.price, order.timestamp, order.order_id))
        else:
            heapq.heappush(self._asks, (order.price, order.timestamp, order.order_id))

    def _clean_heap(self, heap: list, is_bid: bool):
        # lazy deletion — remove cancelled/filled orders from heap top
        while heap:
            if is_bid:
                _, _, oid = heap[0]
            else:
                _, _, oid = heap[0]
            o = self._orders.get(oid)
            if o and o.is_active:
                break
            heapq.heappop(heap)

    def _aggregate_side(self, heap: list, is_bid: bool, levels: int) -> list[dict]:
        seen   = {}
        result = []
        temp   = list(heap)   # don't mutate original

        for entry in sorted(temp, key=lambda x: x[0]):
            price_key = entry[0]
            oid       = entry[2]
            order     = self._orders.get(oid)
            if not order or not order.is_active:
                continue
            price = -price_key if is_bid else price_key
            if price not in seen:
                seen[price] = {"price": price, "quantity": 0, "orders": 0}
            
            display_qty = order.pending_qty
            if order.visible_qty > 0:
                display_qty = min(order.pending_qty, order.visible_qty)
                
            seen[price]["quantity"] += display_qty
            seen[price]["orders"]   += 1

        sorted_prices = sorted(seen.keys(), reverse=is_bid)
        for p in sorted_prices[:levels]:
            result.append(seen[p])

        return result


# --- smoke test ---
if __name__ == "__main__":
    from core.order import Order, Side, OrderType

    book = OrderBook("RELIANCE")

    # Add some resting limit orders (market maker)
    book.add_order(Order("RELIANCE", Side.SELL, OrderType.LIMIT, 100, 2955.00, "bot_mm_01"))
    book.add_order(Order("RELIANCE", Side.SELL, OrderType.LIMIT, 50,  2960.00, "bot_mm_01"))
    book.add_order(Order("RELIANCE", Side.BUY,  OrderType.LIMIT, 100, 2945.00, "bot_mm_01"))
    book.add_order(Order("RELIANCE", Side.BUY,  OrderType.LIMIT, 50,  2940.00, "bot_mm_01"))

    print("=== Order Book (no trades yet) ===")
    import json
    print(json.dumps(book.get_depth(), indent=2, default=str))

    print("\n=== Human places BUY LIMIT @ 2955 ===")
    trades = book.add_order(Order("RELIANCE", Side.BUY, OrderType.LIMIT, 30, 2955.00, "trader_human"))
    for t in trades:
        print(t)

    print("\nLTP:", book.ltp)
    print("Best bid:", book.best_bid())
    print("Best ask:", book.best_ask())

    # Expected:
    # Trade(RELIANCE 30 @ ₹2955.0 | buyer=trader_human seller=bot_mm_01)
    # LTP: 2955.0
    # Best bid: 2945.0
    # Best ask: 2955.0  ← 70 remaining