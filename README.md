# India Exchange Sim

A fully self-contained Indian stock exchange simulation that runs locally. 

This project simulates a complete electronic market for 10 NIFTY scrips. It includes a matching engine that processes orders, maintains an order book, and executes trades, alongside a frontend application to view live market depth and place orders.

## Project Structure
- `apps/engine`: Python/FastAPI matching engine
- `apps/web`: React/TypeScript frontend
- `data`: Database and other infrastructure files

## Features (MVP Goal)
- **Live Order Book:** Real-time bids and asks using WebSockets.
- **Trading:** Place limit and market BUY/SELL orders.
- **Simulation Agents:** Market makers and retail bots to maintain liquidity.
- **Persistence:** All orders and trades are saved to a PostgreSQL database.
- **Portfolio Tracking:** Track P&L and holdings.

## Quick Start
*Instructions on how to start the app using Docker Compose will be added once the infrastructure is fully wired.*
