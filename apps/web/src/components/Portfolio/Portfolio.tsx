import type { PortfolioPosition } from '../../types/exchange';

interface Props {
  positions: PortfolioPosition[];
}

export const Portfolio = ({ positions }: Props) => {
  const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);

  return (
    <div style={{
      background  : '#0d0d0d',
      borderTop   : '1px solid #1e1e1e',
      padding     : '10px 16px',
      overflowY   : 'auto',
      maxHeight   : 160,
    }}>
      <div style={{
        display        : 'flex',
        justifyContent : 'space-between',
        alignItems     : 'center',
        marginBottom   : 8,
      }}>
        <span style={{ color: '#555', fontSize: 10, letterSpacing: 1 }}>PORTFOLIO</span>
        <span style={{
          fontSize  : 11,
          color     : totalPnl >= 0 ? '#3ddc84' : '#f05050',
          fontWeight: 600,
        }}>
          Total P&L: {totalPnl >= 0 ? '+' : ''}₹{totalPnl.toFixed(2)}
        </span>
      </div>

      {positions.length === 0 ? (
        <div style={{ color: '#333', fontSize: 11 }}>No open positions</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ color: '#444' }}>
              {['Scrip', 'Qty', 'Avg Price', 'LTP', 'P&L'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '2px 8px 4px 0', fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map(pos => {
              const pnlColor = pos.pnl >= 0 ? '#3ddc84' : '#f05050';
              return (
                <tr key={pos.scrip} style={{ borderTop: '1px solid #111' }}>
                  <td style={{ padding: '3px 8px 3px 0', color: '#f0c040' }}>{pos.scrip}</td>
                  <td style={{ padding: '3px 8px 3px 0', color: pos.netQty >= 0 ? '#3ddc84' : '#f05050' }}>
                    {pos.netQty > 0 ? '+' : ''}{pos.netQty}
                  </td>
                  <td style={{ padding: '3px 8px 3px 0', color: '#aaa' }}>₹{pos.avgPrice.toFixed(2)}</td>
                  <td style={{ padding: '3px 8px 3px 0', color: '#aaa' }}>
                    {pos.ltp != null ? `₹${pos.ltp.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '3px 0 3px 0', color: pnlColor, fontWeight: 600 }}>
                    {pos.pnl >= 0 ? '+' : ''}₹{pos.pnl.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
