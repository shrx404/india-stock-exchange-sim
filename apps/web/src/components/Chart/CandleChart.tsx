import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type HistogramData,
  type UTCTimestamp,
  type IPriceLine,
} from 'lightweight-charts';
import type { CandleBar, WsCandleEvent, PortfolioPosition } from '../../types/exchange';

interface Props {
  scrip: string;
  candleEvents: WsCandleEvent[];
  position?: PortfolioPosition;
}

const API = 'http://localhost:8000';

function calculateEMA(data: CandleBar[], period: number): LineData[] {
  const k = 2 / (period + 1);
  const emaData: LineData[] = [];
  let ema: number | undefined = undefined;
  
  for (const bar of data) {
    if (ema === undefined) {
      ema = bar.close;
    } else {
      ema = bar.close * k + ema * (1 - k);
    }
    emaData.push({
      time: (new Date(bar.time).getTime() / 1000) as UTCTimestamp,
      value: ema,
    });
  }
  return emaData;
}

export const CandleChart = ({ scrip, candleEvents, position }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  
  // Series refs
  const seriesRef    = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const vwapRef      = useRef<ISeriesApi<'Line'> | null>(null);
  const ema9Ref      = useRef<ISeriesApi<'Line'> | null>(null);
  const ema21Ref     = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);

  // Cumulative session data for live VWAP updates
  const sessionVwapState = useRef({ cumVol: 0, cumPriceVol: 0 });

  // Handle position price line
  useEffect(() => {
    if (!seriesRef.current) return;
    
    // Remove existing
    if (priceLineRef.current) {
      seriesRef.current.removePriceLine(priceLineRef.current);
      priceLineRef.current = null;
    }

    if (position && position.netQty !== 0) {
      const isLong = position.netQty > 0;
      priceLineRef.current = seriesRef.current.createPriceLine({
        price: position.avgPrice,
        color: isLong ? '#3ddc84' : '#f05050',
        lineWidth: 2,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: `Avg: ₹${position.avgPrice.toFixed(2)}`,
      });
    }
  }, [position]);

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
    
    const volSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: '', // Overlay on chart
    });

    chart.priceScale('').applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    const vwapSeries = chart.addSeries(LineSeries, {
      color: '#f0c040',
      lineWidth: 2,
      crosshairMarkerVisible: false,
    });

    const ema9Series = chart.addSeries(LineSeries, {
      color: '#2962FF',
      lineWidth: 1,
      crosshairMarkerVisible: false,
    });

    const ema21Series = chart.addSeries(LineSeries, {
      color: '#FF6D00',
      lineWidth: 1,
      crosshairMarkerVisible: false,
    });

    chartRef.current  = chart;
    seriesRef.current = series;
    volSeriesRef.current = volSeries;
    vwapRef.current = vwapSeries;
    ema9Ref.current = ema9Series;
    ema21Ref.current = ema21Series;

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

        const bars: CandlestickData[] = [];
        const vols: HistogramData[] = [];
        const vwaps: LineData[] = [];
        
        let cumVol = 0;
        let cumPriceVol = 0;

        data.forEach(c => {
          const time = (new Date(c.time).getTime() / 1000) as UTCTimestamp;
          
          bars.push({ time, open: c.open, high: c.high, low: c.low, close: c.close });
          
          vols.push({
            time,
            value: c.volume,
            color: c.close >= c.open ? 'rgba(61, 220, 132, 0.4)' : 'rgba(240, 80, 80, 0.4)'
          });

          // Session VWAP approximation
          cumVol += c.volume;
          cumPriceVol += ((c.high + c.low + c.close) / 3) * c.volume;
          vwaps.push({
            time,
            value: cumVol > 0 ? cumPriceVol / cumVol : c.close
          });
        });

        // Store cumulative values for real-time updates
        sessionVwapState.current = { cumVol, cumPriceVol };

        seriesRef.current?.setData(bars);
        volSeriesRef.current?.setData(vols);
        vwapRef.current?.setData(vwaps);
        ema9Ref.current?.setData(calculateEMA(data, 9));
        ema21Ref.current?.setData(calculateEMA(data, 21));

        chartRef.current?.timeScale().fitContent();
      } catch {
        // no candles yet — ignore
      }
    };

    fetchCandles();
    const id = setInterval(fetchCandles, 5_000);
    return () => clearInterval(id);
  }, [scrip]);

  // Apply real-time candle updates
  useEffect(() => {
    if (!seriesRef.current || candleEvents.length === 0) return;
    
    // We only care about the latest candle event for the active scrip
    const latestEvent = candleEvents.find(e => e.scrip === scrip);
    if (latestEvent) {
      const c = latestEvent.candle;
      const time = (new Date(c.time).getTime() / 1000) as UTCTimestamp;
      
      seriesRef.current.update({
        time,
        open : c.open,
        high : c.high,
        low  : c.low,
        close: c.close,
      });

      volSeriesRef.current?.update({
        time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(61, 220, 132, 0.4)' : 'rgba(240, 80, 80, 0.4)'
      });
      
      // Calculate real-time VWAP update (approximate without storing full tick history)
      const { cumVol, cumPriceVol } = sessionVwapState.current;
      const newCumVol = cumVol + c.volume;
      const newCumPriceVol = cumPriceVol + (((c.high + c.low + c.close) / 3) * c.volume);
      const vwapValue = newCumVol > 0 ? newCumPriceVol / newCumVol : c.close;
      
      vwapRef.current?.update({
        time,
        value: vwapValue
      });
      
      // Note: Updating real-time EMA requires the previous EMA value, which Lightweight Charts
      // does not easily expose. Since we poll /candles every 5 seconds, the EMAs will refresh
      // frequently enough. Real-time updates for EMA are skipped here to avoid maintaining complex state.
    }
  }, [candleEvents, scrip]);

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
