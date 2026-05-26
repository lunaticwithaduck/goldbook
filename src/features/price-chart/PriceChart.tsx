import { useQuery } from '@tanstack/react-query';
import {
  type CandlestickData,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
  createChart,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { Box, Button, Stack, Text } from '../../design-system/index.js';
import { color } from '../../design-system/tokens.js';
import { api } from '../../lib/api.js';
import { formatGoldShort } from '../../lib/currency.js';

type Bucket = 'hour' | 'day';
type Mode = 'candles' | 'line';

type Props = {
  itemId: number;
  itemName: string;
};

const copperToGold = (c: number) => c / 10000;

export function PriceChart({ itemId, itemName }: Props) {
  const [bucket, setBucket] = useState<Bucket>('day');
  const [mode, setMode] = useState<Mode>('line');

  const { data: candleData, isLoading } = useQuery({
    queryKey: ['candles', itemId, bucket],
    queryFn: () => api.candles(itemId, bucket),
  });

  const { data: scanData } = useQuery({
    queryKey: ['scans', itemId],
    queryFn: () => api.scans(itemId),
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
            {candleData?.candles.length ?? 0} {bucket === 'hour' ? 'hourly' : 'daily'} buckets ·
            prices in gold
          </Text>
        </Stack>
        <Stack direction="row" gap={2}>
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
            options={[
              { v: 'hour', label: '1H' },
              { v: 'day', label: '1D' },
            ]}
          />
        </Stack>
      </Stack>
      <Box flex={1} style={{ position: 'relative', minHeight: 0 }}>
        {isLoading ? (
          <Box style={{ padding: 'var(--space-4)' }}>
            <Text muted>loading chart…</Text>
          </Box>
        ) : null}
        <ChartCanvas
          mode={mode}
          candles={candleData?.candles ?? []}
          scans={scanData?.scans ?? []}
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

function ChartCanvas({
  mode,
  candles,
  scans,
}: {
  mode: Mode;
  candles: { bucket: number; open: number; high: number; low: number; close: number; volume: number }[];
  scans: { observedAt: number; pricePerUnit: number; stackSize: number }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null>(null);

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
      rightPriceScale: { borderColor: color.border },
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
    };
  }, []);

  // Update price series when mode/data changes
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
      const series = chart.addLineSeries({
        color: color.up,
        lineWidth: 2,
      });
      const data: LineData[] = scans
        .map((s) => ({
          time: s.observedAt as Time,
          value: copperToGold(s.pricePerUnit),
        }))
        .sort((a, b) => (a.time as number) - (b.time as number));
      series.setData(data);
      priceSeriesRef.current = series;
    }

    chart.timeScale().fitContent();
  }, [mode, candles, scans]);

  // Custom legend hover
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
      if (first.close != null) {
        setHover(
          `O ${first.open?.toFixed(2)}  H ${first.high?.toFixed(2)}  L ${first.low?.toFixed(2)}  C ${first.close?.toFixed(2)}`,
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
