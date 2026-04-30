from typing import Optional
from .trade_store import TradeStore

class Analytics:
    """
    Analytics engine layer to compute market metrics (e.g. VWAP)
    on top of the in-memory TradeStore.
    """
    def __init__(self, trade_store: TradeStore):
        self._trade_store = trade_store

    def get_vwap(self, scrip: str, limit: int = 100) -> Optional[float]:
        trades = self._trade_store.get_recent_trades(scrip, limit)
        if not trades:
            return None
        total_vol = sum(t.quantity for t in trades)
        total_val = sum(t.price * t.quantity for t in trades)
        return total_val / total_vol if total_vol > 0 else None
