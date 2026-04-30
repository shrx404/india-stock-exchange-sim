export type Side = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";
export type OrderStatus = "PENDING" | "PARTIAL" | "FILLED" | "CANCELLED";

export interface OrderBookLevel {
  price: number;
  quantity: number;
  orders: number;
}

export interface OrderBookSnapshot {
  scrip: string;
  ltp: number | null;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  event?: string;
}

export interface Trade {
  trade_id: string;
  price: number;
  quantity: number;
  buyer_id: string;
  seller_id: string;
}

export interface PlaceOrderResponse {
  order_id: string;
  status: OrderStatus;
  trades: Trade[];
}

export interface CandleBar {
  time: string; // "2024-01-01T09:15:00"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketWatchItem {
  scrip: string;
  ltp: number | null;
  seed: number;
  change: number;
  changePct: number;
}

export interface PortfolioPosition {
  scrip: string;
  netQty: number; // positive = long, negative = short
  avgPrice: number;
  ltp: number | null;
  pnl: number;
  realizedPnl?: number; // ADD THIS LINE!
}

export interface WsTradeEvent {
  event: "trade";
  scrip: string;
  price: number;
  quantity: number;
  buyer_id: string;
  seller_id: string;
  trade_id: string;
}

export interface WsDepthEvent extends OrderBookSnapshot {
  event: "depth";
}

export interface WsCandleEvent {
  event: "candle";
  scrip: string;
  candle: CandleBar;
}

export type WsMessage = WsTradeEvent | WsDepthEvent | WsCandleEvent;
