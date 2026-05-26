import { useQuery } from '@tanstack/react-query';
import {
  type CandlestickData,
  ColorType,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
  createChart,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { Box, Button, Stack, Text } from '../../design-system/index.js';
import { color } from '../../design-system/tokens.js';
import { api, type Bucket } from '../../lib/api.js';
import { formatGoldShort } from '../../lib/currency.js';

type Mode = 'candles' | 'line';

const BUCKET_LABEL: Record<Bucket, string> = {
  hour: '1H',
  day: '1D',
  week: '1W',
  month: '1M',
};

const BUCKET_WORD: Record<Bucket, string> = {
  hour: 'hourly',
  day: 'daily',
  week: 'weekly',
  month: 'monthly',
};

function bucketLabel(b: Bucket) {
  return BUCKET_WORD[b];
}
type Series = 'nerfed:buyout_median' | 'nerfed:buyout_min' | 'nerfed:bid_median' | 'nerfed:bid_mean';

const SERIES_LABEL: Record<Series, string> = {
  'nerfed:buyout_median': 'Median',
  'nerfed:buyout_min': 'Min',
  'nerfed:bid_median': 'Bid med',
  'nerfed:bid_mean': 'Bid mean',
};

// Live (Auctionator) sources are always included; only the historical (nerfed) series
// is swappable. Listing-bot floor prices push buyout_min near zero, so median is the
// sensible default.
function sourcesFor(series: Series): string {
  return ['db', 'history', series].join(',');
}

type Props = {
  itemId: number;
  itemName: string;
};

const copperToGold = (c: number) => c / 10000;

export function PriceChart({ itemId, itemName }: Props) {
  const [mode, setMode] = useState<Mode>('line');
  // OHLC needs multiple observations per bucket; nerfed is 1 sample/day, so default
  // to a coarser bucket when in OHLC mode so candles actually have range.
  const [bucket, setBucket] = useState<Bucket>('day');
  const [series, setSeries] = useState<Series>('nerfed:buyout_median');

  // When the user switches to OHLC, nudge bucket from 1D → 1W so candles look right.
  useEffect(() => {
    if (mode === 'candles' && (bucket === 'hour' || bucket === 'day')) setBucket('week');
    if (mode === 'line' && bucket === 'month') setBucket('day');
    // Only react to mode flips; user can still freely choose bucket after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const { data: candleData } = useQuery({
    queryKey: ['candles', itemId, bucket, series],
    queryFn: () => api.candles(itemId, bucket, sourcesFor(series)),
  });

  const { data: volumeData } = useQuery({
    queryKey: ['candles', itemId, bucket, 'nerfed:quantity'],
    queryFn: () => api.candles(itemId, bucket, 'nerfed:quantity'),
  });

  const { data: scanData } = useQuery({
    queryKey: ['scans', itemId, series],
    queryFn: () => api.scans(itemId, sourcesFor(series)),
    enabled: mode === 'line',
  });

  return (
    <Stack gap={3} style={{ height: '100%' }}>
      <Stack direction="row" justify="between" align="center">
        <Stack gap={1}>
          <Text size={5} weight="medium">
            {itemName}
          </Text>
          <Text size={2} muted>
            {candleData?.candles.length ?? 0} {bucketLabel(bucket)} buckets · showing{' '}
            {SERIES_LABEL[series]} buyout · prices in gold
          </Text>
        </Stack>
        <Stack direction="row" gap={2}>
          <ToggleGroup
            value={series}
            onChange={setSeries}
            options={(Object.keys(SERIES_LABEL) as Series[]).map((s) => ({
              v: s,
              label: SERIES_LABEL[s],
            }))}
          />
          <ToggleGroup
            value={mode}
            onChange={setMode}
            options={[
              { v: 'candles', label: 'OHLC' },
              { v: 'line', label: 'Line' },
            ]}
          />
          <ToggleGroup
            value={bucket}
            onChange={setBucket}
            options={(Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => ({
              v: b,
              label: BUCKET_LABEL[b],
            }))}
          />
        </Stack>
      </Stack>
      <Box flex={1} style={{ position: 'relative', minHeight: 0 }}>
        <ChartCanvas
          mode={mode}
          candles={candleData?.candles ?? []}
          scans={scanData?.scans ?? []}
          volume={volumeData?.candles ?? []}
        />
      </Box>
    </Stack>
  );
}

function ToggleGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { v: T; label: string }[];
}) {
  return (
    <Stack direction="row" gap={1}>
      {options.map((o) => (
        <Button
          key={o.v}
          size="sm"
          variant={o.v === value ? 'solid' : 'soft'}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </Button>
      ))}
    </Stack>
  );
}

