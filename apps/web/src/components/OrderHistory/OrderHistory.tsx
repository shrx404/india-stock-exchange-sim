import { memo, useEffect, useState } from "react";
import type { MarketWatchItem } from "../../types/exchange";

export interface OrderHistoryItem {
  order_id: string;
  scrip: string;
  side: "BUY" | "SELL";
  order_type: "MARKET" | "LIMIT";
  quantity: number;
  price: number;
  filled_qty: number;
  status: "PENDING" | "PARTIAL" | "FILLED" | "CANCELED" | "REJECTED";
  created_at: string;
  avg_price: number;
}

interface Props {
  traderId: string;
  marketWatch: Record<string, MarketWatchItem>;
}

export const OrderHistory = memo(function OrderHistory({ traderId, marketWatch }: Props) {
  const [orders, setOrders] = useState<OrderHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = async () => {
    try {
      const res = await fetch(`http://localhost:8000/api/users/orders?trader_id=${traderId}&limit=50`);
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 2000); // Poll every 2s for updates
    return () => clearInterval(interval);
  }, [traderId]);

  return (
    <div
      style={{
        background: "#0d0d0d",
        padding: "10px 16px",
        overflowY: "auto",
        height: "100%",
        boxSizing: "border-box"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ color: "#555", fontSize: 10, letterSpacing: 1 }}>
          ORDER HISTORY
        </span>
      </div>

      {loading && orders.length === 0 ? (
        <div style={{ color: "#333", fontSize: 11 }}>Loading orders...</div>
      ) : orders.length === 0 ? (
        <div style={{ color: "#333", fontSize: 11 }}>No orders found</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ color: "#444" }}>
              {["Time", "Scrip", "Side", "Type", "Qty", "Fill/Avg", "Status", "P&L"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "2px 8px 4px 0", fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const ltp = marketWatch[o.scrip]?.ltp ?? o.avg_price;
              
              let pnl = 0;
              if (o.filled_qty > 0 && o.avg_price > 0 && ltp !== null) {
                if (o.side === "BUY") {
                  pnl = (ltp - o.avg_price) * o.filled_qty;
                } else {
                  pnl = (o.avg_price - ltp) * o.filled_qty;
                }
              }

              const pnlColor = pnl === 0 ? "#666" : pnl > 0 ? "#3ddc84" : "#f05050";
              const timeStr = new Date(o.created_at).toLocaleTimeString([], { hour12: false });
              
              let statusColor = "#666";
              if (o.status === "FILLED") statusColor = "#3ddc84";
              if (o.status === "PARTIAL") statusColor = "#f0c040";
              if (o.status === "CANCELED" || o.status === "REJECTED") statusColor = "#f05050";

              return (
                <tr key={o.order_id} style={{ borderTop: "1px solid #111" }}>
                  <td style={{ padding: "3px 8px 3px 0", color: "#888" }}>{timeStr}</td>
                  <td style={{ padding: "3px 8px 3px 0", color: "#f0c040" }}>{o.scrip}</td>
                  <td style={{ padding: "3px 8px 3px 0", color: o.side === "BUY" ? "#3ddc84" : "#f05050" }}>{o.side}</td>
                  <td style={{ padding: "3px 8px 3px 0", color: "#aaa" }}>{o.order_type}</td>
                  <td style={{ padding: "3px 8px 3px 0", color: "#e0e0e0" }}>{o.filled_qty}/{o.quantity}</td>
                  <td style={{ padding: "3px 8px 3px 0", color: "#aaa" }}>
                     {o.filled_qty > 0 ? `₹${o.avg_price.toFixed(2)}` : "—"}
                  </td>
                  <td style={{ padding: "3px 8px 3px 0" }}>
                     <span style={{ 
                       background: `${statusColor}22`, 
                       color: statusColor, 
                       padding: "2px 6px", 
                       borderRadius: 4, 
                       fontSize: 9,
                       fontWeight: 600
                     }}>
                       {o.status}
                     </span>
                  </td>
                  <td style={{ padding: "3px 0 3px 0", color: pnlColor, fontWeight: 600 }}>
                    {o.filled_qty > 0 ? `${pnl > 0 ? "+" : ""}₹${pnl.toFixed(2)}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
});
