import { useQuery } from '@tanstack/react-query';
import {
  AreaSeries,
  CandlestickSeries,
  type CandlestickData,
  ColorType,
  HistogramSeries,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  type LineData,
  type Time,
  createChart,
} from 'lightweight-charts';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  LineChart as LineIcon,
  AreaChart as AreaIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Stack, Text } from '../../design-system/index.js';
import { color } from '../../design-system/tokens.js';
import { api, type Bucket, type CandleRow } from '../../lib/api.js';
import { formatGoldShort } from '../../lib/currency.js';

type Mode = 'candles' | 'line';
type VolumeMode = 'histogram' | 'line' | 'area' | 'candles';
type Series =
  | 'nerfed:buyout_median'
  | 'nerfed:buyout_min'
  | 'nerfed:bid_median'
  | 'nerfed:bid_mean';
type Range = '30d' | '90d' | '180d' | '1y' | 'all';

const SERIES_LABEL: Record<Series, string> = {
  'nerfed:buyout_median': 'Median',
  'nerfed:buyout_min': 'Min',
  'nerfed:bid_median': 'Bid med',
  'nerfed:bid_mean': 'Bid mean',
};

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

// Range = how much HISTORY to show. Bucket = how each candle is AGGREGATED. They
// used to collide because both groups had a "1M" button — range labels were
// renamed to "30d / 90d / 180d / 1y / all" to remove the ambiguity.
const RANGE_DAYS: Record<Range, number | null> = {
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '1y': 365,
  all: null,
};

const COPPER = 10000;
const copperToGold = (c: number) => c / COPPER;

function sourcesFor(series: Series): string {
  return ['db', 'history', series].join(',');
}

type Props = {
  itemId: number;
  itemName: string;
};

