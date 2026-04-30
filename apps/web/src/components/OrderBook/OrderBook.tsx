import { useEffect, useState } from 'react';
import type { OrderBookSnapshot, OrderBookLevel } from '../../types/exchange';
import styles from './OrderBook.module.css';

interface Props {
  scrip: string;
  snapshot: OrderBookSnapshot | null;
}

export function OrderBook({ scrip, snapshot }: Props) {
  const [book, setBook] = useState<OrderBookSnapshot | null>(null);

  useEffect(() => {
    fetch(`http://localhost:8000/depth/${scrip}`)
      .then(r => r.json())
      .then(setBook);
  }, [scrip]);

  useEffect(() => {
    if (snapshot && snapshot.scrip === scrip) {
      setBook(snapshot);
    }
  }, [snapshot, scrip]);

  const asks = book ? [...book.asks].reverse() : [];
  const bids = book?.bids ?? [];
  const ltp  = book?.ltp;

  const maxQty = Math.max(
    ...asks.map(a => a.quantity),
    ...bids.map(b => b.quantity),
    1
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.scrip}>{scrip}</span>
        <span className={styles.ltp}>
          {ltp != null ? `₹${ltp.toFixed(2)}` : '—'}
        </span>
      </div>

      <div className={styles.labels}>
        <span>PRICE</span>
        <span>QTY</span>
        <span>ORDERS</span>
      </div>

      <div className={styles.asks}>
        {asks.length === 0
          ? <div className={styles.empty}>no asks</div>
          : asks.map((level, i) => (
            <BookRow key={i} level={level} side="ask" maxQty={maxQty} />
          ))
        }
      </div>

      <div className={styles.spread}>
        {book?.bids[0] && book?.asks[0]
          ? `spread ₹${(book.asks[0].price - book.bids[0].price).toFixed(2)}`
          : 'spread —'
        }
      </div>

      <div className={styles.bids}>
        {bids.length === 0
          ? <div className={styles.empty}>no bids</div>
          : bids.map((level, i) => (
            <BookRow key={i} level={level} side="bid" maxQty={maxQty} />
          ))
        }
      </div>
    </div>
  );
}

function BookRow({
  level, side, maxQty
}: {
  level: OrderBookLevel;
  side: 'bid' | 'ask';
  maxQty: number;
}) {
  const pct = (level.quantity / maxQty) * 100;
  return (
    <div className={`${styles.row} ${styles[side]}`}>
      <div className={styles.bar} style={{ width: `${pct}%`, opacity: 0.15 }} />
      <span className={styles.price}>₹{level.price.toFixed(2)}</span>
      <span className={styles.qty}>{level.quantity}</span>
      <span className={styles.orders}>{level.orders}</span>
    </div>
  );
}
