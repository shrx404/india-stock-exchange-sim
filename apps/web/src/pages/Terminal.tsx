import { useState, useCallback, useEffect, useRef } from "react";
import { OrderBook } from "../components/OrderBook/OrderBook";
import { OrderForm } from "../components/OrderForm/OrderForm";
import { CandleChart } from "../components/Chart/CandleChart";
import { MarketWatch } from "../components/MarketWatch/MarketWatch";
import { Portfolio } from "../components/Portfolio/Portfolio";
import { useWebSocket } from "../hooks/useWebSocket";
import type {
  PlaceOrderResponse,
  PortfolioPosition,
  WsTradeEvent,
} from "../types/exchange";

/* ---------------------------------------------------------------
   Portfolio state management — derives positions from fill events
--------------------------------------------------------------- */
interface FillEntry {
  scrip: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
}

const buildPositions = (
  fills: FillEntry[],
  snapshots: Record<string, { ltp: number | null }>,
): PortfolioPosition[] => {
  // Track qty, average price, and realized profit separately
  const map: Record<
    string,
    { qty: number; avgPrice: number; realizedPnl: number }
  > = {};

  for (const f of fills) {
    if (!map[f.scrip]) map[f.scrip] = { qty: 0, avgPrice: 0, realizedPnl: 0 };
    const pos = map[f.scrip];

    if (f.side === "BUY") {
      // Standard moving average calculation
      const totalCost = pos.qty * pos.avgPrice + f.qty * f.price;
      pos.qty += f.qty;
      pos.avgPrice = totalCost / pos.qty;
    } else if (f.side === "SELL") {
      // Calculate locked-in profit
      const profit = (f.price - pos.avgPrice) * f.qty;
      pos.realizedPnl += profit;
      pos.qty -= f.qty;

      // Safety reset if quantity hits 0
      if (pos.qty === 0) {
        pos.avgPrice = 0;
      }
    }
  }

  return (
    Object.entries(map)
      // Keep positions if you hold shares OR if you made/lost locked-in money on them
      .filter(([, v]) => v.qty > 0 || v.realizedPnl !== 0)
      .map(([scrip, v]) => {
        const ltp = snapshots[scrip]?.ltp ?? null;

        // Unrealized PNL is ONLY calculated on the shares you still own
        const unrealizedPnl = ltp != null ? (ltp - v.avgPrice) * v.qty : 0;

        // Total PNL = Paper Profit (Unrealized) + Locked Profit (Realized)
        const totalPnl = unrealizedPnl + v.realizedPnl;

        return {
          scrip,
          netQty: v.qty,
          avgPrice: v.avgPrice,
          ltp,
          pnl: parseFloat(totalPnl.toFixed(2)),
          realizedPnl: parseFloat(v.realizedPnl.toFixed(2)), // Pass this to the UI!
        };
      })
  );
};

/* ---------------------------------------------------------------
   Terminal page
--------------------------------------------------------------- */
const TRADER_ID = "trader_human";

export const Terminal = () => {
  const [activeScrip, setActiveScrip] = useState("RELIANCE");
  const [fills, setFills] = useState<FillEntry[]>([]);

  const { snapshots, tradeEvents, candleEvents, connected } = useWebSocket();

  // Build trade log from WS trade events (bot + human trades)
  const log: WsTradeEvent[] = tradeEvents.slice(0, 40);

  // Compute positions from human fills
  const positions = buildPositions(fills, snapshots);

  const processedTradeIds = useRef(new Set<string>());

  useEffect(() => {
    const newFills: FillEntry[] = [];
    for (const t of tradeEvents) {
      if (!processedTradeIds.current.has(t.trade_id)) {
        processedTradeIds.current.add(t.trade_id);
        if (t.buyer_id === TRADER_ID) {
          newFills.push({
            scrip: t.scrip,
            side: "BUY",
            qty: t.quantity,
            price: t.price,
          });
        }
        if (t.seller_id === TRADER_ID) {
          newFills.push({
            scrip: t.scrip,
            side: "SELL",
            qty: t.quantity,
            price: t.price,
          });
        }
      }
    }
    if (newFills.length > 0) {
      setFills((prev) => [...prev, ...newFills]);
    }
  }, [tradeEvents]);

  const handleTraded = useCallback(
    (res: PlaceOrderResponse, scrip: string, side: "BUY" | "SELL") => {
      // Trades are now handled entirely via the WebSocket event stream.
      // This ensures that limit orders filled later also update the portfolio.
    },
    [],
  );

  const activeSnapshot = snapshots[activeScrip] ?? null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "#0a0a0a",
      }}
    >
      {/* ── Top bar: logo + WS status ────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 16px",
          borderBottom: "1px solid #1a1a1a",
          background: "#060606",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            color: "#f0c040",
            fontWeight: 800,
            fontSize: 13,
            letterSpacing: 1,
          }}
        >
          🇮🇳 INDIA EXCHANGE SIM
        </span>
        <span
          style={{
            fontSize: 9,
            padding: "2px 8px",
            borderRadius: 10,
            background: connected ? "#0d1f15" : "#1f0d0d",
            color: connected ? "#3ddc84" : "#f05050",
            letterSpacing: 0.5,
          }}
        >
          {connected ? "● LIVE" : "○ DISCONNECTED"}
        </span>
        <span style={{ marginLeft: "auto", color: "#333", fontSize: 10 }}>
          v0.2.0 · NSE Simulator
        </span>
      </div>

      {/* ── Market watch scrip tabs ──────────────────────────── */}
      <MarketWatch activeScrip={activeScrip} onSelect={setActiveScrip} />

      {/* ── Main workspace ──────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", gap: 1 }}>
        {/* Left column: order book */}
        <div
          style={{
            width: 260,
            flexShrink: 0,
            borderRight: "1px solid #1a1a1a",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <OrderBook scrip={activeScrip} snapshot={activeSnapshot} />
        </div>

        {/* Center: chart + order form */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
          }}
        >
          {/* Chart fills available vertical space */}
          <CandleChart scrip={activeScrip} candleEvents={candleEvents} />

          <div
            style={{
              flexShrink: 0,
              borderTop: "1px solid #1a1a1a",
            }}
          >
            <OrderForm
              scrip={activeScrip}
              sessionState={activeSnapshot?.session_state || "OPEN"}
              onTraded={(res, side) => handleTraded(res, activeScrip, side)}
            />
          </div>
        </div>

        {/* Right column: trade log */}
        <div
          style={{
            width: 240,
            flexShrink: 0,
            borderLeft: "1px solid #1a1a1a",
            overflowY: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 0,
          }}
        >
          <div
            style={{
              color: "#444",
              fontSize: 10,
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            TRADE LOG
          </div>
          {log.length === 0 ? (
            <div style={{ color: "#222", fontSize: 11 }}>
              Waiting for trades…
            </div>
          ) : (
            log.map((t, i) => (
              <div
                key={i}
                style={{
                  padding: "5px 0",
                  borderBottom: "1px solid #111",
                  fontSize: 11,
                }}
              >
                <span style={{ color: "#555", fontSize: 9, marginRight: 4 }}>
                  {t.scrip}
                </span>
                <span style={{ color: "#3ddc84" }}>
                  {t.quantity} @ ₹{t.price.toFixed(2)}
                </span>
                <div style={{ color: "#333", fontSize: 9, marginTop: 1 }}>
                  {t.buyer_id.replace("bot_", "")} ←{" "}
                  {t.seller_id.replace("bot_", "")}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Portfolio bar at bottom ──────────────────────────── */}
      <Portfolio positions={positions} />
    </div>
  );
};
