import { useEffect, useState } from 'react';
import type { MarketWatchItem } from '../../types/exchange';

const API = 'http://localhost:8000';

interface Props {
  activeScrip: string;
  onSelect: (scrip: string) => void;
}

export const MarketWatch = ({ activeScrip, onSelect }: Props) => {
  const [items, setItems] = useState<MarketWatchItem[]>([]);

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res  = await fetch(`${API}/market-watch`);
        const data = await res.json();
        if (Array.isArray(data)) setItems(data);
      } catch { /* silent */ }
    };

    fetch_();
    const id = setInterval(fetch_, 2_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      display       : 'flex',
      alignItems    : 'center',
      gap           : 0,
      overflowX     : 'auto',
      borderBottom  : '1px solid #1e1e1e',
      background    : '#050505',
      padding       : '0 4px',
    }}>
      {items.map(item => {
        const isActive  = item.scrip === activeScrip;
        const isUp      = (item.change ?? 0) >= 0;
        const ltpColor  = item.ltp == null ? '#444' : isUp ? '#3ddc84' : '#f05050';
        const pctColor  = item.ltp == null ? '#444' : isUp ? '#3ddc84' : '#f05050';

        return (
          <button
            key={item.scrip}
            onClick={() => onSelect(item.scrip)}
            style={{
              background   : 'transparent',
              border       : 'none',
              borderBottom : isActive ? '2px solid #f0c040' : '2px solid transparent',
              padding      : '6px 12px',
              cursor       : 'pointer',
              color        : isActive ? '#e0e0e0' : '#666',
              textAlign    : 'left',
              whiteSpace   : 'nowrap',
              transition   : 'all 0.15s',
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 2, color: isActive ? '#f0c040' : '#888', display: 'flex', alignItems: 'center', gap: 4 }}>
              {item.scrip}
              {item.session_state === 'HALTED' && <span style={{ fontSize: 8, padding: '1px 3px', background: '#f05050', color: 'white', borderRadius: 2 }}>HALTED</span>}
              {item.session_state === 'PRE_OPEN' && <span style={{ fontSize: 8, padding: '1px 3px', background: '#3080c0', color: 'white', borderRadius: 2 }}>PRE-OPEN</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ fontSize: 12, color: ltpColor }}>
                {item.ltp != null ? `₹${item.ltp.toFixed(2)}` : '—'}
              </span>
              <span style={{ fontSize: 10, color: pctColor }}>
                {item.ltp != null
                  ? `${item.changePct >= 0 ? '+' : ''}${item.changePct.toFixed(2)}%`
                  : ''
                }
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
};
