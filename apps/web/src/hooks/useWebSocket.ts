import { useEffect, useRef, useState, useCallback } from 'react';
import type { OrderBookSnapshot, WsTradeEvent } from '../types/exchange';

const WS_URL = 'ws://localhost:8000/ws';
const MAX_BACKOFF_MS = 10_000;

export interface UseWebSocketReturn {
  snapshots: Record<string, OrderBookSnapshot>;
  tradeEvents: WsTradeEvent[];
  candleEvents: WsCandleEvent[];
  connected: boolean;
}

export const useWebSocket = (): UseWebSocketReturn => {
  const [snapshots, setSnapshots]     = useState<Record<string, OrderBookSnapshot>>({});
  const [tradeEvents, setTradeEvents] = useState<WsTradeEvent[]>([]);
  const [candleEvents, setCandleEvents] = useState<WsCandleEvent[]>([]);
  const [connected, setConnected]     = useState(false);

  const wsRef      = useRef<WebSocket | null>(null);
  const backoffRef = useRef(500);
  const mountedRef = useRef(true);

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
        const data = JSON.parse(e.data as string) as WsMessage;

        if (data.event === 'trade') {
          setTradeEvents(prev => [data, ...prev].slice(0, 100));
          return;
        }
        
        if (data.event === 'candle') {
          setCandleEvents(prev => [data, ...prev].slice(0, 100));
          return;
        }

        if (data.event === 'depth') {
          // depth snapshot
          if (data.scrip) {
            setSnapshots(prev => ({ ...prev, [data.scrip]: data }));
          }
        }
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
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
    };
  }, [connect]);

  return { snapshots, tradeEvents, candleEvents, connected };
};
