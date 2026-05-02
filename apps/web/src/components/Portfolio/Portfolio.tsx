import { memo } from "react";

import type { PortfolioPosition } from "../../types/exchange";

interface Props {
  positions: PortfolioPosition[];
}

export const Portfolio = memo(function Portfolio({ positions }: Props) {
  // Calculate Total (Unrealized + Realized) P&L
  const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);

  // Calculate Session Realized P&L
  const totalRealizedPnl = positions.reduce(
    (sum, p) => sum + (p.realizedPnl ?? 0),
    0,
  );

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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <span style={{ color: "#555", fontSize: 10, letterSpacing: 1 }}>
          PORTFOLIO
        </span>

        {/* We wrap the totals in a flex div to space them out nicely */}
        <div style={{ display: "flex", gap: 16 }}>
          <span
            style={{
              fontSize: 11,
              color:
                totalRealizedPnl === 0
                  ? "#888"
                  : totalRealizedPnl > 0
                    ? "#3ddc84"
                    : "#f05050",
              fontWeight: 600,
            }}
          >
            Realized: {totalRealizedPnl >= 0 ? "+" : ""}₹
            {totalRealizedPnl.toFixed(2)}
          </span>

          <span
            style={{
              fontSize: 11,
              color: totalPnl >= 0 ? "#3ddc84" : "#f05050",
              fontWeight: 600,
            }}
          >
            Total P&L: {totalPnl >= 0 ? "+" : ""}₹{totalPnl.toFixed(2)}
          </span>
        </div>
      </div>

      {positions.length === 0 ? (
        <div style={{ color: "#333", fontSize: 11 }}>No open positions</div>
      ) : (
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}
        >
          <thead>
            <tr style={{ color: "#444" }}>
              {[
                "Scrip",
                "Qty",
                "Avg Price",
                "LTP",
                "Realized P&L",
                "Total P&L",
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    padding: "2px 8px 4px 0",
                    fontWeight: 400,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => {
              const pnlColor = pos.pnl >= 0 ? "#3ddc84" : "#f05050";
              const realizedPnlColor =
                (pos.realizedPnl ?? 0) >= 0 ? "#3ddc84" : "#f05050";

              return (
                <tr key={pos.scrip} style={{ borderTop: "1px solid #111" }}>
                  <td style={{ padding: "3px 8px 3px 0", color: "#f0c040" }}>
                    {pos.scrip}
                  </td>

                  <td
                    style={{
                      padding: "3px 8px 3px 0",
                      color: pos.netQty >= 0 ? "#3ddc84" : "#f05050",
                    }}
                  >
                    {pos.netQty > 0 ? "+" : ""}
                    {pos.netQty}
                  </td>

                  <td style={{ padding: "3px 8px 3px 0", color: "#aaa" }}>
                    {pos.netQty === 0 ? "—" : `₹${pos.avgPrice.toFixed(2)}`}
                  </td>

                  <td style={{ padding: "3px 8px 3px 0", color: "#aaa" }}>
                    {pos.ltp != null ? `₹${pos.ltp.toFixed(2)}` : "—"}
                  </td>

                  <td
                    style={{
                      padding: "3px 8px 3px 0",
                      color: pos.realizedPnl === 0 ? "#666" : realizedPnlColor,
                    }}
                  >
                    {(pos.realizedPnl ?? 0) >= 0 ? "+" : ""}₹
                    {(pos.realizedPnl ?? 0).toFixed(2)}
                  </td>

                  <td
                    style={{
                      padding: "3px 0 3px 0",
                      color: pnlColor,
                      fontWeight: 600,
                    }}
                  >
                    {pos.pnl >= 0 ? "+" : ""}₹{pos.pnl.toFixed(2)}
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
