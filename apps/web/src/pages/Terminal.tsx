import { useState, useCallback, useEffect, useMemo, useRef, memo, lazy, Suspense } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import { OrderBook } from "../components/OrderBook/OrderBook";
import { OrderForm } from "../components/OrderForm/OrderForm";
// import { CandleChart } from "../components/Chart/CandleChart";
import { MarketWatch } from "../components/MarketWatch/MarketWatch";
import { Portfolio } from "../components/Portfolio/Portfolio";
import { OrderHistory } from "../components/OrderHistory/OrderHistory";

const CandleChart = lazy(() => import("../components/Chart/CandleChart").then(m => ({ default: m.CandleChart })));
import { useWebSocket } from "../hooks/useWebSocket";
import { useThrottle } from "../hooks/useThrottle";
import type {
  PlaceOrderResponse,
  PortfolioPosition,
  WsTradeEvent,
  MarketWatchItem,
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
      const unrealizedPnl = ltp != null ? (ltp - v.avgPrice) * v.qty : 0;
      const totalPnl = unrealizedPnl + v.realizedPnl;
      return {
        scrip,
        netQty: v.qty,
        avgPrice: v.avgPrice,
        ltp,
        pnl: parseFloat(totalPnl.toFixed(2)),
        realizedPnl: parseFloat(v.realizedPnl.toFixed(2)),
      } satisfies PortfolioPosition;
    });
};

/* ---------------------------------------------------------------
   Virtualized Trade Log row — rendered only when visible
--------------------------------------------------------------- */
const TRADE_ROW_HEIGHT = 30;

interface TradeRowData {
  log: WsTradeEvent[];
  traderId: string;
}

const TradeRow = memo(
  ({ index, style, data }: ListChildComponentProps<TradeRowData>) => {
    const t = data.log[index];
    if (!t) return null;
    const myColor =
      t.buyer_id === data.traderId
        ? "#3ddc84"
        : t.seller_id === data.traderId
          ? "#f05050"
          : "#888";
    return (
      <div
        style={{
          ...style,
          padding: "3px 0",
          borderBottom: "1px solid #111",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          boxSizing: "border-box",
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
            style={{ color: myColor, fontFamily: "monospace", fontSize: 11 }}
          >
            {t.quantity} @ ₹{t.price.toFixed(2)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              color: t.buyer_id === data.traderId ? "#3ddc84" : "#444",
              fontSize: 9,
              fontFamily: "monospace",
            }}
          >
            {t.buyer_id.replace("bot_", "")}
          </span>
          <span style={{ color: "#333", fontSize: 8 }}>←</span>
          <span
            style={{
              color: t.seller_id === data.traderId ? "#f05050" : "#444",
              fontSize: 9,
              fontFamily: "monospace",
            }}
          >
            {t.seller_id.replace("bot_", "")}
          </span>
        </div>
      </div>
    );
  },
);

/* ---------------------------------------------------------------
   Trade Log Sidebar — collapsible panel (LEFT side)
   Virtualized via react-window; only visible rows rendered.
--------------------------------------------------------------- */
const LOG_WIDTH_OPEN   = 360;
const LOG_WIDTH_CLOSED = 28;

interface TradeLogSidebarProps {
  log: WsTradeEvent[];
  traderId: string;
  isOpen: boolean;
  onToggle: () => void;
}

const TradeLogSidebar = memo(function TradeLogSidebar({
  log,
  traderId,
  isOpen,
  onToggle,
}: TradeLogSidebarProps) {
  const listContainerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(400);

  useEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setListHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Stable item data object to avoid itemData prop identity changing every render
  const itemData = useMemo<TradeRowData>(
    () => ({ log, traderId }),
    [log, traderId],
  );

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
      {/* Toggle tab */}
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

      {/* Virtualized content */}
      <div
        ref={listContainerRef}
        style={{
          flex: 1,
          overflow: "hidden",
          opacity: isOpen ? 1 : 0,
          transition: "opacity 0.15s",
          pointerEvents: isOpen ? "auto" : "none",
          padding: isOpen ? "6px 12px 6px 10px" : 0,
          boxSizing: "border-box",
        }}
      >
        {log.length === 0 ? (
          <div style={{ color: "#222", fontSize: 11, paddingTop: 8 }}>
            Waiting for trades…
          </div>
        ) : (
          <FixedSizeList
            height={listHeight}
            itemCount={log.length}
            itemSize={TRADE_ROW_HEIGHT}
            width="100%"
            itemData={itemData}
            overscanCount={5}
          >
            {TradeRow}
          </FixedSizeList>
        )}
      </div>
    </div>
  );
});

/* ---------------------------------------------------------------
   Terminal page
   Layout (horizontal root flex):
     ├── Left column  [top bar · market watch · workspace · portfolio]
     └── Right column [market depth — full 100vh, no toggle]
--------------------------------------------------------------- */
const TRADER_ID  = "trader_human";
const DEPTH_WIDTH = 280;

