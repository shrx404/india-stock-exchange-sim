import { useEffect, useRef, useState, useCallback } from 'react';
import type { OrderBookSnapshot, WsTradeEvent } from '../types/exchange';

const WS_URL = 'ws://localhost:8000/ws';
const MAX_BACKOFF_MS = 10_000;

export interface UseWebSocketReturn {
  snapshots: Record<string, OrderBookSnapshot>;
  tradeEvents: WsTradeEvent[];
  connected: boolean;
}

export const useWebSocket = (): UseWebSocketReturn => {
  const [snapshots, setSnapshots]     = useState<Record<string, OrderBookSnapshot>>({});
  const [tradeEvents, setTradeEvents] = useState<WsTradeEvent[]>([]);
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
        const data = JSON.parse(e.data as string);

        if (data.event === 'trade') {
          setTradeEvents(prev => [data as WsTradeEvent, ...prev].slice(0, 100));
          return;
        }

        // depth snapshot
        const snap = data as OrderBookSnapshot;
        if (snap.scrip) {
          setSnapshots(prev => ({ ...prev, [snap.scrip]: snap }));
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

  return { snapshots, tradeEvents, connected };
};
