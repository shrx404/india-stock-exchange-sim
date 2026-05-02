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
  const map: Record<
    string,
    { qty: number; avgPrice: number; realizedPnl: number }
  > = {};

  for (const f of fills) {
    if (!map[f.scrip]) map[f.scrip] = { qty: 0, avgPrice: 0, realizedPnl: 0 };
    const pos = map[f.scrip];

    if (f.side === "BUY") {
      const totalCost = pos.qty * pos.avgPrice + f.qty * f.price;
      pos.qty += f.qty;
      pos.avgPrice = totalCost / pos.qty;
    } else if (f.side === "SELL") {
      const profit = (f.price - pos.avgPrice) * f.qty;
      pos.realizedPnl += profit;
      pos.qty -= f.qty;
      if (pos.qty === 0) pos.avgPrice = 0;
    }
  }

  return Object.entries(map)
    .filter(([, v]) => v.qty > 0 || v.realizedPnl !== 0)
    .map(([scrip, v]) => {
      const ltp = snapshots[scrip]?.ltp ?? null;
      // unrealizedPnl: mark-to-market on open qty only
      const unrealizedPnl = ltp != null ? (ltp - v.avgPrice) * v.qty : 0;
      // totalPnl = unrealized + realized — this is what goes into `pnl`
      const totalPnl = unrealizedPnl + v.realizedPnl;
      return {
        scrip,
        netQty: v.qty,
        avgPrice: v.avgPrice,
        ltp,
        pnl: parseFloat(totalPnl.toFixed(2)), // Total P&L (unrealized + realized)
        realizedPnl: parseFloat(v.realizedPnl.toFixed(2)), // Closed-trade profit only
      } satisfies PortfolioPosition;
    });
};

/* ---------------------------------------------------------------
   Trade Log Sidebar — collapsible panel (LEFT side)
--------------------------------------------------------------- */
const LOG_WIDTH_OPEN = 360;
const LOG_WIDTH_CLOSED = 28;

interface TradeLogSidebarProps {
  log: WsTradeEvent[];
  traderId: string;
  isOpen: boolean;
  onToggle: () => void;
}

