import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, type ReactNode, useState } from 'react';
import { Box, Button, Icon, Input, Stack, Text } from '../../design-system/index.js';
import { api, type FlipPick, type FlipsQuery, type ItemRow } from '../../lib/api.js';
import { formatGoldShort } from '../../lib/currency.js';
import { qualityColor } from '../../lib/wow.js';

type Props = {
  onSelectItem: (item: ItemRow) => void;
};

type ControlState = {
  bankroll: number;
  positions: number;
  minEdge: number;
  minVolume: number;
  maxFloor: number;
};

const DEFAULTS: ControlState = {
  bankroll: 20000,
  positions: 6,
  minEdge: 25,
  minVolume: 500,
  maxFloor: 300,
};

export function Flips({ onSelectItem }: Props) {
  const [draft, setDraft] = useState<ControlState>(DEFAULTS);
  const [applied, setApplied] = useState<ControlState>(DEFAULTS);

  const query: FlipsQuery = { ...applied };

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['flips', query],
    queryFn: () => api.flips(query),
    staleTime: 4 * 60_000,
  });

  const apply = () => setApplied(draft);
  const reset = () => {
    setDraft(DEFAULTS);
    setApplied(DEFAULTS);
  };
  const toItemRow = (p: { itemId: number; name: string; icon: string | null; quality: number | null; category: string | null; floorCopper: number }): ItemRow => ({
    id: p.itemId,
    name: p.name,
    randomSuffix: null,
    icon: p.icon,
    quality: p.quality,
    category: p.category,
    latestPrice: p.floorCopper,
  });

  return (
    <Box
      p={6}
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        overflow: 'auto',
      }}
    >
      <Box bg="surface" border="border" radius={3} p={5}>
        <Stack direction="row" gap={4} align="end" wrap>
          <NumField
            label="bankroll (g)"
            value={draft.bankroll}
            min={50}
            step={500}
            onChange={(v) => setDraft({ ...draft, bankroll: v })}
            width={120}
          />
          <NumField
            label="positions"
            value={draft.positions}
            min={1}
            max={30}
            step={1}
            onChange={(v) => setDraft({ ...draft, positions: v })}
            width={80}
          />
          <NumField
            label="min edge (%)"
            value={draft.minEdge}
            min={0}
            step={5}
            onChange={(v) => setDraft({ ...draft, minEdge: v })}
            width={100}
          />
          <NumField
            label="min vol/day"
            value={draft.minVolume}
            min={0}
            step={100}
            onChange={(v) => setDraft({ ...draft, minVolume: v })}
            width={100}
          />
          <NumField
            label="max floor (g)"
            value={draft.maxFloor}
            min={1}
            step={50}
            onChange={(v) => setDraft({ ...draft, maxFloor: v })}
            width={110}
          />
          <Stack direction="row" gap={2}>
            <Button variant="solid" size="md" onClick={apply}>
              Apply
            </Button>
            <Button variant="soft" size="md" onClick={reset}>
              Reset
            </Button>
          </Stack>
        </Stack>
      </Box>

      {error ? (
        <Box bg="surface" border="border" radius={3} p={5}>
          <Text size={3} style={{ color: 'var(--color-down)' }}>
            failed to load: {(error as Error).message}
          </Text>
        </Box>
      ) : null}

      {data ? <Summary data={data} fetching={isFetching} /> : null}

      <Box bg="surface" border="border" radius={3} style={{ overflow: 'hidden' }}>
        <PicksHeader />
        {isLoading ? (
          <Box p={5}>
            <Text muted>computing flips…</Text>
          </Box>
        ) : data && data.picks.length > 0 ? (
          data.picks.map((p, i) => (
            <PickRow
              key={p.itemId}
              pick={p}
              index={i}
              onClick={() => onSelectItem(toItemRow(p))}
            />
          ))
        ) : data ? (
          <Box p={5}>
            <Text muted>
              no picks at these filters. try lowering min edge or raising max floor.
            </Text>
          </Box>
        ) : null}
      </Box>

      {data && data.traps.length > 0 ? (
        <Box bg="surface" border="border" radius={3} p={5}>
          <Stack gap={3}>
            <Text size={3} weight="medium">
              traps — current floor sits above clearing median, do not flip
            </Text>
            <Stack gap={2}>
              {data.traps.slice(0, 8).map((t) => {
                const drift = ((t.floorCopper - t.medianCopper) / t.medianCopper) * 100;
                return (
                  <ClickableRow key={t.itemId} onClick={() => onSelectItem(toItemRow(t))}>
                    <Icon icon={t.icon} quality={t.quality} size={24} alt={t.name} />
                    <Text
                      size={2}
                      style={{ color: qualityColor(t.quality), flex: 1, minWidth: 0 }}
                      truncate
                    >
                      {t.name}
                    </Text>
                    <Text size={2} mono muted>
                      floor {formatGoldShort(t.floorCopper)} · med{' '}
                      {formatGoldShort(t.medianCopper)}
                    </Text>
                    <Text
                      size={2}
                      mono
                      style={{ color: 'var(--color-down)', minWidth: 56, textAlign: 'right' }}
                    >
                      +{drift.toFixed(0)}%
                    </Text>
                  </ClickableRow>
                );
              })}
            </Stack>
          </Stack>
        </Box>
      ) : null}
    </Box>
  );
}

