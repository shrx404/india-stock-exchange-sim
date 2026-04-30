import { useState } from 'react';
import { OrderBook } from './components/OrderBook/OrderBook';
import { OrderForm } from './components/OrderForm/OrderForm';
import { useWebSocket } from './hooks/useWebSocket';
import type { PlaceOrderResponse } from './types/exchange';
import './index.css';

const SCRIPS = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK'];

export default function App() {
  const [activeScrip, setActiveScrip] = useState('RELIANCE');
  const [log, setLog]                 = useState<string[]>([]);
  const { snapshot, connected }       = useWebSocket();

  function handleTraded(res: PlaceOrderResponse) {
    const entry = res.trades.length > 0
      ? `FILLED ${res.trades[0].quantity} @ ₹${res.trades[0].price}`
      : `Order ${res.status} — ${res.order_id.slice(0, 8)}`;
    setLog(prev => [entry, ...prev].slice(0, 20));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: 16, gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ color: '#f0c040', fontWeight: 700, fontSize: 15 }}>
          🇮🇳 Exchange Sim
        </span>
        <span style={{
          fontSize: 10,
          padding: '2px 8px',
          borderRadius: 10,
          background: connected ? '#1a3a2a' : '#3a1a1a',
          color: connected ? '#3ddc84' : '#f05050'
        }}>
          {connected ? 'LIVE' : 'DISCONNECTED'}
        </span>
        <div style={{ display: 'flex', gap: 6, marginLeft: 12 }}>
          {SCRIPS.map(s => (
            <button
              key={s}
              onClick={() => setActiveScrip(s)}
              style={{
                padding: '4px 10px',
                borderRadius: 4,
                border: '1px solid',
                borderColor: activeScrip === s ? '#f0c040' : '#333',
                background: activeScrip === s ? '#2a2500' : '#1a1a1a',
                color: activeScrip === s ? '#f0c040' : '#666',
                fontSize: 12,
              }}
            >{s}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flex: 1 }}>
        <OrderBook scrip={activeScrip} snapshot={snapshot} />
        <OrderForm scrip={activeScrip} onTraded={handleTraded} />
        <div style={{
          flex: 1,
          background: '#1a1a1a',
          border: '1px solid #2a2a2a',
          borderRadius: 6,
          padding: 14,
          overflowY: 'auto',
        }}>
          <div style={{ color: '#555', fontSize: 11, marginBottom: 10 }}>TRADE LOG</div>
          {log.length === 0
            ? <div style={{ color: '#333' }}>No trades yet</div>
            : log.map((entry, i) => (
              <div key={i} style={{ color: '#3ddc84', marginBottom: 4, fontSize: 12 }}>
                {entry}
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}
