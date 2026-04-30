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


async def init_db():
    """Create all tables (idempotent — uses CREATE TABLE IF NOT EXISTS via DDL)."""
    if engine is None:
        return
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


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
