-- Scrips (stocks listed on exchange)
CREATE TABLE IF NOT EXISTS scrips (
    id          SERIAL PRIMARY KEY,
    symbol      VARCHAR(20) UNIQUE NOT NULL,
    name        VARCHAR(100) NOT NULL,
    lot_size    INTEGER DEFAULT 1,
    tick_size   NUMERIC(10, 2) DEFAULT 0.05,
    circuit_pct NUMERIC(5, 2) DEFAULT 20.00,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Traders (participants)
CREATE TABLE IF NOT EXISTS traders (
    id          SERIAL PRIMARY KEY,
    trader_id   VARCHAR(50) UNIQUE NOT NULL,
    name        VARCHAR(100) NOT NULL,
    balance     NUMERIC(15, 2) DEFAULT 1000000.00,
    is_bot      BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
    id            SERIAL PRIMARY KEY,
    order_id      VARCHAR(36) UNIQUE NOT NULL,
    scrip         VARCHAR(20) NOT NULL REFERENCES scrips(symbol),
    trader_id     VARCHAR(50) NOT NULL REFERENCES traders(trader_id),
    side          VARCHAR(4) NOT NULL CHECK (side IN ('BUY', 'SELL')),
    order_type    VARCHAR(10) NOT NULL CHECK (order_type IN ('MARKET', 'LIMIT', 'SL', 'SL_M')),
    quantity      INTEGER NOT NULL CHECK (quantity > 0),
    price         NUMERIC(10, 2) NOT NULL DEFAULT 0,
    trigger_price NUMERIC(10, 2) DEFAULT 0,
    filled_qty    INTEGER DEFAULT 0,
    status        VARCHAR(10) DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'PARTIAL', 'FILLED', 'CANCELLED')),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Trades (every matched order pair)
CREATE TABLE IF NOT EXISTS trades (
    id         SERIAL PRIMARY KEY,
    trade_id   VARCHAR(36) UNIQUE NOT NULL,
    scrip      VARCHAR(20) NOT NULL REFERENCES scrips(symbol),
    buy_order  VARCHAR(36) NOT NULL REFERENCES orders(order_id),
    sell_order VARCHAR(36) NOT NULL REFERENCES orders(order_id),
    price      NUMERIC(10, 2) NOT NULL,
    quantity   INTEGER NOT NULL,
    traded_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Price history (OHLCV candles, 1-min default)
CREATE TABLE IF NOT EXISTS price_history (
    id         SERIAL PRIMARY KEY,
    scrip      VARCHAR(20) NOT NULL REFERENCES scrips(symbol),
    open       NUMERIC(10, 2),
    high       NUMERIC(10, 2),
    low        NUMERIC(10, 2),
    close      NUMERIC(10, 2),
    volume     BIGINT DEFAULT 0,
    candle_time TIMESTAMPTZ NOT NULL,
    UNIQUE(scrip, candle_time)
);

-- Market depth history snapshots
CREATE TABLE IF NOT EXISTS market_depth_snapshots (
    id          SERIAL PRIMARY KEY,
    scrip       VARCHAR(20) NOT NULL REFERENCES scrips(symbol),
    snapshot_time TIMESTAMPTZ DEFAULT NOW(),
    bids        JSONB NOT NULL,
    asks        JSONB NOT NULL
);

-- Seed: NIFTY 50 top 10 scrips for MVP
INSERT INTO scrips (symbol, name) VALUES
    ('RELIANCE',  'Reliance Industries Ltd'),
    ('TCS',       'Tata Consultancy Services'),
    ('HDFCBANK',  'HDFC Bank Ltd'),
    ('INFY',      'Infosys Ltd'),
    ('ICICIBANK', 'ICICI Bank Ltd'),
    ('HINDUNILVR','Hindustan Unilever Ltd'),
    ('SBIN',      'State Bank of India'),
    ('BHARTIARTL','Bharti Airtel Ltd'),
    ('KOTAKBANK', 'Kotak Mahindra Bank Ltd'),
    ('ITC',       'ITC Ltd')
ON CONFLICT (symbol) DO NOTHING;

-- Seed: one human trader + two bots
INSERT INTO traders (trader_id, name, balance, is_bot) VALUES
    ('trader_human', 'You',           1000000.00, FALSE),
    ('bot_mm_01',    'Market Maker',  5000000.00, TRUE),
    ('bot_retail_01','Retail Bot',     500000.00, TRUE)
ON CONFLICT (trader_id) DO NOTHING;