const TradeLogSidebar = ({
  log,
  traderId,
  isOpen,
  onToggle,
}: TradeLogSidebarProps) => {
  return (
    <div
      style={{
        width: isOpen ? LOG_WIDTH_OPEN : LOG_WIDTH_CLOSED,
        flexShrink: 0,
        borderRight: "1px solid #1a1a1a",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "#080808",
        transition: "width 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        position: "relative",
      }}
    >
      {/* Toggle tab on right edge */}
      <button
        onClick={onToggle}
        title={isOpen ? "Collapse log" : "Expand log"}
        style={{
          position: "absolute",
          top: "50%",
          right: 0,
          transform: "translateY(-50%)",
          zIndex: 10,
          width: 14,
          height: 48,
          background: "#1a1a1a",
          border: "none",
          borderLeft: "1px solid #2a2a2a",
          borderRadius: "3px 0 0 3px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          color: "#555",
          fontSize: 8,
          transition: "background 0.15s, color 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "#252525";
          (e.currentTarget as HTMLButtonElement).style.color = "#888";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "#1a1a1a";
          (e.currentTarget as HTMLButtonElement).style.color = "#555";
        }}
      >
        {isOpen ? "‹" : "›"}
      </button>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: isOpen ? "8px 12px 8px 10px" : "8px 0",
          borderBottom: "1px solid #1a1a1a",
          flexShrink: 0,
          minHeight: 34,
          justifyContent: isOpen ? "flex-start" : "center",
          overflow: "hidden",
        }}
      >
        {isOpen ? (
          <span
            style={{
              color: "#444",
              fontSize: 10,
              letterSpacing: 1,
              fontWeight: 600,
            }}
          >
            TRADE LOG
          </span>
        ) : (
          <span
            style={{
              color: "#333",
              fontSize: 9,
              letterSpacing: 2,
              fontWeight: 600,
              writingMode: "vertical-rl",
              textOrientation: "mixed",
              transform: "rotate(180deg)",
              whiteSpace: "nowrap",
            }}
          >
            TRADE LOG
          </span>
        )}
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: isOpen ? "6px 12px" : 0,
          opacity: isOpen ? 1 : 0,
          transition: "opacity 0.15s",
          pointerEvents: isOpen ? "auto" : "none",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {log.length === 0 ? (
          <div style={{ color: "#222", fontSize: 11, paddingTop: 8 }}>
            Waiting for trades…
          </div>
        ) : (
          log.map((t, i) => (
            <div
              key={i}
              style={{
                padding: "3px 0",
                borderBottom: "1px solid #111",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <span
                  style={{
                    color: "#555",
                    fontSize: 10,
                    marginRight: 8,
                    fontWeight: 600,
                  }}
                >
                  {t.scrip}
                </span>
                <span
                  style={{
                    color:
                      t.buyer_id === traderId
                        ? "#3ddc84"
                        : t.seller_id === traderId
                          ? "#f05050"
                          : "#888",
                    fontFamily: "monospace",
                    fontSize: 11,
                  }}
                >
                  {t.quantity} @ ₹{t.price.toFixed(2)}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    color: t.buyer_id === traderId ? "#3ddc84" : "#444",
                    fontSize: 9,
                    fontFamily: "monospace",
                  }}
                >
                  {t.buyer_id.replace("bot_", "")}
                </span>
                <span style={{ color: "#333", fontSize: 8 }}>←</span>
                <span
                  style={{
                    color: t.seller_id === traderId ? "#f05050" : "#444",
                    fontSize: 9,
                    fontFamily: "monospace",
                  }}
                >
                  {t.seller_id.replace("bot_", "")}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

/* ---------------------------------------------------------------
   Terminal page
   Layout (horizontal root flex):
     ├── Left column  [top bar · market watch · workspace · portfolio]
     └── Right column [market depth — full 100vh, no toggle]
--------------------------------------------------------------- */
const TRADER_ID = "trader_human";
const DEPTH_WIDTH = 280;

export const Terminal = () => {
  const [activeScrip, setActiveScrip] = useState("RELIANCE");
  const [fills, setFills] = useState<FillEntry[]>([]);
  const [logOpen, setLogOpen] = useState(true);
  const [scripMetadata, setScripMetadata] = useState<Record<string, { sector: string, lot_size: number, tick_size: number }>>({});

  const { snapshots, tradeEvents, candleEvents, marketWatch, connected, subscribeScrip } = useWebSocket();

  // Notify engine whenever the user switches scrip — routes depth/candle to this client
  useEffect(() => {
    subscribeScrip(activeScrip);
  }, [activeScrip, subscribeScrip]);

  useEffect(() => {
    fetch('http://localhost:8000/scrips')
      .then(res => res.json())
      .then(data => setScripMetadata(data))
      .catch(err => console.error("Failed to load scrip metadata", err));
  }, []);

  const log: WsTradeEvent[] = tradeEvents.slice(0, 40);
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
    if (newFills.length > 0) setFills((prev) => [...prev, ...newFills]);
  }, [tradeEvents]);

  const handleTraded = useCallback(
    (_res: PlaceOrderResponse, _scrip: string, _side: "BUY" | "SELL") => {
      // Handled via WebSocket event stream
    },
    [],
  );

  const activeSnapshot = snapshots[activeScrip] ?? null;

  return (
    /* Root: horizontal flex — left content column + right depth column */
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "#0a0a0a",
      }}
    >
      {/* ══════════════════════════════════════════════════════
          LEFT COLUMN — everything except depth
      ══════════════════════════════════════════════════════ */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {/* Top bar */}
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

        {/* Market watch */}
        <MarketWatch activeScrip={activeScrip} onSelect={setActiveScrip} liveData={marketWatch} />

        {/* Main workspace */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Trade log sidebar — LEFT */}
          <TradeLogSidebar
            log={log}
            traderId={TRADER_ID}
            isOpen={logOpen}
            onToggle={() => setLogOpen((v) => !v)}
          />

          {/* Chart — CENTER */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              borderRight: "1px solid #1a1a1a",
            }}
          >
            <CandleChart
              scrip={activeScrip}
              candleEvents={candleEvents}
              position={positions.find((p) => p.scrip === activeScrip)}
            />
          </div>
        </div>

        {/* Portfolio footer */}
        <div
          style={{
            height: 200,
            flexShrink: 0,
            borderTop: "1px solid #1a1a1a",
            overflow: "hidden",
          }}
        >
          <Portfolio positions={positions} />
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          RIGHT COLUMN — Market Depth, full 100vh, no toggle
      ══════════════════════════════════════════════════════ */}
      <div
        style={{
          width: DEPTH_WIDTH,
          // flexShrink: 0,
          borderLeft: "1px solid #1a1a1a",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          // background: "#080808",
          height: "100vh",
        }}
      >
        {/* Order form */}
        <div
          style={{
            width: 260,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: "#0a0a0a",
            borderLeft: "1px solid #1a1a1a",
          }}
        >
          <OrderForm
            scrip={activeScrip}
            sessionState={activeSnapshot?.session_state || "OPEN"}
            lotSize={scripMetadata[activeScrip]?.lot_size || 1}
            tickSize={scripMetadata[activeScrip]?.tick_size || 0.05}
            onTraded={(res, side) => handleTraded(res, activeScrip, side)}
          />
        </div>
        {/* Header aligned with top bar height */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px",
            borderBottom: "1px solid #1a1a1a",
            flexShrink: 0,
            minHeight: 34,
            background: "#060606",
          }}
        >
          <span
            style={{
              color: "#444",
              fontSize: 10,
              letterSpacing: 1,
              fontWeight: 600,
            }}
          >
            MARKET DEPTH
          </span>
          <span style={{ color: "#2a2a2a", fontSize: 10 }}>{activeScrip}</span>
        </div>

        {/* OrderBook — fills all remaining height down to the very bottom */}
        <div style={{ flex: 1, overflow: "hidden", height: "100%" }}>
          <OrderBook scrip={activeScrip} snapshot={activeSnapshot} />
        </div>
      </div>
    </div>
  );
};