export function PriceChart({ itemId, itemName }: Props) {
  const [mode, setMode] = useState<Mode>('line');
  const [volumeMode, setVolumeMode] = useState<VolumeMode>('histogram');
  const [bucket, setBucket] = useState<Bucket>('day');
  const [series, setSeries] = useState<Series>('nerfed:buyout_median');
  const [range, setRange] = useState<Range>('90d');

  // Switching to OHLC nudges bucket to 1W so candles have intra-bucket range.
  useEffect(() => {
    if (mode === 'candles' && (bucket === 'hour' || bucket === 'day')) setBucket('week');
    if (mode === 'line' && bucket === 'month') setBucket('day');
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

  const allCandles = candleData?.candles ?? [];
  const allVolume = volumeData?.candles ?? [];

  const kpis = useMemo(() => computeKpis(allCandles), [allCandles]);

  // Clip data to the selected time range so auto-scale fits recent action.
  const rangeStart = useMemo(() => {
    const days = RANGE_DAYS[range];
    if (days == null) return 0;
    const last = allCandles.at(-1)?.bucket ?? allVolume.at(-1)?.bucket;
    if (!last) return 0;
    return last - days * 86400;
  }, [range, allCandles, allVolume]);

  return (
    <Stack gap={5} style={{ height: '100%', minHeight: 0 }}>
      <Stack direction="row" justify="between" align="start" gap={5} wrap>
        <Stack gap={1}>
          <Text size={5} weight="medium">
            {itemName}
          </Text>
          <Text size={2} muted>
            {allCandles.length} {BUCKET_WORD[bucket]} buckets · {SERIES_LABEL[series]} buyout
          </Text>
        </Stack>
        <Stack direction="row" gap={3} wrap align="end">
          <LabeledGroup label="series">
            <ToggleGroup
              value={series}
              onChange={setSeries}
              options={(Object.keys(SERIES_LABEL) as Series[]).map((s) => ({
                v: s,
                label: SERIES_LABEL[s],
              }))}
            />
          </LabeledGroup>
          <LabeledGroup label="price">
            <ToggleGroup
              value={mode}
              onChange={setMode}
              options={[
                { v: 'candles', label: 'OHLC', icon: <BarChart3 size={14} /> },
                { v: 'line', label: 'Line', icon: <LineIcon size={14} /> },
              ]}
            />
          </LabeledGroup>
          <LabeledGroup label="volume">
            <ToggleGroup
              value={volumeMode}
              onChange={setVolumeMode}
              options={[
                { v: 'histogram', label: 'Bar', icon: <BarChart3 size={14} /> },
                { v: 'line', label: 'Line', icon: <LineIcon size={14} /> },
                { v: 'area', label: 'Area', icon: <AreaIcon size={14} /> },
                { v: 'candles', label: 'OHLC', icon: <BarChart3 size={14} /> },
              ]}
            />
          </LabeledGroup>
          <LabeledGroup label="bucket">
            <ToggleGroup
              value={bucket}
              onChange={setBucket}
              options={(Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => ({
                v: b,
                label: BUCKET_LABEL[b],
              }))}
            />
          </LabeledGroup>
        </Stack>
      </Stack>

      <KpiStrip kpis={kpis} />

      <Stack direction="row" justify="between" align="center">
        <LabeledGroup label="range">
          <ToggleGroup
            value={range}
            onChange={setRange}
            options={(Object.keys(RANGE_DAYS) as Range[]).map((r) => ({ v: r, label: r }))}
          />
        </LabeledGroup>
      </Stack>

      <Box flex={1} style={{ position: 'relative', minHeight: 0 }}>
        <ChartCanvas
          mode={mode}
          volumeMode={volumeMode}
          candles={allCandles}
          scans={scanData?.scans ?? []}
          volume={allVolume}
          rangeStart={rangeStart}
        />
      </Box>
    </Stack>
  );
}

// ---------- KPIs ----------

type Kpis = {
  current: number | null;
  change24h: number | null;
  change7d: number | null;
  change30d: number | null;
  ath: number | null;
  atl: number | null;
};

function computeKpis(candles: CandleRow[]): Kpis {
  if (candles.length === 0) {
    return { current: null, change24h: null, change7d: null, change30d: null, ath: null, atl: null };
  }
  const last = candles[candles.length - 1];
  const lastTs = last.bucket;
  const current = last.close;

  const findClose = (deltaDays: number): number | null => {
    const target = lastTs - deltaDays * 86400;
    let candidate: CandleRow | null = null;
    for (let i = candles.length - 1; i >= 0; i--) {
      if (candles[i].bucket <= target) {
        candidate = candles[i];
        break;
      }
    }
    return candidate?.close ?? null;
  };

  const pct = (now: number, then: number | null): number | null => {
    if (then == null || then === 0) return null;
    return (now - then) / then;
  };

  let ath = Number.NEGATIVE_INFINITY;
  let atl = Number.POSITIVE_INFINITY;
  for (const c of candles) {
    if (c.high > ath) ath = c.high;
    if (c.low < atl) atl = c.low;
  }

  return {
    current,
    change24h: pct(current, findClose(1)),
    change7d: pct(current, findClose(7)),
    change30d: pct(current, findClose(30)),
    ath: Number.isFinite(ath) ? ath : null,
    atl: Number.isFinite(atl) ? atl : null,
  };
}

function KpiStrip({ kpis }: { kpis: Kpis }) {
  return (
    <Box
      bg="bg"
      border="border"
      radius={3}
      py={4}
      px={5}
      style={{
        background:
          'linear-gradient(135deg, var(--color-bg) 0%, color-mix(in srgb, var(--color-surface) 60%, var(--color-bg)) 100%)',
      }}
    >
      <Stack direction="row" gap={6} wrap>
        <Kpi label="Current" value={formatGoldShort(kpis.current)} />
        <Divider />
        <Kpi label="24h" change={kpis.change24h} />
        <Kpi label="7d" change={kpis.change7d} />
        <Kpi label="30d" change={kpis.change30d} />
        <Divider />
        <Kpi label="ATH" value={formatGoldShort(kpis.ath)} />
        <Kpi label="ATL" value={formatGoldShort(kpis.atl)} />
      </Stack>
    </Box>
  );
}

function Divider() {
  return (
    <div
      style={{
        width: 1,
        alignSelf: 'stretch',
        background: 'var(--color-border)',
        opacity: 0.5,
      }}
    />
  );
}

function Kpi({
  label,
  value,
  change,
}: {
  label: string;
  value?: string;
  change?: number | null;
}) {
  const isChange = change !== undefined;
  if (isChange) {
    const c = change == null ? null : change >= 0 ? 'up' : 'down';
    const Icon = c === 'up' ? ArrowUp : c === 'down' ? ArrowDown : null;
    return (
      <Stack gap={1}>
        <Text size={1} muted>
          {label}
        </Text>
        <Stack direction="row" align="center" gap={1}>
          {Icon ? <Icon size={14} color={c === 'up' ? color.up : color.down} /> : null}
          <Text size={3} mono color={c ?? undefined}>
            {change == null ? '—' : `${Math.abs(change * 100).toFixed(1)}%`}
          </Text>
        </Stack>
      </Stack>
    );
  }
  return (
    <Stack gap={1}>
      <Text size={1} muted>
        {label}
      </Text>
      <Text size={3} mono>
        {value ?? '—'}
      </Text>
    </Stack>
  );
}

// ---------- Toggle ----------

function LabeledGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack gap={1}>
      <Text size={1} muted style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </Text>
      {children}
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
  options: { v: T; label: string; icon?: React.ReactNode }[];
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
          {o.icon}
          {o.label}
        </Button>
      ))}
    </Stack>
  );
}

