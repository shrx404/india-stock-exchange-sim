from .order import Order
from .order_book import OrderBook
from .trade import Trade


from .trade_store import TradeStore

from simulation.price_feed import SEED_PRICES
from .market_session import SessionState

class Matcher:
    """
    Exchange-level matcher.
    Holds one OrderBook per scrip, routes incoming orders.
    """

    def __init__(self, trade_store: TradeStore | None = None):
        self._books: dict[str, OrderBook] = {}
        self.trade_store = trade_store

    def get_or_create_book(self, scrip: str) -> OrderBook:
        if scrip not in self._books:
            prev_close = SEED_PRICES.get(scrip, 100.0)
            self._books[scrip] = OrderBook(scrip, prev_close=prev_close)
        return self._books[scrip]

    def set_pre_open(self, scrip: str) -> bool:
        book = self.get_or_create_book(scrip)
        book.session_state = SessionState.PRE_OPEN
        return True

    def halt_market(self, scrip: str) -> bool:
        book = self.get_or_create_book(scrip)
        book.session_state = SessionState.HALTED
        return True

    def open_market(self, scrip: str) -> list[Trade]:
        book = self.get_or_create_book(scrip)
        if book.session_state == SessionState.PRE_OPEN:
            # Execute call auction to transition to OPEN
            trades = book.execute_call_auction()
            if self.trade_store:
                for t in trades:
                    self.trade_store.add_trade(t)
            return trades
        
        book.session_state = SessionState.OPEN
        return []

    def place_order(self, order: Order) -> list[Trade]:
        book = self.get_or_create_book(order.scrip)
        trades = book.add_order(order)
        if self.trade_store:
            for t in trades:
                self.trade_store.add_trade(t)
        return trades

    def cancel_order(self, scrip: str, order_id: str) -> bool:
        book = self._books.get(scrip)
        if not book:
            return False
        return book.cancel_order(order_id)

    def get_depth(self, scrip: str, levels: int = 8) -> dict:
        book = self._books.get(scrip)
        if not book:
            from .market_session import SessionState
            return {
                "scrip": scrip,
                "ltp": None,
                "bids": [],
                "asks": [],
                "session_state": SessionState.OPEN.value,
                "prev_close": SEED_PRICES.get(scrip, 0.0)
            }
        return book.get_depth(levels)

    def get_ltp(self, scrip: str) -> float | None:
        book = self._books.get(scrip)
        return book.ltp if book else None

    @property
    def active_scrips(self) -> list[str]:
        return list(self._books.keys())


# --- smoke test ---
if __name__ == "__main__":
    from core.order import Order, Side, OrderType

    m = Matcher()

    # Two scrips trading simultaneously
    m.place_order(Order("TCS",      Side.SELL, OrderType.LIMIT, 10, 3800.0, "bot_mm_01"))
    m.place_order(Order("HDFCBANK", Side.SELL, OrderType.LIMIT, 20, 1620.0, "bot_mm_01"))

    trades = m.place_order(Order("TCS", Side.BUY, OrderType.LIMIT, 5, 3800.0, "trader_human"))
    print("TCS trades:", trades)
    print("TCS LTP   :", m.get_ltp("TCS"))
    print("HDFC LTP  :", m.get_ltp("HDFCBANK"))   # None, no trades yet
    print("Active    :", m.active_scrips)

    # Expected:
    # TCS trades: [Trade(TCS 5 @ ₹3800.0 | buyer=trader_human seller=bot_mm_01)]
    # TCS LTP   : 3800.0
    # HDFC LTP  : None
    # Active    : ['TCS', 'HDFCBANK']