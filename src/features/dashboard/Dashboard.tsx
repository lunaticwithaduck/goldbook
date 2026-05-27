import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Input, Stack, Text } from '../../design-system/index.js';
import { api, type ItemRow } from '../../lib/api.js';
import { CategorySidebar } from './CategorySidebar.js';
import { ItemGrid } from './ItemGrid.js';
import { buildEdgeMap } from './edgeMap.js';

type Props = {
  onSelectItem: (item: ItemRow) => void;
};

const PAGE_SIZE = 60;

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

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: ['items', category, debouncedSearch],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.items({
        category: category ?? undefined,
        q: debouncedSearch || undefined,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    getNextPageParam: (last) => {
      const nextOffset = last.offset + last.items.length;
      return nextOffset < last.total ? nextOffset : undefined;
    },
  });

  const items = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.items),
    [data],
  );
  const total = data?.pages[0]?.total ?? 0;

  // Background-fetch per-item edge data so tiles can flag flips at a glance.
  // 5 min staleTime matches the server cache TTL — refetching sooner is pointless.
  const { data: edgesData } = useQuery({
    queryKey: ['itemEdges'],
    queryFn: () => api.edges(),
    staleTime: 5 * 60_000,
  });
  const edgeMap = useMemo(() => buildEdgeMap(edgesData?.edges), [edgesData]);

  useEffect(() => {
    console.log('[goldbook] items count changed:', items.length, 'of', total);
  }, [items.length, total]);

  // Ref-stabilize the load-more callback so virtuoso always invokes the latest
  // logic with fresh hasNextPage/isFetchingNextPage, even if it cached the prop
  // on first render.
  const loadMoreRef = useRef<() => void>(() => {});
  loadMoreRef.current = () => {
    console.log(
      '[goldbook] onEndReached invoked: hasNextPage=',
      hasNextPage,
      'isFetchingNextPage=',
      isFetchingNextPage,
      'pages=',
      data?.pages.length,
    );
    if (hasNextPage && !isFetchingNextPage) {
      console.log('[goldbook] -> calling fetchNextPage');
      fetchNextPage();
    }
  };

  return (
    <Box
      style={{
        display: 'grid',
        gridTemplateColumns: '260px 1fr',
        flex: 1,
        minHeight: 0,
        gap: 'var(--space-4)',
        padding: 'var(--space-6)',
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
            items={items}
            total={total}
            edges={edgeMap}
            onSelect={onSelectItem}
            loading={isLoading}
            fetchingMore={isFetchingNextPage}
            hasMore={!!hasNextPage}
            onEndReached={() => loadMoreRef.current()}
          />
        </Box>
      </Stack>
    </Box>
  );
}
