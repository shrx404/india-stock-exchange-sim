import { useEffect, useRef, useState, useCallback } from 'react';
import type { OrderBookSnapshot, WsTradeEvent, WsCandleEvent, MarketWatchItem } from '../types/exchange';

const WS_URL = 'ws://localhost:8000/ws';
const MAX_BACKOFF_MS = 10_000;

export interface UseWebSocketReturn {
  snapshots:    Record<string, OrderBookSnapshot>;
  tradeEvents:  WsTradeEvent[];
  candleEvents: WsCandleEvent[];
  marketWatch:  Record<string, MarketWatchItem>;
  connected:    boolean;
  /**
   * Call this when the user switches the active scrip.
   * Sends a `{"action":"subscribe","scrip":"..."}` message to the engine
   * so depth/candle updates for the new scrip are routed to this client.
   */
  subscribeScrip: (scrip: string) => void;
}

// -----------------------------------------------------------------
// Single message shapes that arrive inside the server-sent batch array
// -----------------------------------------------------------------
interface WsDepthMsg extends OrderBookSnapshot { event: 'depth'; }
interface WsLtpMsg extends MarketWatchItem      { event: 'ltp_update'; }
interface WsVwapMsg { event: 'vwap'; scrip: string; vwap: number; }
type WsMsg = WsTradeEvent | WsDepthMsg | WsCandleEvent | WsLtpMsg | WsVwapMsg;

export const useWebSocket = (): UseWebSocketReturn => {
  const [snapshots,   setSnapshots]   = useState<Record<string, OrderBookSnapshot>>({});
  const [tradeEvents, setTradeEvents] = useState<WsTradeEvent[]>([]);
  const [candleEvents,setCandleEvents]= useState<WsCandleEvent[]>([]);
  const [marketWatch, setMarketWatch] = useState<Record<string, MarketWatchItem>>({});
  const [connected,   setConnected]   = useState(false);

  const wsRef      = useRef<WebSocket | null>(null);
  const backoffRef = useRef(500);
  const mountedRef = useRef(true);

  // --------------------------------------------------------------- message handler
  const handleBatch = useCallback((batch: WsMsg[]) => {
    const newTrades:  WsTradeEvent[]  = [];
    const newCandles: WsCandleEvent[] = [];
    const depthPatch: Record<string, OrderBookSnapshot> = {};
    const ltpPatch:   Record<string, MarketWatchItem>   = {};

    for (const msg of batch) {
      switch (msg.event) {
        case 'trade':
          newTrades.push(msg as WsTradeEvent);
          break;

        case 'candle':
          newCandles.push(msg as WsCandleEvent);
          break;

        case 'depth': {
          const d = msg as WsDepthMsg;
          if (d.scrip) depthPatch[d.scrip] = d;
          break;
        }

        case 'ltp_update': {
          const l = msg as WsLtpMsg;
          ltpPatch[l.scrip] = l;
          break;
        }

        case 'vwap':
          // VWAP embedded in depth snapshot — no dedicated state yet
          break;

        default:
          break;
      }
    }

    if (newTrades.length)
      setTradeEvents(prev => [...newTrades, ...prev].slice(0, 100));

    if (newCandles.length)
      setCandleEvents(prev => [...newCandles, ...prev].slice(0, 100));

    if (Object.keys(depthPatch).length)
      setSnapshots(prev => ({ ...prev, ...depthPatch }));

    if (Object.keys(ltpPatch).length)
      setMarketWatch(prev => ({ ...prev, ...ltpPatch }));
  }, []);

  // --------------------------------------------------------------- send subscribe
  const subscribeScrip = useCallback((scrip: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ action: 'subscribe', scrip }));
  }, []);

  // --------------------------------------------------------------- connect
  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const socket = new WebSocket(WS_URL);
    wsRef.current = socket;

    socket.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);
      backoffRef.current = 500;
      console.log('[WS] connected');
    };

    socket.onmessage = (e) => {
      try {
        // Server always sends a JSON array (batch). Handle both array and
        // legacy single-object for safety.
        const raw = JSON.parse(e.data as string);
        const batch: WsMsg[] = Array.isArray(raw) ? raw : [raw];
        handleBatch(batch);
      } catch {
        console.error('[WS] parse error', e.data);
      }
    };

    socket.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
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

  return { snapshots, tradeEvents, candleEvents, marketWatch, connected, subscribeScrip };
};
