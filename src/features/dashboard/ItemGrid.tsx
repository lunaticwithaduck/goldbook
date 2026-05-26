import { forwardRef } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';
import { Icon, Stack, Text } from '../../design-system/index.js';
import type { ItemRow } from '../../lib/api.js';
import { formatGoldShort } from '../../lib/currency.js';
import { qualityColor } from '../../lib/wow.js';

type Props = {
  items: ItemRow[];
  onSelect: (item: ItemRow) => void;
  onEndReached?: () => void;
  loading?: boolean;
  fetchingMore?: boolean;
  hasMore?: boolean;
  total?: number;
};

export function ItemGrid({
  items,
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
        ) : null}
      </Stack>
      <div style={{ flex: 1, minHeight: 0 }}>
        <VirtuosoGrid
          style={{ height: '100%' }}
          data={items}
          endReached={() => onEndReached?.()}
          increaseViewportBy={400}
          components={{ List: GridList, Item: GridItem, Footer: () => <GridFooter hasMore={!!hasMore} fetchingMore={!!fetchingMore} /> }}
          itemContent={(_, item) => <Tile item={item} onClick={() => onSelect(item)} />}
        />
      </div>
    </Stack>
  );
}

const GridList = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function GridList(props, ref) {
    return (
      <div
        ref={ref}
        {...props}
        style={{
          ...props.style,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 'var(--space-2)',
          padding: '0 var(--space-2) var(--space-4)',
        }}
      />
    );
  },
);

function GridItem({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} style={{ ...rest.style, display: 'flex' }}>
      {children}
    </div>
  );
}

function GridFooter({ hasMore, fetchingMore }: { hasMore: boolean; fetchingMore: boolean }) {
  if (!hasMore && !fetchingMore) return null;
  return (
    <div
      style={{
        gridColumn: '1 / -1',
        padding: 'var(--space-3)',
        textAlign: 'center',
        color: 'var(--color-text)',
        opacity: 0.5,
        fontSize: 'var(--font-2)',
      }}
    >
      {fetchingMore ? 'loading more…' : ''}
    </div>
  );
}

function Tile({ item, onClick }: { item: ItemRow; onClick: () => void }) {
  const nameColor = qualityColor(item.quality);
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
          <Text size={2} mono>
            {formatGoldShort(item.latestPrice)}
          </Text>
        </Stack>
      </Stack>
    </button>
  );
}
