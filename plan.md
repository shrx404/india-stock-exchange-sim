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
- **Simulation Agents:**
  - Market maker bots to keep the order book alive with liquidity
  - Retail bots to place random orders
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

## 🟡 In Progress
- Nothing actively in progress

## 🔴 To Do (Next Steps)
- Add user authentication (Supabase or simple JWT)
- Add more scrips and real historical seed data
- Deploy to the cloud (Render/Vercel/AWS)
