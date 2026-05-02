"""
Async SQLAlchemy session management.
"""

from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from config import DATABASE_URL
from db.models import Base

# Replace postgresql+asyncpg:// scheme if caller passes psycopg2 style
_url = (DATABASE_URL or "").replace("postgresql://", "postgresql+asyncpg://")

engine = create_async_engine(_url, echo=False, pool_pre_ping=True) if _url else None

AsyncSessionLocal = async_sessionmaker(
    bind=engine, class_=AsyncSession, expire_on_commit=False
) if engine else None

from datetime import datetime, date
from sqlalchemy import text

async def init_db():
    """Create all tables (idempotent — uses CREATE TABLE IF NOT EXISTS via DDL)."""
    if engine is None:
        return
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
        # Create partitions for the current and next month for price_history
        now = datetime.now()
        
        y1, m1 = now.year, now.month
        y2, m2 = (y1, m1 + 1) if m1 < 12 else (y1 + 1, 1)
        y3, m3 = (y2, m2 + 1) if m2 < 12 else (y2 + 1, 1)

        part_current = f"price_history_{y1}_{m1:02d}"
        part_next = f"price_history_{y2}_{m2:02d}"

        # Create partitions if they don't exist
        sql_current = text(f"""
            CREATE TABLE IF NOT EXISTS {part_current} PARTITION OF price_history
            FOR VALUES FROM ('{y1}-{m1:02d}-01') TO ('{y2}-{m2:02d}-01');
        """)
        sql_next = text(f"""
            CREATE TABLE IF NOT EXISTS {part_next} PARTITION OF price_history
            FOR VALUES FROM ('{y2}-{m2:02d}-01') TO ('{y3}-{m3:02d}-01');
        """)
        try:
            await conn.execute(sql_current)
            await conn.execute(sql_next)
        except Exception as e:
            print(f"[DB Partition Setup Error] {e}")


@asynccontextmanager
async def get_session():
    """Yield an AsyncSession; commits on success, rolls back on error."""
    if AsyncSessionLocal is None:
        raise RuntimeError("DATABASE_URL not configured — cannot create DB session")
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
