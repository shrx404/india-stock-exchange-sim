import { useEffect, useRef, useReducer, useCallback } from 'react';
import type { OrderBookSnapshot, WsTradeEvent, WsCandleEvent, MarketWatchItem } from '../types/exchange';

const WS_URL = 'ws://localhost:8000/ws';
const MAX_BACKOFF_MS = 10_000;

// -----------------------------------------------------------------
// Single message shapes that arrive inside the server-sent batch array
// -----------------------------------------------------------------
interface WsDepthMsg extends OrderBookSnapshot { event: 'depth'; }
interface WsLtpMsg   extends MarketWatchItem   { event: 'ltp_update'; }
interface WsVwapMsg  { event: 'vwap'; scrip: string; vwap: number; }
type WsMsg = WsTradeEvent | WsDepthMsg | WsCandleEvent | WsLtpMsg | WsVwapMsg;

// -----------------------------------------------------------------
// Reducer — all WS state lives in a single object so every incoming
// batch dispatches ONE action → ONE React commit → ONE re-render pass
// -----------------------------------------------------------------
interface WsState {
  snapshots:    Record<string, OrderBookSnapshot>;
  tradeEvents:  WsTradeEvent[];
  candleEvents: WsCandleEvent[];
  marketWatch:  Record<string, MarketWatchItem>;
  connected:    boolean;
}

type WsAction =
  | { type: 'CONNECTED' }
  | { type: 'DISCONNECTED' }
  | { type: 'BATCH'; trades: WsTradeEvent[]; candles: WsCandleEvent[]; depth: Record<string, OrderBookSnapshot>; ltp: Record<string, MarketWatchItem> };

const initialState: WsState = {
  snapshots:    {},
  tradeEvents:  [],
  candleEvents: [],
  marketWatch:  {},
  connected:    false,
};

const wsReducer = (state: WsState, action: WsAction): WsState => {
  switch (action.type) {
    case 'CONNECTED':
      return { ...state, connected: true };

    case 'DISCONNECTED':
      return { ...state, connected: false };

    case 'BATCH': {
      const { trades, candles, depth, ltp } = action;
      return {
        ...state,
        tradeEvents:  trades.length  ? [...trades,  ...state.tradeEvents].slice(0, 100) : state.tradeEvents,
        candleEvents: candles.length ? [...candles, ...state.candleEvents].slice(0, 100) : state.candleEvents,
        snapshots:    Object.keys(depth).length ? { ...state.snapshots,   ...depth } : state.snapshots,
        marketWatch:  Object.keys(ltp).length   ? { ...state.marketWatch, ...ltp   } : state.marketWatch,
      };
    }

    default:
      return state;
  }
};

// -----------------------------------------------------------------
// Public API
// -----------------------------------------------------------------
export interface UseWebSocketReturn {
  snapshots:      Record<string, OrderBookSnapshot>;
  tradeEvents:    WsTradeEvent[];
  candleEvents:   WsCandleEvent[];
  marketWatch:    Record<string, MarketWatchItem>;
  connected:      boolean;
  /**
   * Call when the user switches the active scrip.
   * Sends `{"action":"subscribe","scrip":"..."}` to the engine so that
   * depth/candle updates for that scrip are routed to this client.
   */
  subscribeScrip: (scrip: string) => void;
}

export const useWebSocket = (): UseWebSocketReturn => {
  const [state, dispatch] = useReducer(wsReducer, initialState);

  const wsRef      = useRef<WebSocket | null>(null);
  const backoffRef = useRef(500);
  const mountedRef = useRef(true);

  // --------------------------------------------------------------- parse + dispatch
  const handleBatch = useCallback((batch: WsMsg[]) => {
    const trades:  WsTradeEvent[]                   = [];
    const candles: WsCandleEvent[]                  = [];
    const depth:   Record<string, OrderBookSnapshot> = {};
    const ltp:     Record<string, MarketWatchItem>   = {};

    for (const msg of batch) {
      switch (msg.event) {
        case 'trade':
          trades.push(msg as WsTradeEvent);
          break;
        case 'candle':
          candles.push(msg as WsCandleEvent);
          break;
        case 'depth': {
          const d = msg as WsDepthMsg;
          if (d.scrip) depth[d.scrip] = d;
          break;
        }
        case 'ltp_update': {
          const l = msg as WsLtpMsg;
          ltp[l.scrip] = l;
          break;
        }
        // 'vwap' — no dedicated state slot yet, handled via depth
        default:
          break;
      }
    }

    // ONE dispatch → ONE React commit for the entire batch
    dispatch({ type: 'BATCH', trades, candles, depth, ltp });
  }, []);

  // --------------------------------------------------------------- subscribe helper
  const subscribeScrip = useCallback((scrip: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ action: 'subscribe', scrip }));
  }, []);

  // --------------------------------------------------------------- connect / reconnect
  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const socket = new WebSocket(WS_URL);
    wsRef.current = socket;

    socket.onopen = () => {
      if (!mountedRef.current) return;
      dispatch({ type: 'CONNECTED' });
      backoffRef.current = 500;
      console.log('[WS] connected');
    };

    socket.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data as string);
        // Server sends arrays; accept legacy single-object too
        const batch: WsMsg[] = Array.isArray(raw) ? raw : [raw];
        handleBatch(batch);
      } catch {
        console.error('[WS] parse error', e.data);
      }
    };

    socket.onclose = () => {
      if (!mountedRef.current) return;
      dispatch({ type: 'DISCONNECTED' });
      console.log(`[WS] disconnected — reconnecting in ${backoffRef.current}ms`);
      setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
        connect();
      }, backoffRef.current);
    };

    socket.onerror = () => socket.close();
  }, [handleBatch]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    snapshots:    state.snapshots,
    tradeEvents:  state.tradeEvents,
    candleEvents: state.candleEvents,
    marketWatch:  state.marketWatch,
    connected:    state.connected,
    subscribeScrip,
  };
};
