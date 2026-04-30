import asyncio
from typing import Dict, Callable, Any
from datetime import datetime, timezone

from db.session import get_session
from db.models import PriceHistoryRecord

class CandleAggregator:
    def __init__(self, broadcast_fn: Callable[[dict], Any] = None):
        # scrip -> { minute_str -> {open, high, low, close, volume, time, persisted} }
        self._candles: Dict[str, Dict[str, dict]] = {}
        self._broadcast_fn = broadcast_fn

    async def update_candle(self, scrip: str, price: float, qty: int):
        now = datetime.now(timezone.utc)
        # 1-minute interval key
        key = now.strftime("%Y-%m-%dT%H:%M:00Z")
        
        book = self._candles.setdefault(scrip, {})
        is_new = key not in book
        
        if is_new:
            book[key] = {
                "time": key,
                "open": price,
                "high": price,
                "low": price,
                "close": price,
                "volume": qty,
                "persisted": False
            }
        else:
            c = book[key]
            c["high"] = max(c["high"], price)
            c["low"] = min(c["low"], price)
            c["close"] = price
            c["volume"] += qty
        
        # Broadcast live candle update
        if self._broadcast_fn:
            await self._broadcast_fn({
                "event": "candle",
                "scrip": scrip,
                "candle": book[key]
            })

    def get_candles(self, scrip: str) -> list[dict]:
        book = self._candles.get(scrip.upper(), {})
        return sorted(book.values(), key=lambda c: c["time"])

    async def _flush_completed_candles(self):
        """Persist candles older than the current minute to DB."""
        now = datetime.now(timezone.utc)
        current_minute_key = now.strftime("%Y-%m-%dT%H:%M:00Z")
        
        to_persist = []
        
        for scrip, book in list(self._candles.items()):
            keys = list(book.keys())
            for k in keys:
                c = book[k]
                if k < current_minute_key and not c.get("persisted"):
                    # completed candle, needs persist
                    to_persist.append({
                        "scrip": scrip,
                        "open": c["open"],
                        "high": c["high"],
                        "low": c["low"],
                        "close": c["close"],
                        "volume": c["volume"],
                        "candle_time": datetime.strptime(c["time"], "%Y-%m-%dT%H:%M:00Z").replace(tzinfo=timezone.utc)
                    })
                    c["persisted"] = True
        
        if not to_persist:
            return
            
        try:
            from sqlalchemy.dialects.postgresql import insert
            async with get_session() as session:
                for row in to_persist:
                    # Upsert on (scrip, candle_time)
                    stmt = insert(PriceHistoryRecord).values(**row)
                    stmt = stmt.on_conflict_do_update(
                        index_elements=['scrip', 'candle_time'],
                        set_={
                            'open': stmt.excluded.open,
                            'high': stmt.excluded.high,
                            'low': stmt.excluded.low,
                            'close': stmt.excluded.close,
                            'volume': stmt.excluded.volume
                        }
                    )
                    await session.execute(stmt)
        except Exception as e:
            print(f"[CandleAggregator] Failed to flush candles: {e}")
            # Revert persisted flag so it tries again next time
            for row in to_persist:
                scrip = row["scrip"]
                ctime = row["candle_time"].strftime("%Y-%m-%dT%H:%M:00Z")
                if scrip in self._candles and ctime in self._candles[scrip]:
                    self._candles[scrip][ctime]["persisted"] = False

    async def run(self, interval: int = 10):
        """Background task to periodically flush candles."""
        while True:
            await asyncio.sleep(interval)
            await self._flush_completed_candles()
