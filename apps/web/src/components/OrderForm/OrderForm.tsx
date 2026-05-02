import { useState } from 'react';
import type { Side, OrderType, PlaceOrderResponse } from '../../types/exchange';
import styles from './OrderForm.module.css';

interface Props {
  scrip: string;
  sessionState?: string;
  lotSize?: number;
  tickSize?: number;
  onTraded: (res: PlaceOrderResponse, side: Side) => void;
}

export function OrderForm({ scrip, sessionState = 'OPEN', lotSize = 1, tickSize = 0.05, onTraded }: Props) {
  const [side, setSide]           = useState<Side>('BUY');
  const [orderType, setOrderType] = useState<OrderType>('LIMIT');
  const [quantity, setQuantity]   = useState('');
  const [price, setPrice]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  async function handleSubmit() {
    setError('');
    const qty = parseInt(quantity);
    const prc = parseFloat(price);

    if (!qty || qty <= 0)              return setError('Enter a valid quantity');
    if (orderType === 'LIMIT' && !prc) return setError('Enter a price for limit order');

    setLoading(true);
    try {
      const res = await fetch('http://localhost:8000/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scrip,
          side,
          order_type: orderType,
          quantity: qty,
          price: orderType === 'MARKET' ? 0 : prc,
          trader_id: 'trader_human',
        }),
      });
      const data: PlaceOrderResponse = await res.json();
      onTraded(data, side);
      setQuantity('');
      setPrice('');
    } catch {
      setError('API error — is the engine running?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>Place Order — {scrip}</div>

      <div className={styles.sideToggle}>
        <button
          className={`${styles.sideBtn} ${side === 'BUY' ? styles.buy : ''}`}
          onClick={() => setSide('BUY')}
        >BUY</button>
        <button
          className={`${styles.sideBtn} ${side === 'SELL' ? styles.sell : ''}`}
          onClick={() => setSide('SELL')}
        >SELL</button>
      </div>

      <div className={styles.typeToggle}>
        {(['LIMIT', 'MARKET'] as OrderType[]).map(t => (
          <button
            key={t}
            className={`${styles.typeBtn} ${orderType === t ? styles.active : ''}`}
            onClick={() => setOrderType(t)}
          >{t}</button>
        ))}
      </div>

      <div className={styles.field}>
        <label>Quantity</label>
        <input
          type="number"
          value={quantity}
          onChange={e => setQuantity(e.target.value)}
          placeholder={`e.g. ${lotSize * 10}`}
          min={lotSize}
          step={lotSize}
        />
      </div>

      {orderType === 'LIMIT' && (
        <div className={styles.field}>
          <label>Price (₹)</label>
          <input
            type="number"
            value={price}
            onChange={e => setPrice(e.target.value)}
            placeholder="e.g. 2955.00"
            step={tickSize}
            min={tickSize}
          />
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      <button
        className={`${styles.submit} ${side === 'BUY' ? styles.submitBuy : styles.submitSell}`}
        onClick={handleSubmit}
        disabled={loading || sessionState === 'HALTED'}
        style={{ opacity: sessionState === 'HALTED' ? 0.5 : 1, cursor: sessionState === 'HALTED' ? 'not-allowed' : 'pointer' }}
      >
        {sessionState === 'HALTED' ? 'MARKET HALTED' : loading ? 'Placing...' : `${side} ${scrip}`}
      </button>
    </div>
  );
}
