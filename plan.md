# India Exchange Sim - Project Plan

## 🟢 Done

- **Infrastructure:**
  - Monorepo structure (`india-exchange-sim/`) with `apps/engine` and `apps/web`
  - PostgreSQL 16 running in Docker with full schema
  - Engine Dockerfile
  - Full stack `docker-compose.yml` (run everything with one command)
  - `.env` wiring between frontend and engine
- **Matching Engine:**
  - Order and Trade models
  - OrderBook (CLOB with max-heap bids, min-heap asks)
  - Matcher (multi-scrip router)
  - FastAPI server with REST endpoints and WebSocket broadcaster
- **Simulation Agents (Advanced Personalities):**
  - **Base Architecture:** Config-driven `AgentConfig` and shared `BaseAgent` logic.
  - **Market Maker:** Dynamic bid/ask ladders with volatility-based spread adjustment and Iceberg (hidden qty) support.
  - **Retail Agent:** Organic noise with configurable aggression and reaction delays.
  - **Momentum Agent:** Trend-following logic using short-term trade history.
  - **Mean Reversion Agent:** Counter-trend logic using rolling VWAP deviations.
- **In-Memory Analytics Layer:**
  - **TradeStore:** Fast circular buffer for recent trade access.
  - **Analytics Engine:** Real-time metrics computation (VWAP) for agent decision-making.
- **Database Persistence:**
  - Write trades and orders from memory to PostgreSQL
- **Frontend:**
  - Vite + TypeScript setup
  - WebSocket connection hook (`useWebSocket`)
  - OrderBook component
  - OrderForm component
  - Main App wireframe
  - ✅ Fixed white screen (`import type` for all interface imports; `verbatimModuleSyntax: true` requires it)
  - Candlestick chart (TradingView Lightweight Charts)
  - Portfolio / holdings view (P&L tracking)
  - Trade log (Order history)
  - Market watch panel (LTP + change %)
  - Panic / Greed Cascade (1% moves trigger market flooding)
  - Volume Profile (Time-based activity multiplier simulation)
  - Correlated Scrip Moves (Sector peers nudged on >0.5% moves)

## 🟡 In Progress

- Nothing actively in progress

## 🔴 To Do (Next Steps)

### Phase 1 — Realistic Agent Behavior
**[COMPLETE]** All tasks for Phase 1 are done.

### Phase 2 — Market Structure Realism

- [ ] **OHLCV candle builder**
      Aggregate every trade into 1-min candles, persist to
      price_history table. Feed the candlestick chart live.

- [ ] **VWAP calculation**
      Compute real-time VWAP per scrip from trade stream.
      Used by mean-reversion agents and displayed on chart.

- [ ] **Circuit breakers**
      Per-scrip upper/lower circuit limits (±20% default).
      Trading halts automatically if breached.

- [ ] **Pre-open call auction**
      9:00–9:15 AM simulation — orders queue up, opening
      price discovered at max-volume price. Matches NSE exactly.

- [ ] **Market depth history**
      Store order book snapshots every 30 seconds to Postgres.
      Lets you replay how the book looked at any point in time.

### Phase 3 — Data & Seeding

- [ ] **Real NSE historical prices**
      Load Bhavcopy CSVs (free from NSE website) as seed prices.
      Agents use these as reference prices instead of synthetic ones.

- [ ] **All NIFTY 50 scrips**
      Expand from 10 to all 50 scrips with correct lot sizes,
      tick sizes, and sector groupings.

- [ ] **Corporate action handling**
      Dividends, splits, bonuses adjust reference prices correctly.
      Prevents chart gaps from looking unrealistic.

### Phase 4 — Frontend Polish (Lowest Priority)

- [ ] **Chart indicators**
      VWAP line, volume bars below candles, EMA 9/21 overlays.

- [ ] **Order history table**
      Full table of your past orders — status, fill price,
      time, P&L per trade.

- [ ] **Market depth replay**
      Scrubber to rewind and replay the order book at any
      past timestamp from stored snapshots.

- [ ] **Simulation speed control**
      1x / 5x / 10x speed toggle so you can fast-forward
      through slow market periods.

- [ ] **Session summary**
      End-of-day report — total volume, most active scrip,
      biggest mover, your P&L summary.

---

## North Star

A standalone Indian equity market simulation that is indistinguishable
from a real NSE trading day — realistic price discovery, genuine
order flow from diverse agent personalities, correct market microstructure,
and a clean trading terminal to interact with it.