type Candle = { bucket: number; open: number; high: number; low: number; close: number; volume: number };
type Scan = { observedAt: number; pricePerUnit: number; stackSize: number };

function ChartCanvas({
  mode,
  candles,
  scans,
  volume,
}: {
  mode: Mode;
  candles: Candle[];
  scans: Scan[];
  volume: Candle[]; // we reuse the candles endpoint for quantity; close = quantity for that day
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: color.surface },
        textColor: color.text,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: color.border },
        horzLines: { color: color.border },
      },
      rightPriceScale: {
        borderColor: color.border,
        autoScale: true,
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: { borderColor: color.border, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
      autoSize: true,
      localization: {
        priceFormatter: (p: number) => `${p.toFixed(2)}g`,
      },
    });
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // Price series — recreated whenever mode changes; data refreshed whenever data changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (priceSeriesRef.current) {
      chart.removeSeries(priceSeriesRef.current);
      priceSeriesRef.current = null;
    }

    if (mode === 'candles') {
      const series = chart.addCandlestickSeries({
        upColor: color.up,
        downColor: color.down,
        wickUpColor: color.up,
        wickDownColor: color.down,
        borderVisible: false,
      });
      const data: CandlestickData[] = candles
        .filter((c) => c.bucket > 0)
        .map((c) => ({
          time: c.bucket as Time,
          open: copperToGold(c.open),
          high: copperToGold(c.high),
          low: copperToGold(c.low),
          close: copperToGold(c.close),
        }));
      series.setData(data);
      priceSeriesRef.current = series;
    } else {
      const series = chart.addLineSeries({ color: color.up, lineWidth: 2 });
      const data: LineData[] = scans
        .map((s) => ({ time: s.observedAt as Time, value: copperToGold(s.pricePerUnit) }))
        .sort((a, b) => (a.time as number) - (b.time as number));
      series.setData(data);
      priceSeriesRef.current = series;
    }

    // Force the price axis to refit to the new data and snap the time axis to content.
    priceSeriesRef.current
      ?.priceScale()
      .applyOptions({ autoScale: true, scaleMargins: { top: 0.1, bottom: 0.25 } });
    chart.timeScale().fitContent();
  }, [mode, candles, scans]);

  // Volume histogram — overlay on its own scale at the bottom 20% of the pane.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (volumeSeriesRef.current) {
      chart.removeSeries(volumeSeriesRef.current);
      volumeSeriesRef.current = null;
    }

    const points = volume.filter((c) => c.bucket > 0 && c.volume > 0);
    if (points.length === 0) return;

    const series = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      color: color.border,
    });
    series.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    // `volume` here actually carries the per-bucket count (the candles endpoint stamps
    // close = the last quantity in the bucket). Use close as the histogram value.
    const data: HistogramData[] = points.map((c) => ({
      time: c.bucket as Time,
      value: c.close,
      color: 'rgba(120, 130, 145, 0.5)',
    }));
    series.setData(data);
    volumeSeriesRef.current = series;
  }, [volume]);

  // OHLC / price readout under the cursor (small legend in top-left)
  const [hover, setHover] = useState<string>('');
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const handler = (param: { time?: Time; seriesData: Map<unknown, unknown> }) => {
      if (!param.time || param.seriesData.size === 0) {
        setHover('');
        return;
      }
      const first = Array.from(param.seriesData.values())[0] as
        | { value?: number; close?: number; open?: number; high?: number; low?: number }
        | undefined;
      if (!first) {
        setHover('');
        return;
      }
      if (first.close != null && first.open != null) {
        setHover(
          `O ${first.open?.toFixed(2)}  H ${first.high?.toFixed(2)}  L ${first.low?.toFixed(2)}  C ${first.close?.toFixed(2)}g`,
        );
      } else if (first.value != null) {
        setHover(formatGoldShort(Math.round(first.value * 10000)));
      }
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, []);

  return (
    <Box style={{ position: 'relative', height: '100%' }}>
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
      {hover ? (
        <Box
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            padding: '2px 6px',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-2)',
            fontFamily: 'var(--font-family-mono)',
            fontSize: 'var(--font-2)',
            pointerEvents: 'none',
          }}
        >
          {hover}
        </Box>
      ) : null}
    </Box>
  );
}
