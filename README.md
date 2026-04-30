# India Exchange Sim

A full-stack, high-performance mock trading exchange designed to simulate an Indian stock market environment (e.g., NSE). This project provides a real-time order matching engine, persistent trade storage, and a feature-rich React frontend with live market data, interactive candlestick charts, and portfolio tracking.

## Features

*   **Matching Engine:** Written in Python (FastAPI). Implements a Central Limit Order Book (CLOB) with price-time priority matching.
*   **Live Market Simulation:** Includes background market maker bots that provide continuous liquidity (bid/ask ladders) and retail bots that generate random order flow.
*   **Real-time Updates:** Order book snapshots and trade events are broadcast to the frontend via WebSockets.
*   **Database Persistence:** Asynchronous SQLAlchemy ORM writes trades and order history to PostgreSQL.
*   **Frontend Terminal:** A modern, dark-themed trading terminal built with React and Vite.
    *   **Market Watch:** Live LTP and percentage change for active scrips.
    *   **Interactive Charting:** Real-time 1-minute candlestick charts powered by TradingView Lightweight Charts.
    *   **Order Book Depth:** Visual representation of market depth (bids and asks).
    *   **Portfolio Tracking:** Automatic calculation of net positions and P&L based on trade fills.

## Project Structure

This is a monorepo containing two main applications:

*   `apps/engine/`: The Python FastAPI matching engine and simulation environment.
*   `apps/web/`: The React (Vite) frontend application.

## Prerequisites

*   Docker and Docker Compose
*   Node.js 20+ (for running the frontend locally without Docker, though a Docker option is provided)
*   Python 3.12+ (for running the engine locally without Docker)

## Quick Start (Docker Compose)

The easiest way to run the entire stack (Database, Engine, and Frontend) is using Docker Compose:

1.  Clone the repository and navigate to the project root.
2.  Start the services:
    ```bash
    docker compose up -d
    ```
3.  Access the applications:
    *   **Trading Terminal (Frontend):** [http://localhost:5173](http://localhost:5173)
    *   **Engine API Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)

## Manual Setup

If you prefer to run the components manually without Docker for development:

### 1. Database

You'll need a PostgreSQL database running. You can use the provided docker-compose just for the database:

```bash
docker compose up -d db
```

### 2. Engine (Backend)

Navigate to the `apps/engine` directory:

```bash
cd apps/engine
# Create a virtual environment
python -m venv .venv
source .venv/bin/activate  # Or .venv\Scripts\activate on Windows
# Install dependencies
pip install -r requirements.txt
# Run the server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Web (Frontend)

Navigate to the `apps/web` directory:

```bash
cd apps/web
# Install dependencies
npm install
# Start the development server
npm run dev
```

## Technologies Used

*   **Backend:** Python, FastAPI, SQLAlchemy (Async), PostgreSQL
*   **Frontend:** React, TypeScript, Vite, TradingView Lightweight Charts
*   **Infrastructure:** Docker, Docker Compose
