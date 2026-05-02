"""
fetch_bhavcopy.py
-----------------
Fetches historical end-of-day OHLCV prices for the 10 seeded scrips.
Note: NSE Bhavcopy archives are often rate-limited or return 404s for recent dates,
so this script uses the Yahoo Finance public chart API as a reliable fallback
to download the exact same daily data (simulating the bhavcopy format).

Usage:
    python data/fetch_bhavcopy.py [--days 30]

Output:
    data/processed/prices.json (aggregated OHLCV per scrip, newest-first)
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
import urllib.request
import urllib.error

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
PROCESSED_DIR = BASE_DIR / "processed"
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

# Add the engine app to sys.path so we can reuse scrip_metadata
ENGINE_DIR = BASE_DIR.parent / "apps" / "engine"
sys.path.insert(0, str(ENGINE_DIR))

from core.scrip_metadata import SCRIP_METADATA
TARGET_SCRIPS: list[str] = list(SCRIP_METADATA.keys())

def fetch_yfinance_history(scrip: str, days: int) -> list[dict]:
    """Fetch historical daily OHLCV from Yahoo Finance."""
    # Convert days to a rough range string (e.g., "1mo", "3mo")
    if days <= 30:
        rng = "1mo"
    elif days <= 90:
        rng = "3mo"
    elif days <= 180:
        rng = "6mo"
    else:
        rng = "1y"

    url = f"https://query2.finance.yahoo.com/v8/finance/chart/{scrip}.NS?range={rng}&interval=1d"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            result = data.get("chart", {}).get("result", [])
            if not result:
                return []
            
            chart = result[0]
            timestamps = chart.get("timestamp", [])
            indicators = chart.get("indicators", {}).get("quote", [{}])[0]
            
            opens = indicators.get("open", [])
            highs = indicators.get("high", [])
            lows = indicators.get("low", [])
            closes = indicators.get("close", [])
            volumes = indicators.get("volume", [])
            
            candles = []
            for i in range(len(timestamps)):
                if opens[i] is None: continue # Skip missing data days
                
                # Yahoo Finance provides current day, we also calculate prev_close
                prev_close = closes[i-1] if i > 0 else closes[i]
                
                dt = datetime.fromtimestamp(timestamps[i])
                candles.append({
                    "date": dt.strftime("%Y-%m-%d"),
                    "open": round(opens[i], 2),
                    "high": round(highs[i], 2),
                    "low": round(lows[i], 2),
                    "close": round(closes[i], 2),
                    "prev_close": round(prev_close, 2),
                    "volume": volumes[i],
                })
            
            # We want newest-first, and limit to 'days'
            candles.sort(key=lambda x: x["date"], reverse=True)
            return candles[:days]
            
    except Exception as e:
        print(f"  [err] Failed to fetch {scrip}: {e}")
        return []

def main():
    parser = argparse.ArgumentParser(description="Fetch Historical Prices")
    parser.add_argument("--days", type=int, default=30,
                        help="Number of past trading days to download (default: 30)")
    args = parser.parse_args()

    print(f"Fetching last {args.days} trading days of data...")
    
    aggregated: dict[str, list[dict]] = {s: [] for s in TARGET_SCRIPS}

    for scrip in TARGET_SCRIPS:
        print(f"  Fetching {scrip}...")
        candles = fetch_yfinance_history(scrip, args.days)
        if candles:
            aggregated[scrip] = candles
        time.sleep(1)  # polite delay

    out_path = PROCESSED_DIR / "prices.json"
    out_path.write_text(json.dumps(aggregated, indent=2))
    print(f"\n[OK] Saved processed prices to {out_path}")

    # Summary
    print("\nScrip summary (most recent close):")
    print(f"  {'SCRIP':<15} {'CLOSE':>10}  {'DATE'}")
    print(f"  {'-'*15} {'-'*10}  {'-'*12}")
    for scrip in sorted(aggregated):
        rows = aggregated[scrip]
        if rows:
            r = rows[0]
            print(f"  {scrip:<15} {r['close']:>10.2f}  {r['date']}")
        else:
            print(f"  {scrip:<15} {'N/A':>10}  ---")

if __name__ == "__main__":
    main()
