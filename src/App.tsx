import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Box, Button, Icon, Separator, Stack, Text } from './design-system/index.js';
import { Dashboard } from './features/dashboard/Dashboard.js';
import { PriceChart } from './features/price-chart/PriceChart.js';
import { api, type ItemRow, type Stats } from './lib/api.js';
import { qualityColor } from './lib/wow.js';

export function App() {
  const [selected, setSelected] = useState<ItemRow | null>(null);
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: api.stats });

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TopBar stats={stats} selected={selected} onBack={() => setSelected(null)} />
      <Separator />
      {selected ? (
        <Box
          p={6}
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Box
            bg="surface"
            border="border"
            radius={4}
            p={6}
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <PriceChart itemId={selected.id} itemName={selected.name} />
          </Box>
        </Box>
      ) : (
        <Dashboard onSelectItem={setSelected} />
      )}
    </Box>
  );
}

function TopBar({
  stats,
  selected,
  onBack,
}: {
  stats: Stats | undefined;
  selected: ItemRow | null;
  onBack: () => void;
}) {
  const last = stats?.lastIngest;
  const insertedTotal = last ? last.dbInserted + last.historyInserted : 0;
  return (
    <Stack
      direction="row"
      align="center"
      justify="between"
      gap={4}
      style={{
        padding: 'var(--space-4) var(--space-6)',
        background: 'var(--color-surface)',
      }}
    >
      <Stack direction="row" gap={3} align="center">
        {selected ? (
          <>
            <Button size="sm" variant="soft" onClick={onBack}>
              <ArrowLeft size={14} />
              Back
            </Button>
            <Icon icon={selected.icon} quality={selected.quality} size={28} />
            <Text size={4} weight="medium" style={{ color: qualityColor(selected.quality) }}>
              {selected.name}
              {selected.randomSuffix ? (
                <Text as="span" muted>
                  {' '}
                  {selected.randomSuffix}
                </Text>
              ) : null}
            </Text>
          </>
        ) : (
          <>
            <Text size={5} weight="bold">
              goldbook
            </Text>
            <Text size={2} muted>
              Warmane WotLK AH price tracker
            </Text>
          </>
        )}
      </Stack>
      <Stack direction="row" gap={5} align="center">
        <Stat label="items" value={stats?.itemCount?.toLocaleString() ?? '—'} />
        <Stat label="scans" value={stats?.scanCount?.toLocaleString() ?? '—'} />
        <Stat label="meta" value={stats?.metaCount?.toLocaleString() ?? '—'} />
        <Stat
          label="last scan"
          value={
            last
              ? `${new Date(last.scanTime * 1000).toLocaleString()} (+${insertedTotal})`
              : 'never'
          }
        />
        <Stat label="realm" value={last?.realm ?? '—'} />
      </Stack>
    </Stack>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={1}>
      <Text size={1} muted>
        {label}
      </Text>
      <Text size={3} mono>
        {value}
      </Text>
    </Stack>
  );
}