// ---------- Chart canvas ----------

type Scan = { observedAt: number; pricePerUnit: number };

function ChartCanvas({
  mode,
  volumeMode,
  candles,
  scans,
  volume,
  rangeStart,
}: {
  mode: Mode;
  volumeMode: VolumeMode;
  candles: CandleRow[];
  scans: Scan[];
  volume: CandleRow[];
  rangeStart: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<
    | ISeriesApi<'Histogram'>
    | ISeriesApi<'Line'>
    | ISeriesApi<'Area'>
    | ISeriesApi<'Candlestick'>
    | null
  >(null);

  // Create chart once. Volume goes in pane index 1; price stays in pane 0.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        // Chart bg is the page bg (darker than the card) so the card's 32px inner
        // padding actually *shows* — when they were both color.surface the chart
        // melted into the card and made it look like there was no padding at all.
        background: { type: ColorType.Solid, color: color.bg },
        textColor: color.text,
        fontSize: 11,
        fontFamily:
          'Inter Variable, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        timeVisible: true,
        secondsVisible: false,
      },
      // mode: 0 = free crosshair (follows the mouse). 1 = Magnet (snaps to the
      // nearest data point), which felt like the chart was "stealing" the mouse.
      crosshair: { mode: 0 },
      autoSize: true,
    });
    // Pane creation is deferred to the volume-series effect. addPane() defaults to
    // preserveEmptyPane=false, so creating it here without immediately attaching a
    // series gets it auto-removed before the volume effect can target paneIndex=1.

    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // Price series — pane 0. Custom formatter for sub-gold values.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (priceSeriesRef.current) {
      chart.removeSeries(priceSeriesRef.current);
      priceSeriesRef.current = null;
    }

    const priceFormat = {
      type: 'custom' as const,
      formatter: (p: number) => (p >= 1 ? `${p.toFixed(2)}g` : `${(p * 100).toFixed(1)}s`),
      minMove: 0.0001,
    };

    let s: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'>;
    if (mode === 'candles') {
      s = chart.addSeries(
        CandlestickSeries,
        {
          upColor: color.up,
          downColor: color.down,
          wickUpColor: color.up,
          wickDownColor: color.down,
          borderVisible: false,
          priceFormat,
        },
        0,
      );
      const data: CandlestickData[] = candles
        .filter((c) => c.bucket > 0)
        .map((c) => ({
          time: c.bucket as Time,
          open: copperToGold(c.open),
          high: copperToGold(c.high),
          low: copperToGold(c.low),
          close: copperToGold(c.close),
        }));
      s.setData(data);
    } else {
      s = chart.addSeries(
        LineSeries,
        {
          color: color.up,
          lineWidth: 2,
          priceFormat,
          priceLineVisible: false,
          lastValueVisible: true,
        },
        0,
      );
      const data: LineData[] = scans
        .map((sc) => ({ time: sc.observedAt as Time, value: copperToGold(sc.pricePerUnit) }))
        .sort((a, b) => (a.time as number) - (b.time as number));
      s.setData(data);
    }

    // Tight margins on price scale, and clamp the autoscale lower bound to 0 so the
    // axis can't drift below zero gold.
    s.priceScale().applyOptions({
      autoScale: true,
      scaleMargins: { top: 0.08, bottom: 0.08 },
    });
    s.applyOptions({
      autoscaleInfoProvider: (orig: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const info = orig();
        if (info?.priceRange) {
          info.priceRange.minValue = Math.max(0, info.priceRange.minValue);
        }
        return info;
      },
    });
    priceSeriesRef.current = s;
  }, [mode, candles, scans]);

  // Volume pane (pane index 1) — separate from price. Switchable between Bar / Line
  // / Area / OHLC because none of the four is universally best: histogram is the
  // TradingView default but lines/areas reveal trends, and OHLC is meaningful for
  // weekly+ buckets where multiple daily counts roll up.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Stash the previous series; remove it only AFTER the new one is in place. If
    // we removed it first, pane 1 would briefly have zero series and v5 would
    // garbage-collect it — then addSeries(..., 1) silently falls back to pane 0.
    const prevSeries = volumeSeriesRef.current;
    volumeSeriesRef.current = null;

    // Create pane 1 if it's still missing (e.g. first run, or HMR).
    while (chart.panes().length < 2) chart.addPane(true);

    const points = volume.filter((c) => c.bucket > 0 && c.close > 0);
    // Even with no data we keep an empty series alive in pane 1 so the pane doesn't
    // disappear when the user toggles to a series/range that has zero volume.
    const hasPoints = points.length > 0;

    // Per-bucket direction colour map, driven by the price series so volume bars
    // green/red follow price closes (TradingView convention).
    const priceByBucket = new Map<number, number>();
    for (const c of candles) priceByBucket.set(c.bucket, c.close);
    const sortedBuckets = [...priceByBucket.keys()].sort((a, b) => a - b);
    const priceDirAtBucket = (bucket: number): 'up' | 'down' | null => {
      const close = priceByBucket.get(bucket);
      if (close == null) return null;
      const idx = sortedBuckets.indexOf(bucket);
      if (idx <= 0) return null;
      const prev = priceByBucket.get(sortedBuckets[idx - 1]);
      if (prev == null) return null;
      return close >= prev ? 'up' : 'down';
    };

    const volPriceFormat = { type: 'volume' as const };
    let s:
      | ISeriesApi<'Histogram'>
      | ISeriesApi<'Line'>
      | ISeriesApi<'Area'>
      | ISeriesApi<'Candlestick'>;

    if (volumeMode === 'histogram') {
      s = chart.addSeries(
        HistogramSeries,
        { priceFormat: volPriceFormat, color: 'rgba(120, 130, 145, 0.55)' },
        1,
      );
      const data: HistogramData[] = hasPoints
        ? points.map((c) => {
            const dir = priceDirAtBucket(c.bucket);
            const col =
              dir === 'up'
                ? 'rgba(38, 166, 154, 0.6)'
                : dir === 'down'
                  ? 'rgba(239, 83, 80, 0.6)'
                  : 'rgba(120, 130, 145, 0.5)';
            return { time: c.bucket as Time, value: c.close, color: col };
          })
        : [];
      s.setData(data);
    } else if (volumeMode === 'line') {
      s = chart.addSeries(
        LineSeries,
        { priceFormat: volPriceFormat, color: 'rgba(180, 195, 215, 0.9)', lineWidth: 1 },
        1,
      );
      const data: LineData[] = hasPoints
        ? points
            .map((c) => ({ time: c.bucket as Time, value: c.close }))
            .sort((a, b) => (a.time as number) - (b.time as number))
        : [];
      s.setData(data);
    } else if (volumeMode === 'area') {
      s = chart.addSeries(
        AreaSeries,
        {
          priceFormat: volPriceFormat,
          lineColor: 'rgba(180, 195, 215, 0.9)',
          topColor: 'rgba(120, 130, 145, 0.45)',
          bottomColor: 'rgba(120, 130, 145, 0.05)',
          lineWidth: 1,
        },
        1,
      );
      const data: LineData[] = hasPoints
        ? points
            .map((c) => ({ time: c.bucket as Time, value: c.close }))
            .sort((a, b) => (a.time as number) - (b.time as number))
        : [];
      s.setData(data);
    } else {
      // OHLC — uses the open/high/low/close already provided by the candles endpoint
      // for the nerfed:quantity source. At daily granularity these are degenerate
      // (O=H=L=C), but at weekly+ they show real range.
      s = chart.addSeries(
        CandlestickSeries,
        {
          upColor: color.up,
          downColor: color.down,
          wickUpColor: color.up,
          wickDownColor: color.down,
          borderVisible: false,
          priceFormat: volPriceFormat,
        },
        1,
      );
      const data: CandlestickData[] = hasPoints
        ? points.map((c) => ({
            time: c.bucket as Time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }))
        : [];
      s.setData(data);
    }

    // Use stretch factors so the price/volume split stays proportional. setHeight(N)
    // was making the price pane collapse when the chart resized — setStretchFactor
    // gives us a stable 4:1 split regardless of total height.
    const panes = chart.panes();
    if (panes.length > 1) {
      panes[0].setStretchFactor(4);
      panes[1].setStretchFactor(1);
    }

    volumeSeriesRef.current = s;

    // Now it's safe to drop the old series — pane 1 still has the new one, so it
    // won't collapse.
    if (prevSeries) {
      try {
        chart.removeSeries(prevSeries);
      } catch {
        // Series already gone (e.g. chart was disposed mid-effect).
      }
    }
  }, [volume, candles, volumeMode]);

  // Range selector → visible window; Y auto-fits to that window in each pane.
  // Wrap setVisibleRange — lightweight-charts throws "Value is null" if it's called
  // before any series has plotted data (effect order is unstable across renders).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    try {
      if (rangeStart > 0) {
        const last = candles.at(-1)?.bucket ?? volume.at(-1)?.bucket;
        if (last && last > rangeStart) {
          chart.timeScale().setVisibleRange({ from: rangeStart as Time, to: last as Time });
          return;
        }
      }
      chart.timeScale().fitContent();
    } catch {
      // Series not ready yet; next render after setData will retry.
    }
  }, [rangeStart, candles, volume]);

  // Hover legend (date + price + volume)
  const [hover, setHover] = useState<HoverState | null>(null);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const priceSeries = priceSeriesRef.current;
    const volSeries = volumeSeriesRef.current;
    const handler = (param: { time?: Time; seriesData: Map<unknown, unknown> }) => {
      if (!param.time || param.seriesData.size === 0) {
        setHover(null);
        return;
      }
      const price = priceSeries
        ? (param.seriesData.get(priceSeries) as PriceHoverData | undefined)
        : undefined;
      const vol = volSeries
        ? (param.seriesData.get(volSeries) as { value?: number } | undefined)
        : undefined;
      setHover({
        ts: Number(param.time),
        price: price ?? null,
        volume: vol?.value ?? null,
      });
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, [mode, candles, scans, volume]);

  return (
    <Box style={{ position: 'relative', height: '100%' }}>
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
      <HoverLegend hover={hover} mode={mode} />
    </Box>
  );
}

