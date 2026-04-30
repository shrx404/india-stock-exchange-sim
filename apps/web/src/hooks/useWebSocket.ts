import { useEffect, useRef, useState } from 'react';
import type { OrderBookSnapshot } from '../types/exchange';

const WS_URL = 'ws://localhost:8000/ws';

export function useWebSocket() {
  const [snapshot, setSnapshot] = useState<OrderBookSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    const socket = new WebSocket(WS_URL);
    ws.current = socket;

    socket.onopen = () => {
      setConnected(true);
      console.log('WS connected');
    };

    socket.onmessage = (e) => {
      try {
        const data: OrderBookSnapshot = JSON.parse(e.data);
        setSnapshot(data);
      } catch {
        console.error('WS parse error', e.data);
      }
    };

    socket.onclose = () => {
      setConnected(false);
      console.log('WS disconnected');
    };

    return () => socket.close();
  }, []);

  return { snapshot, connected };
}
