export type Side = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';
export type OrderStatus = 'PENDING' | 'PARTIAL' | 'FILLED' | 'CANCELLED';

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
