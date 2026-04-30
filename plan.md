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

- **2.1 OHLCV Candle Builder**
  - [x] Create an in-memory `CandleAggregator` to bucket real-time trades into 1-minute intervals (Open, High, Low, Close, Volume).
  - [x] Implement an async background task to persist completed 1-min candles to the `price_history` Postgres table.
  - [x] Add a WebSocket topic (`candles.{scrip}`) to broadcast live candle updates to the frontend chart.

- **2.2 VWAP Calculation**
  - [x] Add running variables for `cumulative_typical_price_volume` and `cumulative_volume` per scrip to the `TradeStore`.
  - [x] Update VWAP calculation on every executed trade.
  - [x] Expose live VWAP via REST/WebSocket for the Mean Reversion agents and frontend charting.

- **2.3 Circuit Breakers**
  - [ ] Store the previous day's closing price for each scrip in the database/memory.
  - [ ] Implement a pre-trade check in the Matcher to verify if an incoming order breaches the ±20% threshold.
  - [ ] Create a `MarketHalt` state in the engine that pauses trading for a specific scrip (or globally) and rejects/queues new orders.
  - [ ] Broadcast circuit breaker status via WebSocket to show a "HALTED" badge on the frontend.

- **2.4 Pre-Open Call Auction**
  - [ ] Implement a `MarketSession` state machine (e.g., `PRE_OPEN`, `OPEN`, `CLOSED`).
  - [ ] Modify the OrderBook to accept orders without matching them when in `PRE_OPEN` state.
  - [ ] Write the equilibrium price discovery algorithm (find the price point that maximizes executable volume).
  - [ ] Implement the mass execution logic: match all eligible orders at the exact equilibrium price, then transition state to `OPEN`.

- **2.5 Market Depth History**
  - [ ] Create a `MarketDepthSnapshot` database table.
  - [ ] Implement a cron-like timer in FastAPI to serialize the top 5 levels of the OrderBook for all scrips every 30 seconds.
  - [ ] Write an async bulk-insert operation to persist these snapshots without blocking the matching engine.

### Phase 3 — Data & Seeding

- **3.1 Real NSE Historical Prices**
  - [ ] Write a standalone script to download and parse NSE Bhavcopy CSVs.
  - [ ] Create a seeding utility to populate the `price_history` database table with this reference data.
  - [ ] Update the engine's initialization sequence to load these base prices to set the starting point for agents.

- **3.2 Expand to NIFTY 50**
  - [ ] Create a `scrip_metadata` JSON or config file defining all 50 scrips, their sector, correct lot sizes, and tick sizes.
  - [ ] Update the `Order` model and `OrderForm` validation to strictly enforce lot size and tick size increments.
  - [ ] Scale up the simulation agents to monitor and trade across all 50 order books.

- **3.3 Corporate Action Handling**
  - [ ] Create a database table for `corporate_actions` (Ex-date, type: split/bonus/dividend, ratio/amount).
  - [ ] Write a utility function to apply a mathematical adjustment factor to historical data and reference prices when an ex-date is crossed.

### Phase 4 — Frontend Polish (Lowest Priority)

- **4.1 Chart Indicators**
  - [ ] Configure TradingView Lightweight Charts to add a secondary line series for VWAP.
  - [ ] Add a histogram series at the bottom of the chart pane for Volume bars.
  - [ ] Calculate and display EMA 9 and EMA 21 overlays on the frontend.

- **4.2 Order History Table**
  - [ ] Create a REST endpoint `/api/users/orders` to fetch historical orders with pagination.
  - [ ] Build the React table component with sorting and status badges (Filled, Partial, Canceled).
  - [ ] Calculate and display per-trade P&L based on average fill price vs current LTP.

- **4.3 Market Depth Replay**
  - [ ] Build a timeline scrubber/slider UI component.
  - [ ] Create a REST endpoint `/api/depth/snapshot?timestamp=X` to fetch specific historical states.
  - [ ] Wire the UI to disconnect the live WebSocket and render the fetched historical depth data when scrubbing.

- **4.4 Simulation Speed Control**
  - [ ] Implement a global `SIM_SPEED_MULTIPLIER` in the engine.
  - [ ] Link the multiplier to agent `sleep()` or `delay()` functions (e.g., 10x speed divides delays by 10).
  - [ ] Add a 1x/5x/10x toggle UI on the frontend that triggers an admin REST endpoint to adjust the multiplier.

- **4.5 Session Summary**
  - [ ] Write an aggregation query/endpoint to calculate EOD stats (total volume, biggest gainer/loser).
  - [ ] Build an End-of-Day modal summary screen that displays global market stats and the user's realized/unrealized P&L.

---

## North Star

A standalone Indian equity market simulation that is indistinguishable
from a real NSE trading day — realistic price discovery, genuine
order flow from diverse agent personalities, correct market microstructure,
and a clean trading terminal to interact with it.
