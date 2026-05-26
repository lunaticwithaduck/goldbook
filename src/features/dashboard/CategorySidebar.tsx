import { useQuery } from '@tanstack/react-query';
import { Stack, Text } from '../../design-system/index.js';
import { api } from '../../lib/api.js';

type Props = {
  selected: string | null;
  onSelect: (category: string | null) => void;
};

export function CategorySidebar({ selected, onSelect }: Props) {
  const { data } = useQuery({ queryKey: ['taxonomy'], queryFn: api.taxonomy });
  const categories = data?.categories ?? [];
  const total = categories.reduce((acc, c) => acc + c.n, 0);

  return (
    <Stack gap={1} style={{ padding: 'var(--space-3)' }}>
      <Text size={1} muted weight="medium">
        Categories
      </Text>
      <SidebarRow label="All items" count={total} selected={selected === null} onClick={() => onSelect(null)} />
      {categories.map((c) => (
        <SidebarRow
          key={c.category}
          label={c.category}
          count={c.n}
          selected={selected === c.category}
          onClick={() => onSelect(c.category)}
        />
      ))}
    </Stack>
  );
}

function SidebarRow({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'block',
        padding: 'var(--space-2) var(--space-3)',
        borderRadius: 'var(--radius-2)',
        background: selected ? 'var(--color-border)' : 'transparent',
      }}
    >
      <Stack direction="row" justify="between" align="center" gap={2}>
        <Text size={3} weight={selected ? 'medium' : 'regular'} truncate>
          {label}
        </Text>
        <Text size={2} mono muted>
          {count.toLocaleString()}
        </Text>
      </Stack>
    </button>
  );
}