export const Terminal = () => {
  const [activeScrip, setActiveScrip] = useState("RELIANCE");
  const [fills, setFills]             = useState<FillEntry[]>([]);
  const [logOpen, setLogOpen]         = useState(true);
  const [footerTab, setFooterTab]     = useState<'portfolio' | 'orders'>('portfolio');
  const [scripMetadata, setScripMetadata] = useState<
    Record<string, { sector: string; lot_size: number; tick_size: number }>
  >({});

  const { snapshots, tradeEvents, candleEvents, marketWatch, connected, subscribeScrip, seed } =
    useWebSocket();

  // Throttle the market-watch map to 2 fps before passing to MarketWatch.
  // Sub-100ms LTP flicker has no user value and defeats React.memo.
  const throttledMarketWatch = useThrottle<Record<string, MarketWatchItem>>(marketWatch, 2);

  // Notify engine whenever the user switches scrip — routes depth/candle to this client
  useEffect(() => {
    subscribeScrip(activeScrip);
  }, [activeScrip, subscribeScrip]);

  useEffect(() => {
    // 1. Load scrip metadata
    fetch("http://localhost:8000/scrips")
      .then((res) => res.json())
      .then((data) => setScripMetadata(data))
      .catch((err) => console.error("Failed to load scrip metadata", err));

    // 2. Load initial snapshot for the starting scrip
    // This seeds the market watch, depth, and last 100 candles in one request
    fetch(`http://localhost:8000/api/snapshot/init?scrip=${activeScrip}`)
      .then((res) => res.json())
      .then((data) => seed(data))
      .catch((err) => console.error("Failed to load init snapshot", err));
  }, [seed]); // Only on mount (activeScrip is static RELIANCE for now, or seeds once)

  // Cap trade log at 100 entries (already capped in the hook, but slice for display)
  const log: WsTradeEvent[] = tradeEvents.slice(0, 100);

  // Memoize positions so Portfolio only re-renders when fills or LTPs actually change
  const positions = useMemo(
    () => buildPositions(fills, snapshots),
    [fills, snapshots],
  );

  const processedTradeIds = useRef(new Set<string>());

  useEffect(() => {
    const newFills: FillEntry[] = [];
    for (const t of tradeEvents) {
      if (!processedTradeIds.current.has(t.trade_id)) {
        processedTradeIds.current.add(t.trade_id);
        if (t.buyer_id === TRADER_ID) {
          newFills.push({ scrip: t.scrip, side: "BUY",  qty: t.quantity, price: t.price });
        }
        if (t.seller_id === TRADER_ID) {
          newFills.push({ scrip: t.scrip, side: "SELL", qty: t.quantity, price: t.price });
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
            v0.3.0 · NSE Simulator
          </span>
        </div>

        {/* Market watch — receives throttled LTP diffs (2 fps max) */}
        <MarketWatch
          activeScrip={activeScrip}
          onSelect={setActiveScrip}
          liveData={throttledMarketWatch}
        />

        {/* Main workspace */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Trade log sidebar — LEFT — virtualized */}
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
            <Suspense fallback={
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#080808', color: '#333', fontSize: 11 }}>
                LOADING CHART...
              </div>
            }>
              <CandleChart
                scrip={activeScrip}
                candleEvents={candleEvents}
                position={positions.find((p) => p.scrip === activeScrip)}
              />
            </Suspense>
          </div>
        </div>

        {/* Footer Tabs & Content */}
        <div
          style={{
            height: 200,
            flexShrink: 0,
            borderTop: "1px solid #1a1a1a",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: "#080808"
          }}
        >
          <div style={{ display: "flex", borderBottom: "1px solid #1a1a1a" }}>
            <button
              onClick={() => setFooterTab('portfolio')}
              style={{
                padding: "6px 16px",
                background: footerTab === 'portfolio' ? "#141414" : "transparent",
                border: "none",
                color: footerTab === 'portfolio' ? "#f0c040" : "#555",
                fontSize: 10,
                letterSpacing: 1,
                fontWeight: 600,
                borderTop: footerTab === 'portfolio' ? "2px solid #f0c040" : "2px solid transparent",
              }}
            >
              PORTFOLIO
            </button>
            <button
              onClick={() => setFooterTab('orders')}
              style={{
                padding: "6px 16px",
                background: footerTab === 'orders' ? "#141414" : "transparent",
                border: "none",
                color: footerTab === 'orders' ? "#f0c040" : "#555",
                fontSize: 10,
                letterSpacing: 1,
                fontWeight: 600,
                borderTop: footerTab === 'orders' ? "2px solid #f0c040" : "2px solid transparent",
              }}
            >
              ORDER HISTORY
            </button>
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            {footerTab === 'portfolio' ? (
              <Portfolio positions={positions} />
            ) : (
              <OrderHistory traderId={TRADER_ID} marketWatch={throttledMarketWatch} />
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          RIGHT COLUMN — Market Depth, full 100vh, no toggle
      ══════════════════════════════════════════════════════ */}
      <div
        style={{
          width: DEPTH_WIDTH,
          borderLeft: "1px solid #1a1a1a",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
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

        {/* OrderBook — fills all remaining height */}
        <div style={{ flex: 1, overflow: "hidden", height: "100%" }}>
          <OrderBook scrip={activeScrip} snapshot={activeSnapshot} />
        </div>
      </div>
    </div>
  );
};
