import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Box, Input, Stack, Text } from '../../design-system/index.js';
import { api, type ItemRow } from '../../lib/api.js';
import { CategorySidebar } from './CategorySidebar.js';
import { ItemGrid } from './ItemGrid.js';

type Props = {
  onSelectItem: (item: ItemRow) => void;
};

const PAGE_LIMIT = 500;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Dashboard({ onSelectItem }: Props) {
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 200);

  const { data, isLoading } = useQuery({
    queryKey: ['items', category, debouncedSearch],
    queryFn: () =>
      api.items({
        category: category ?? undefined,
        q: debouncedSearch || undefined,
        limit: PAGE_LIMIT,
      }),
  });

  return (
    <Box
      style={{
        display: 'grid',
        gridTemplateColumns: '240px 1fr',
        flex: 1,
        minHeight: 0,
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
      }}
    >
      <Box
        bg="surface"
        border="border"
        radius={3}
        style={{ overflow: 'auto', minHeight: 0 }}
      >
        <CategorySidebar selected={category} onSelect={setCategory} />
      </Box>
      <Stack gap={3} style={{ minHeight: 0 }}>
        <Stack direction="row" gap={3} align="center">
          <Box style={{ flex: 1 }}>
            <Input
              placeholder="Search items…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Box>
          {category ? (
            <Text size={2} muted>
              filter: <strong style={{ color: 'var(--color-text)' }}>{category}</strong>
            </Text>
          ) : null}
        </Stack>
        <Box
          bg="surface"
          border="border"
          radius={3}
          p={3}
          flex={1}
          style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          <ItemGrid
            items={data?.items ?? []}
            total={data?.total}
            onSelect={onSelectItem}
            loading={isLoading}
          />
        </Box>
      </Stack>
    </Box>
  );
}
