import { VirtuosoGrid } from 'react-virtuoso';
import { Icon, Stack, Text } from '../../design-system/index.js';
import type { ItemRow } from '../../lib/api.js';
import { formatGoldShort } from '../../lib/currency.js';
import { qualityColor } from '../../lib/wow.js';
import type { EdgeMap } from './edgeMap.js';
import './item-grid.css';

type Props = {
  items: ItemRow[];
  edges?: EdgeMap;
  onSelect: (item: ItemRow) => void;
  onEndReached?: () => void;
  loading?: boolean;
  fetchingMore?: boolean;
  hasMore?: boolean;
  total?: number;
};

export function ItemGrid({
  items,
  edges,
  onSelect,
  onEndReached,
  loading,
  fetchingMore,
  hasMore,
  total,
}: Props) {
  return (
    <Stack gap={3} style={{ height: '100%', minHeight: 0 }}>
      <Stack direction="row" justify="between" align="baseline">
        <Text size={2} muted>
          {loading
            ? 'loading…'
            : total != null
              ? `${items.length.toLocaleString()} of ${total.toLocaleString()}`
              : `${items.length.toLocaleString()} items`}
        </Text>
        {fetchingMore ? (
          <Text size={1} muted>
            loading more…
          </Text>
        ) : !hasMore && items.length > 0 ? (
          <Text size={1} muted>
            (end)
          </Text>
        ) : null}
      </Stack>
      <div style={{ flex: 1, minHeight: 0 }}>
        <VirtuosoGrid
          style={{ height: '100%' }}
          data={items}
          listClassName="goldbook-item-grid"
          itemClassName="goldbook-item-grid-cell"
          endReached={() => {
            console.log('[goldbook] virtuoso endReached, items=', items.length);
            onEndReached?.();
          }}
          rangeChanged={({ endIndex }) => {
            // Prefetch when within ~30 items of the rendered end. This is the only
            // signal that fires reliably as data grows; endReached alone won't
            // re-fire after the very first end-of-list hit.
            if (endIndex >= items.length - 30) {
              console.log(
                '[goldbook] virtuoso rangeChanged near end: endIndex=',
                endIndex,
                'items=',
                items.length,
              );
              onEndReached?.();
            }
          }}
          itemContent={(_, item) => (
            <Tile item={item} edge={edges?.get(item.id)} onClick={() => onSelect(item)} />
          )}
        />
      </div>
    </Stack>
  );
}

type Edge = { edgePct: number; medianCopper: number };

function edgeBadge(edge: Edge | undefined): { label: string; color: string } | null {
  if (!edge) return null;
  const e = edge.edgePct;
  if (e >= 100) return { label: `+${e.toFixed(0)}%`, color: 'var(--color-up)' };
  if (e >= 25) return { label: `+${e.toFixed(0)}%`, color: 'var(--color-up)' };
  if (e <= -10) return { label: `${e.toFixed(0)}%`, color: 'var(--color-down)' };
  return null;
}

function Tile({
  item,
  edge,
  onClick,
}: {
  item: ItemRow;
  edge?: Edge;
  onClick: () => void;
}) {
  const nameColor = qualityColor(item.quality);
  const badge = edgeBadge(edge);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor =
          'color-mix(in srgb, var(--color-border) 50%, var(--color-text) 20%)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
        width: '100%',
        background:
          'linear-gradient(135deg, var(--color-surface) 0%, color-mix(in srgb, var(--color-surface) 80%, var(--color-bg)) 100%)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-3)',
        boxSizing: 'border-box',
        minWidth: 0,
        transition: 'border-color 120ms ease, transform 120ms ease',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <Icon icon={item.icon} quality={item.quality} size={44} alt={item.name} />
      <Stack gap={1} flex={1} style={{ minWidth: 0 }}>
        <Text size={3} truncate style={{ color: nameColor, fontWeight: 500 }}>
          {item.name}
          {item.randomSuffix ? (
            <Text as="span" size={2} muted>
              {' '}
              {item.randomSuffix}
            </Text>
          ) : null}
        </Text>
        <Stack direction="row" justify="between" align="baseline" gap={2}>
          <Text size={1} muted>
            {item.category ?? '—'}
          </Text>
          <Stack direction="row" gap={2} align="baseline">
            {badge ? (
              <span
                title={
                  edge
                    ? `vs clearing median ${formatGoldShort(edge.medianCopper)}`
                    : undefined
                }
                style={{
                  fontSize: 'var(--font-1)',
                  fontFamily: 'var(--font-family-mono)',
                  fontWeight: 600,
                  color: badge.color,
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-1)',
                  border: `1px solid ${badge.color}`,
                  opacity: 0.85,
                }}
              >
                {badge.label}
              </span>
            ) : null}
            <Text size={2} mono>
              {formatGoldShort(item.latestPrice)}
            </Text>
          </Stack>
        </Stack>
      </Stack>
    </button>
  );
}
