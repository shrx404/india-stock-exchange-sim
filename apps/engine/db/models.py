"""
SQLAlchemy async ORM models for the exchange database.
Tables mirror the DDL in db/init.sql but are driven from Python here
so the engine service can write without a separate migration tool.
"""

from datetime import datetime
from sqlalchemy import (
    Boolean, Column, DateTime, Integer, Numeric,
    String, ForeignKey, text, JSON
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class ScripRecord(Base):
    __tablename__ = "scrips"

    id          = Column(Integer, primary_key=True)
    symbol      = Column(String(20), unique=True, nullable=False)
    name        = Column(String(100), nullable=False)
    lot_size    = Column(Integer, default=1)
    tick_size   = Column(Numeric(10, 2), default=0.05)
    circuit_pct = Column(Numeric(5, 2), default=20.00)
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime(timezone=True), server_default=text("NOW()"))


class TraderRecord(Base):
    __tablename__ = "traders"

    id         = Column(Integer, primary_key=True)
    trader_id  = Column(String(50), unique=True, nullable=False)
    name       = Column(String(100), nullable=False)
    balance    = Column(Numeric(15, 2), default=1_000_000.00)
    is_bot     = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))


class OrderRecord(Base):
    __tablename__ = "orders"

    id            = Column(Integer, primary_key=True)
    order_id      = Column(String(36), unique=True, nullable=False)
    scrip         = Column(String(20), ForeignKey("scrips.symbol"), nullable=False)
    trader_id     = Column(String(50), ForeignKey("traders.trader_id"), nullable=False)
    side          = Column(String(4), nullable=False)
    order_type    = Column(String(10), nullable=False)
    quantity      = Column(Integer, nullable=False)
    price         = Column(Numeric(10, 2), nullable=False, default=0)
    trigger_price = Column(Numeric(10, 2), default=0)
    filled_qty    = Column(Integer, default=0)
    status        = Column(String(10), default="PENDING")
    created_at    = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at    = Column(DateTime(timezone=True), server_default=text("NOW()"), onupdate=datetime.utcnow)


class TradeRecord(Base):
    __tablename__ = "trades"

    id         = Column(Integer, primary_key=True)
    trade_id   = Column(String(36), unique=True, nullable=False)
    scrip      = Column(String(20), ForeignKey("scrips.symbol"), nullable=False)
    buy_order  = Column(String(36), ForeignKey("orders.order_id"), nullable=False)
    sell_order = Column(String(36), ForeignKey("orders.order_id"), nullable=False)
    price      = Column(Numeric(10, 2), nullable=False)
    quantity   = Column(Integer, nullable=False)
    traded_at  = Column(DateTime(timezone=True), server_default=text("NOW()"))


class PriceHistoryRecord(Base):
    __tablename__ = "price_history"

    scrip       = Column(String(20), ForeignKey("scrips.symbol"), primary_key=True)
    candle_time = Column(DateTime(timezone=True), primary_key=True)
    open        = Column(Numeric(10, 2))
    high        = Column(Numeric(10, 2))
    low         = Column(Numeric(10, 2))
    close       = Column(Numeric(10, 2))
    volume      = Column(Integer, default=0)


class MarketDepthSnapshotRecord(Base):
    __tablename__ = "market_depth_snapshots"

    id            = Column(Integer, primary_key=True)
    scrip         = Column(String(20), ForeignKey("scrips.symbol"), nullable=False)
    snapshot_time = Column(DateTime(timezone=True), server_default=text("NOW()"))
    bids          = Column(JSON, nullable=False)
    asks          = Column(JSON, nullable=False)
