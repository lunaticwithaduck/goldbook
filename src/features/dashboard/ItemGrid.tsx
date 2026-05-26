import * as ScrollArea from '@radix-ui/react-scroll-area';
import { Icon, Stack, Text } from '../../design-system/index.js';
import type { ItemRow } from '../../lib/api.js';
import { formatGoldShort } from '../../lib/currency.js';
import { qualityColor } from '../../lib/wow.js';

type Props = {
  items: ItemRow[];
  onSelect: (item: ItemRow) => void;
  loading?: boolean;
  total?: number;
};

export function ItemGrid({ items, onSelect, loading, total }: Props) {
  return (
    <Stack gap={3} style={{ height: '100%' }}>
      <Stack direction="row" justify="between" align="baseline">
        <Text size={2} muted>
          {loading
            ? 'loading…'
            : total != null && total > items.length
              ? `showing ${items.length} of ${total.toLocaleString()}`
              : `${items.length.toLocaleString()} items`}
        </Text>
      </Stack>
      <ScrollArea.Root style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <ScrollArea.Viewport style={{ width: '100%', height: '100%' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 'var(--space-2)',
              padding: '0 var(--space-2) var(--space-4)',
            }}
          >
            {items.map((it) => (
              <Tile key={it.id} item={it} onClick={() => onSelect(it)} />
            ))}
          </div>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar
          orientation="vertical"
          style={{ width: 6, background: 'transparent', padding: 1 }}
        >
          <ScrollArea.Thumb
            style={{ background: 'var(--color-border)', borderRadius: 3, flex: 1 }}
          />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
    </Stack>
  );
}

function Tile({ item, onClick }: { item: ItemRow; onClick: () => void }) {
  const nameColor = qualityColor(item.quality);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-2)',
        minWidth: 0,
      }}
    >
      <Icon icon={item.icon} quality={item.quality} size={40} alt={item.name} />
      <Stack gap={1} flex={1} style={{ minWidth: 0 }}>
        <Text size={3} truncate style={{ color: nameColor }}>
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
            {item.category ?? '—'} · {item.scanCount} scan{item.scanCount === 1 ? '' : 's'}
          </Text>
          <Text size={2} mono>
            {formatGoldShort(item.latestPrice)}
          </Text>
        </Stack>
      </Stack>
    </button>
  );
}
