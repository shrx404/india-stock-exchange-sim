from dataclasses import dataclass
from datetime import time
from dotenv import load_dotenv
import os

load_dotenv()

@dataclass
class MarketConfig:
    PRE_OPEN_START = time(9, 0)
    PRE_OPEN_END   = time(9, 15)
    MARKET_OPEN    = time(9, 15)
    MARKET_CLOSE   = time(15, 30)

    TICK_SIZE      = 0.05
    LOT_SIZE       = 1
    CIRCUIT_LIMITS = [0.10, 0.15, 0.20]

DATABASE_URL = os.getenv("DATABASE_URL")
HOST         = os.getenv("HOST", "0.0.0.0")
PORT         = int(os.getenv("PORT", 8000))

MARKET = MarketConfig()
SIM_SPEED_MULTIPLIER = 1.0

# Quick sanity check
if __name__ == "__main__":
    print(f"DB  → {DATABASE_URL}")
    print(f"API → {HOST}:{PORT}")
    # Expected:
    # DB  → postgresql+asyncpg://exchange_user:exchange_pass@localhost:5432/exchange_sim
    # API → 0.0.0.0:8000