type PriceHoverData =
  | { value: number }
  | { open: number; high: number; low: number; close: number };

type HoverState = {
  ts: number;
  price: PriceHoverData | null;
  volume: number | null;
};

function HoverLegend({ hover, mode }: { hover: HoverState | null; mode: Mode }) {
  if (!hover) return null;
  const date = new Date(hover.ts * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const fmtGold = (g: number) => (g >= 1 ? `${g.toFixed(2)}g` : `${(g * 100).toFixed(1)}s`);
  let priceText = '—';
  if (hover.price) {
    if (mode === 'candles' && 'open' in hover.price) {
      const p = hover.price;
      priceText = `O ${fmtGold(p.open)}  H ${fmtGold(p.high)}  L ${fmtGold(p.low)}  C ${fmtGold(p.close)}`;
    } else if ('value' in hover.price) {
      priceText = fmtGold(hover.price.value);
    }
  }
  return (
    <Box
      style={{
        position: 'absolute',
        top: 10,
        left: 12,
        padding: '6px 10px',
        background: 'rgba(12,13,16,0.85)',
        backdropFilter: 'blur(8px)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-3)',
        fontFamily: 'var(--font-family-mono)',
        fontSize: 'var(--font-2)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
      }}
    >
      <div style={{ opacity: 0.55, marginBottom: 2 }}>{date}</div>
      <div>{priceText}</div>
      {hover.volume != null ? (
        <div style={{ opacity: 0.55, marginTop: 2 }}>vol {hover.volume.toLocaleString()}</div>
      ) : null}
    </Box>
  );
}
