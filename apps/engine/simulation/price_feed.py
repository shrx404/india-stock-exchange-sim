# Seed reference prices for each scrip (used when LTP is None on startup)
# These are fallback defaults. We override them with real DB prices on startup.
SEED_PRICES: dict[str, float] = {
    "RELIANCE":   2950.00,
    "TCS":        3800.00,
    "HDFCBANK":   1620.00,
    "INFY":       1480.00,
    "ICICIBANK":   960.00,
    "HINDUNILVR": 2500.00,
    "SBIN":        760.00,
    "BHARTIARTL": 1100.00,
    "KOTAKBANK":  1850.00,
    "ITC":         430.00,
}


async def load_base_prices_from_db():
    """Queries the database for the most recent close price for all active scrips."""
    from db.session import get_session
    from db.models import PriceHistoryRecord
    from sqlalchemy import select, func

    try:
        async with get_session() as session:
            # Get the most recent candle_time per scrip
            subq = select(
                PriceHistoryRecord.scrip,
                func.max(PriceHistoryRecord.candle_time).label("max_time")
            ).group_by(PriceHistoryRecord.scrip).subquery()

            # Join back to get the close price at that max_time
            q = select(PriceHistoryRecord).join(
                subq,
                (PriceHistoryRecord.scrip == subq.c.scrip) &
                (PriceHistoryRecord.candle_time == subq.c.max_time)
            )

            results = (await session.execute(q)).scalars().all()
            updated_count = 0
            for r in results:
                if r.close:
                    SEED_PRICES[r.scrip] = float(r.close)
                    updated_count += 1
            
            if updated_count > 0:
                print(f"[Price Feed] Updated {updated_count} base prices from historical data.")
    except Exception as e:
        print(f"[Price Feed] Error loading base prices from DB: {e}")
