import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { CandleBar } from '../../types/exchange';

interface Props {
  scrip: string;
}

const API = 'http://localhost:8000';

export const CandleChart = ({ scrip }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<'Candlestick'> | null>(null);

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#0f0f0f' },
        textColor  : '#888',
      },
      grid: {
        vertLines  : { color: '#1a1a1a' },
        horzLines  : { color: '#1a1a1a' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#222' },
      timeScale: {
        borderColor    : '#222',
        timeVisible    : true,
        secondsVisible : false,
      },
      width : containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor       : '#3ddc84',
      downColor     : '#f05050',
      borderVisible : false,
      wickUpColor   : '#3ddc84',
      wickDownColor : '#f05050',
    });

    chartRef.current  = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, []);

  // Fetch & refresh candle data when scrip changes
  useEffect(() => {
    if (!seriesRef.current) return;

    const fetchCandles = async () => {
      try {
        const res  = await fetch(`${API}/candles/${scrip}`);
        const data: CandleBar[] = await res.json();
        if (!Array.isArray(data) || data.length === 0) return;

        const bars: CandlestickData[] = data.map(c => ({
          time : (new Date(c.time).getTime() / 1000) as UTCTimestamp,
          open : c.open,
          high : c.high,
          low  : c.low,
          close: c.close,
        }));

        seriesRef.current?.setData(bars);
        chartRef.current?.timeScale().fitContent();
      } catch {
        // no candles yet — ignore
      }
    };

    fetchCandles();
    const id = setInterval(fetchCandles, 5_000);
    return () => clearInterval(id);
  }, [scrip]);

  return (
    <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
      <div
        style={{
          position  : 'absolute',
          top       : 8,
          left      : 12,
          color     : '#555',
          fontSize  : 10,
          letterSpacing: 1,
          zIndex    : 1,
        }}
      >
        {scrip} · 1 MIN
      </div>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};
