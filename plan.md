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
  - [x] Store the previous day's closing price for each scrip in the database/memory.
  - [x] Implement a pre-trade check in the Matcher to verify if an incoming order breaches the ±20% threshold.
  - [x] Create a `MarketHalt` state in the engine that pauses trading for a specific scrip (or globally) and rejects/queues new orders.
  - [x] Broadcast circuit breaker status via WebSocket to show a "HALTED" badge on the frontend.

- **2.4 Pre-Open Call Auction**
  - [x] Implement a `MarketSession` state machine (e.g., `PRE_OPEN`, `OPEN`, `CLOSED`).
  - [x] Modify the OrderBook to accept orders without matching them when in `PRE_OPEN` state.
  - [x] Write the equilibrium price discovery algorithm (find the price point that maximizes executable volume).
  - [x] Implement the mass execution logic: match all eligible orders at the exact equilibrium price, then transition state to `OPEN`.

- **2.5 Market Depth History**
  - [x] Create a `MarketDepthSnapshot` database table.
  - [x] Implement a cron-like timer in FastAPI to serialize the top 5 levels of the OrderBook for all scrips every 30 seconds.
  - [x] Write an async bulk-insert operation to persist these snapshots without blocking the matching engine.

### Phase 3 — UI/UX Overhaul & Grid Re-architecture

**Senior UI Designer's Preamble:** The current interface has a disjointed user journey. Key components are floating, blocking data, and large segments of screen real estate (especially on the right and bottom) are dead space. We need a modern, professional trading-terminal layout based on a unified grid system. We will re-establish a Master-Detail relationship for component interaction.

**Design Principles:**

1. Eliminate Floating Widgets: All components are fixed and docked. The Order Form must not block data.
2. Unified Information Hierarchy: Clear visual distinction from Market View (generic) to Specific View (selected stock).
3. Maximum Screen Utilization: A fixed footer uses the dead space below the portfolio. Expanding chart/tools to use the full width.

**Visual Layout Proposal:**

```text
+-------------------------------------------------+
|               A. Header / Market Watch          |
+-------------------------------------------------+
|                       | B. Market Depth (TOP5)  |
|                       | (Docked Right)          |
|    D. Main Chart      +-------------------------+
| (Selected Stock View) | C. Order Form           |
|                       | (Docked Right)          |
|                       | (Logic: View depth, then|
|                       | place order)            |
+-----------------------+-------------------------+
| E. Portfolio/Holdings | F. Trade Log            |
| (Docked Bottom-Left)  | (Docked Bottom-Right)   |
+-------------------------------------------------+
```

**Actionable Tasks:**

**3.1 Grid System & Component Re-Architecture**

- [x] Implement a 2 or 3-column responsive grid layout system.
- [x] Re-engineer the floating C. Order Form into a fixed, docked widget on the right side of the screen, logical proximity to the B. Market Depth.
- [x] Move and expand E. Portfolio and F. Trade Log side-by-side as a unified footer block, utilizing the large dead space at the bottom right.

**3.2 Component Densification & Redesign**

- [x] Refactor A. Header into a compact, data-dense ticker bar, removing redundant stock names and optimizing label positions.
- [x] New Feature Priority: Master Scrip View. Redesign the D. Main Chart wrapper (TradingView LWC) to default to a clean whole stock price history view. Personal holding entry prices are represented as distinct, labeled horizontal price lines on the Y-axis. This ensures the user sees the stock's overall value, with positions simply overlaid as key reference points.
- [x] Redesign B. Market Depth (Order Book) into a compact table with improved typography. Integrate a visual gradient on the quantity column for immediate liquidity assessment.
- [x] Optimize typography in F. Trade Log, clustering recent trades by type and potentially adding filtering options.

---

### Phase 4 — Data & Seeding

**4.1 Real NSE Historical Prices**

- [ ] Write a standalone script to download and parse NSE Bhavcopy CSVs.
- [ ] Create a seeding utility to populate the price_history database table with this reference data.
- [ ] Update the engine's initialization sequence to load these base prices to set the starting point for agents.

**4.2 Expand to NIFTY 50**

- [ ] Create a scrip_metadata JSON or config file defining all 50 scrips, their sector, correct lot sizes, and tick sizes.
- [ ] Update the Order model and OrderForm validation to strictly enforce lot size and tick size increments.
- [ ] Scale up the simulation agents to monitor and trade across all 50 order books.

**4.3 Corporate Action Handling**

- [ ] Create a database table for corporate_actions (Ex-date, type: split/bonus/dividend, ratio/amount).
- [ ] Write a utility function to apply a mathematical adjustment factor to historical data and reference prices when an ex-date is crossed.

---

### Phase 5 — Frontend Polish (Lowest Priority)

**5.1 Chart Indicators**

- [x] Configure TradingView Lightweight Charts to add a secondary line series for VWAP.
- [x] Add a histogram series at the bottom of the chart pane for Volume bars.
- [x] Calculate and display EMA 9 and EMA 21 overlays on the frontend.

**5.2 Order History Table**

- [ ] Create a REST endpoint /api/users/orders to fetch historical orders with pagination.
- [ ] Build the React table component with sorting and status badges (Filled, Partial, Canceled).
- [ ] Calculate and display per-trade P&L based on average fill price vs current LTP.

**5.3 Market Depth Replay**

- [ ] Build a timeline scrubber/slider UI component.
- [ ] Create a REST endpoint /api/depth/snapshot?timestamp=X to fetch specific historical states.
- [ ] Wire the UI to disconnect the live WebSocket and render the fetched historical depth data when scrubbing.

**5.4 Simulation Speed Control**

- [ ] Implement a global SIM_SPEED_MULTIPLIER in the engine.
- [ ] Link the multiplier to agent sleep() or delay() functions (e.g., 10x speed divides delays by 10).
- [ ] Add a 1x/5x/10x toggle UI on the frontend that triggers an admin REST endpoint to adjust the multiplier.

**5.5 Session Summary**

- [ ] Write an aggregation query/endpoint to calculate EOD stats (total volume, biggest gainer/loser).
- [ ] Build an End-of-Day modal summary screen that displays global market stats and the user's realized/unrealized P&L.

---

### North Star

A standalone Indian equity market simulation that is indistinguishable from a real NSE trading day — realistic price discovery, genuine order flow from diverse agent personalities, correct market microstructure, and a clean trading terminal to interact with it.
