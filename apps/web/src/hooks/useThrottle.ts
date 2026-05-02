import { useState, useEffect, useRef } from 'react';

/**
 * Returns a throttled copy of `value` that updates at most `fps` times
 * per second. Values that arrive between ticks are coalesced — only the
 * latest value is emitted on the next tick (no queue build-up).
 *
 * @param value  The reactive value to throttle
 * @param fps    Max updates per second (default 2)
 */
export const useThrottle = <T>(value: T, fps: number = 2): T => {
  const [throttled, setThrottled] = useState<T>(value);
  const pendingRef  = useRef<T>(value);
  const lastEmitRef = useRef<number>(0);

  // Track latest value without causing re-renders
  pendingRef.current = value;

  useEffect(() => {
    const interval = 1000 / fps;

    const tick = () => {
      const now = Date.now();
      if (now - lastEmitRef.current >= interval) {
        lastEmitRef.current = now;
        setThrottled(pendingRef.current);
      }
    };

    const id = setInterval(tick, interval);
    return () => clearInterval(id);
  }, [fps]);

  return throttled;
};
