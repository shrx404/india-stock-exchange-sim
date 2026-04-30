# India Exchange Sim - Project Plan

## 🟢 Done
- **Infrastructure:**
  - Monorepo structure (`india-exchange-sim/`) with `apps/engine` and `apps/web`
  - PostgreSQL 16 running in Docker with full schema
- **Matching Engine:**
  - Order and Trade models
  - OrderBook (CLOB with max-heap bids, min-heap asks)
  - Matcher (multi-scrip router)
  - FastAPI server with REST endpoints and WebSocket broadcaster
- **Frontend:**
  - Vite + TypeScript setup
  - WebSocket connection hook (`useWebSocket`)
  - OrderBook component
  - OrderForm component
  - Main App wireframe
  - ✅ Fixed white screen (`import type` for all interface imports; `verbatimModuleSyntax: true` requires it)

## 🟡 In Progress
- Nothing actively in progress

## 🔴 To Do (Next Steps)
1. **Simulation Agents:**
   - Market maker bots to keep the order book alive with liquidity
   - Retail bots to place random orders
2. **Database Persistence:**
   - Write trades and orders from memory to PostgreSQL
3. **Frontend Features:**
   - Candlestick chart (TradingView Lightweight Charts)
   - Portfolio / holdings view (P&L tracking)
   - Order history table
   - Market watch panel (LTP + change %)
4. **Infrastructure Polish:**
   - Engine Dockerfile
   - Full stack `docker-compose.yml` (run everything with one command)
   - `.env` wiring between frontend and engine
