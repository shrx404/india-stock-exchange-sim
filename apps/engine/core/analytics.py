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
        # Ignore limit since we now use a session-long running VWAP
        return self._trade_store.get_vwap(scrip)
