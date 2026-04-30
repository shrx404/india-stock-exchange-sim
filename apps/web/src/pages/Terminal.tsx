import { useState, useCallback, useEffect, useRef } from 'react';
import { OrderBook }    from '../components/OrderBook/OrderBook';
import { OrderForm }    from '../components/OrderForm/OrderForm';
import { CandleChart }  from '../components/Chart/CandleChart';
import { MarketWatch }  from '../components/MarketWatch/MarketWatch';
import { Portfolio }    from '../components/Portfolio/Portfolio';
import { useWebSocket } from '../hooks/useWebSocket';
import type {
  PlaceOrderResponse,
  PortfolioPosition,
  WsTradeEvent,
} from '../types/exchange';

/* ---------------------------------------------------------------
   Portfolio state management — derives positions from fill events
--------------------------------------------------------------- */
interface FillEntry {
  scrip   : string;
  side    : 'BUY' | 'SELL';
  qty     : number;
  price   : number;
}

const buildPositions = (
  fills    : FillEntry[],
  snapshots: Record<string, { ltp: number | null }>,
): PortfolioPosition[] => {
  const map: Record<string, { qty: number; cost: number; count: number }> = {};

  for (const f of fills) {
    if (!map[f.scrip]) map[f.scrip] = { qty: 0, cost: 0, count: 0 };
    const sign = f.side === 'BUY' ? 1 : -1;
    map[f.scrip].qty   += sign * f.qty;
    map[f.scrip].cost  += sign * f.qty * f.price;
    map[f.scrip].count += 1;
  }

  return Object.entries(map)
    .filter(([, v]) => v.qty !== 0)
    .map(([scrip, v]) => {
      const avgPrice = v.qty !== 0 ? Math.abs(v.cost / v.qty) : 0;
      const ltp      = snapshots[scrip]?.ltp ?? null;
      const pnl      = ltp != null ? (ltp - avgPrice) * v.qty : 0;
      return { scrip, netQty: v.qty, avgPrice, ltp, pnl: parseFloat(pnl.toFixed(2)) };
    });
};

/* ---------------------------------------------------------------
   Terminal page
--------------------------------------------------------------- */
const TRADER_ID = 'trader_human';

export const Terminal = () => {
  const [activeScrip, setActiveScrip] = useState('RELIANCE');
  const [fills, setFills]             = useState<FillEntry[]>([]);

  const { snapshots, tradeEvents, connected } = useWebSocket();

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
          newFills.push({ scrip: t.scrip, side: 'BUY', qty: t.quantity, price: t.price });
        }
        if (t.seller_id === TRADER_ID) {
          newFills.push({ scrip: t.scrip, side: 'SELL', qty: t.quantity, price: t.price });
        }
      }
    }
    if (newFills.length > 0) {
      setFills(prev => [...prev, ...newFills]);
    }
  }, [tradeEvents]);

  const handleTraded = useCallback((res: PlaceOrderResponse, scrip: string, side: 'BUY' | 'SELL') => {
    // Trades are now handled entirely via the WebSocket event stream.
    // This ensures that limit orders filled later also update the portfolio.
  }, []);

  const activeSnapshot = snapshots[activeScrip] ?? null;

  return (
    <div style={{
      display       : 'flex',
      flexDirection : 'column',
      height        : '100vh',
      overflow      : 'hidden',
      background    : '#0a0a0a',
    }}>
      {/* ── Top bar: logo + WS status ────────────────────────── */}
      <div style={{
        display        : 'flex',
        alignItems     : 'center',
        gap            : 10,
        padding        : '8px 16px',
        borderBottom   : '1px solid #1a1a1a',
        background     : '#060606',
        flexShrink     : 0,
      }}>
        <span style={{ color: '#f0c040', fontWeight: 800, fontSize: 13, letterSpacing: 1 }}>
          🇮🇳 INDIA EXCHANGE SIM
        </span>
        <span style={{
          fontSize    : 9,
          padding     : '2px 8px',
          borderRadius: 10,
          background  : connected ? '#0d1f15' : '#1f0d0d',
          color       : connected ? '#3ddc84' : '#f05050',
          letterSpacing: 0.5,
        }}>
          {connected ? '● LIVE' : '○ DISCONNECTED'}
        </span>
        <span style={{ marginLeft: 'auto', color: '#333', fontSize: 10 }}>
          v0.2.0 · NSE Simulator
        </span>
      </div>

      {/* ── Market watch scrip tabs ──────────────────────────── */}
      <MarketWatch activeScrip={activeScrip} onSelect={setActiveScrip} />

      {/* ── Main workspace ──────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', gap: 1 }}>

        {/* Left column: order book */}
        <div style={{
          width       : 260,
          flexShrink  : 0,
          borderRight : '1px solid #1a1a1a',
          overflow    : 'hidden',
          display     : 'flex',
          flexDirection: 'column',
        }}>
          <OrderBook scrip={activeScrip} snapshot={activeSnapshot} />
        </div>

        {/* Center: chart + order form */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Chart fills available vertical space */}
          <CandleChart scrip={activeScrip} />

          {/* Order form below chart */}
          <div style={{
            flexShrink  : 0,
            borderTop   : '1px solid #1a1a1a',
          }}>
            <OrderForm
              scrip={activeScrip}
              onTraded={(res, side) => handleTraded(res, activeScrip, side)}
            />
          </div>
        </div>

        {/* Right column: trade log */}
        <div style={{
          width       : 240,
          flexShrink  : 0,
          borderLeft  : '1px solid #1a1a1a',
          overflowY   : 'auto',
          padding     : '10px 12px',
          display     : 'flex',
          flexDirection: 'column',
          gap         : 0,
        }}>
          <div style={{ color: '#444', fontSize: 10, letterSpacing: 1, marginBottom: 8 }}>
            TRADE LOG
          </div>
          {log.length === 0
            ? <div style={{ color: '#222', fontSize: 11 }}>Waiting for trades…</div>
            : log.map((t, i) => (
              <div key={i} style={{
                padding      : '5px 0',
                borderBottom : '1px solid #111',
                fontSize     : 11,
              }}>
                <span style={{ color: '#555', fontSize: 9, marginRight: 4 }}>
                  {t.scrip}
                </span>
                <span style={{ color: '#3ddc84' }}>
                  {t.quantity} @ ₹{t.price.toFixed(2)}
                </span>
                <div style={{ color: '#333', fontSize: 9, marginTop: 1 }}>
                  {t.buyer_id.replace('bot_', '')} ← {t.seller_id.replace('bot_', '')}
                </div>
              </div>
            ))
          }
        </div>
      </div>

      {/* ── Portfolio bar at bottom ──────────────────────────── */}
      <Portfolio positions={positions} />
    </div>
  );
};