function ClickableRow({
  children,
  onClick,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  return (
    <div
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.background =
          'color-mix(in srgb, var(--color-surface) 80%, var(--color-text) 4%)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-2) var(--space-3)',
        borderRadius: 'var(--radius-2)',
        transition: 'background 80ms ease',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Summary({
  data,
  fetching,
}: {
  data: { realm: string; picks: FlipPick[]; totalCostCopper: number; totalProfitCopper: number };
  fetching: boolean;
}) {
  const roi =
    data.totalCostCopper > 0 ? (data.totalProfitCopper / data.totalCostCopper) * 100 : 0;
  return (
    <Box bg="surface" border="border" radius={3} p={5}>
      <Stack direction="row" gap={6} align="center" wrap>
        <SummaryStat label="realm" value={data.realm} />
        <SummaryStat label="picks" value={`${data.picks.length}`} />
        <SummaryStat label="total cost" value={formatGoldShort(data.totalCostCopper)} />
        <SummaryStat
          label="est. profit"
          value={formatGoldShort(data.totalProfitCopper)}
          color="up"
        />
        <SummaryStat label="ROI" value={`${roi.toFixed(0)}%`} color="up" />
        {fetching ? (
          <Text size={1} muted>
            recomputing…
          </Text>
        ) : null}
      </Stack>
    </Box>
  );
}

function SummaryStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: 'up' | 'down';
}) {
  return (
    <Stack gap={1}>
      <Text size={1} muted>
        {label}
      </Text>
      <Text
        size={4}
        mono
        weight="medium"
        style={color ? { color: `var(--color-${color})` } : undefined}
      >
        {value}
      </Text>
    </Stack>
  );
}

function PicksHeader() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--color-border)',
        background: 'color-mix(in srgb, var(--color-surface) 88%, var(--color-bg) 12%)',
      }}
    >
      <Text size={1} muted style={{ width: 24 }}>
        #
      </Text>
      <div style={{ width: 28 }} />
      <Text size={1} muted style={{ flex: 1, minWidth: 0 }}>
        item
      </Text>
      <HeaderCell label="buy @" w={70} />
      <HeaderCell label="sell @" w={70} />
      <HeaderCell label="edge" w={60} />
      <HeaderCell label="qty/day" w={70} />
      <HeaderCell label="units" w={70} />
      <HeaderCell label="cost" w={80} />
      <HeaderCell label="profit" w={90} />
    </div>
  );
}

function HeaderCell({ label, w }: { label: string; w: number }) {
  return (
    <Text size={1} muted mono style={{ width: w, textAlign: 'right' }}>
      {label}
    </Text>
  );
}

function PickRow({
  pick,
  index,
  onClick,
}: {
  pick: FlipPick;
  index: number;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.background =
          'color-mix(in srgb, var(--color-surface) 80%, var(--color-text) 4%)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--color-border)',
        cursor: 'pointer',
        transition: 'background 80ms ease',
      }}
    >
      <Text size={2} mono muted style={{ width: 24 }}>
        {index + 1}
      </Text>
      <Icon icon={pick.icon} quality={pick.quality} size={28} alt={pick.name} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Text
          size={3}
          truncate
          style={{ color: qualityColor(pick.quality), fontWeight: 500 }}
        >
          {pick.name}
        </Text>
        <Text size={1} muted>
          {pick.category ?? '—'}
        </Text>
      </div>
      <Cell w={70}>{formatGoldShort(pick.floorCopper)}</Cell>
      <Cell w={70}>{formatGoldShort(pick.medianCopper)}</Cell>
      <Cell w={60} color="up">
        +{pick.edgePct.toFixed(0)}%
      </Cell>
      <Cell w={70} muted>
        {pick.avgQtyPerDay.toFixed(0)}
      </Cell>
      <Cell w={70}>{pick.suggestedUnits.toLocaleString()}</Cell>
      <Cell w={80} muted>
        {formatGoldShort(pick.costCopper)}
      </Cell>
      <Cell w={90} color="up">
        {formatGoldShort(pick.estProfitCopper)}
      </Cell>
    </div>
  );
}

function Cell({
  children,
  w,
  color,
  muted,
}: {
  children: ReactNode;
  w: number;
  color?: 'up' | 'down';
  muted?: boolean;
}) {
  const style: CSSProperties = { width: w, textAlign: 'right' };
  if (color) style.color = `var(--color-${color})`;
  return (
    <Text size={2} mono muted={muted} style={style}>
      {children}
    </Text>
  );
}

function NumField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  width,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  width: number;
}) {
  return (
    <Stack gap={1}>
      <Text size={1} muted>
        {label}
      </Text>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        style={{ width }}
      />
    </Stack>
  );
}
