"""
seed_price_history.py
---------------------
Reads data/processed/prices.json (produced by fetch_bhavcopy.py) and
bulk-inserts daily OHLCV rows into the PostgreSQL `price_history` table.

The candle_time for each daily bar is set to the market-open time (09:15 IST)
on the given date, stored as a timezone-aware UTC timestamp.

Usage (from project root):
    python data/seed_price_history.py

Requirements:
    - Docker DB must be running (or DATABASE_URL env var set)
    - Run fetch_bhavcopy.py first to generate data/processed/prices.json
"""

import asyncio
import json
import os
import sys
from datetime import datetime, timezone, time as dtime, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Add the engine app to sys.path so we can reuse its DB stack
# ---------------------------------------------------------------------------
ENGINE_DIR = Path(__file__).resolve().parent.parent / "apps" / "engine"
sys.path.insert(0, str(ENGINE_DIR))

from dotenv import load_dotenv
load_dotenv(ENGINE_DIR / ".env")

from db.session import init_db, get_session
from db.models import PriceHistoryRecord

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PRICES_JSON = Path(__file__).resolve().parent / "processed" / "prices.json"

# IST offset = UTC+5:30
IST = timezone(timedelta(hours=5, minutes=30))
MARKET_OPEN_TIME = dtime(9, 15)  # 09:15 IST


def date_to_candle_utc(date_str: str) -> datetime:
    """Convert 'YYYY-MM-DD' → UTC datetime at 09:15 IST."""
    d = datetime.fromisoformat(date_str).date()
    ist_dt = datetime.combine(d, MARKET_OPEN_TIME, tzinfo=IST)
    return ist_dt.astimezone(timezone.utc)


async def seed():
    if not PRICES_JSON.exists():
        print(f"❌  {PRICES_JSON} not found. Run data/fetch_bhavcopy.py first.")
        sys.exit(1)

    data: dict[str, list[dict]] = json.loads(PRICES_JSON.read_text())

    print("Initialising DB tables…")
    await init_db()
    print("DB ready.\n")

    total_inserted = 0
    total_skipped = 0

    async with get_session() as session:
        from sqlalchemy import select
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        for scrip, rows in data.items():
            if not rows:
                print(f"  {scrip:<15} — no data, skipping")
                continue

            inserted = 0
            for row in rows:
                candle_time = date_to_candle_utc(row["date"])

                # Check for duplicate (scrip + candle_time)
                existing = (await session.execute(
                    select(PriceHistoryRecord).where(
                        PriceHistoryRecord.scrip == scrip,
                        PriceHistoryRecord.candle_time == candle_time,
                    )
                )).scalar_one_or_none()

                if existing:
                    total_skipped += 1
                    continue

                session.add(PriceHistoryRecord(
                    scrip=scrip,
                    open=row["open"],
                    high=row["high"],
                    low=row["low"],
                    close=row["close"],
                    volume=row["volume"],
                    candle_time=candle_time,
                ))
                inserted += 1

            await session.flush()  # flush per scrip so we can report counts
            print(f"  {scrip:<15}  inserted {inserted:>3}  rows  ({len(rows)} total in JSON)")
            total_inserted += inserted

    print(f"\n[OK] Done. Inserted {total_inserted} rows, skipped {total_skipped} duplicates.")


if __name__ == "__main__":
    asyncio.run(seed())
