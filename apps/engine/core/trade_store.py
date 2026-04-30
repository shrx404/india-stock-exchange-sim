from collections import defaultdict
from .trade import Trade

class TradeStore:
    """
    In-memory store for recent trades. 
    Maintains a bounded list of trades per scrip for fast analytics.
    """
    def __init__(self, max_history: int = 1000):
        self._max_history = max_history
        self._trades: dict[str, list[Trade]] = defaultdict(list)
        self._cumulative_typical_price_volume: dict[str, float] = defaultdict(float)
        self._cumulative_volume: dict[str, int] = defaultdict(int)
        
    def add_trade(self, trade: Trade):
        scrip_trades = self._trades[trade.scrip]
        scrip_trades.append(trade)
        if len(scrip_trades) > self._max_history:
            scrip_trades.pop(0)
            
        # Update VWAP running variables
        self._cumulative_typical_price_volume[trade.scrip] += trade.price * trade.quantity
        self._cumulative_volume[trade.scrip] += trade.quantity

    def get_recent_trades(self, scrip: str, limit: int = 10) -> list[Trade]:
        return self._trades[scrip][-limit:]

    def get_vwap(self, scrip: str) -> float | None:
        if self._cumulative_volume[scrip] == 0:
            return None
        return self._cumulative_typical_price_volume[scrip] / self._cumulative_volume[scrip]
