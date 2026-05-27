export type ItemRow = {
  id: number;
  name: string;
  randomSuffix: string | null;
  icon: string | null;
  quality: number | null;
  category: string | null;
  latestPrice: number | null;
};

export type ItemsPage = {
  items: ItemRow[];
  total: number;
  limit: number;
  offset: number;
};

export type ItemDetail = {
  id: number;
  name: string;
  realm: string;
  randomSuffix: string | null;
  icon: string | null;
  quality: number | null;
  category: string | null;
  classId: number | null;
  subclassId: number | null;
};

export type ScanRow = {
  observedAt: number; // unix seconds
  pricePerUnit: number;
  stackSize: number;
  source: 'db' | 'history';
};

export type Category = { category: string; n: number };

export type CandleRow = {
  bucket: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Stats = {
  itemCount: number;
  scanCount: number;
  metaCount: number;
  lastIngest: {
    id: number;
    ingestedAt: number;
    scanTime: number;
    dbInserted: number;
    historyInserted: number;
    realm: string | null;
  } | null;
};

export type ItemsQuery = {
  q?: string;
  category?: string;
  qualityMin?: number;
  limit?: number;
  offset?: number;
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

function buildQs(q: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const api = {
  stats: () => get<Stats>('/api/stats'),
  taxonomy: () => get<{ categories: Category[] }>('/api/taxonomy'),
  items: (q: ItemsQuery = {}) => get<ItemsPage>(`/api/items${buildQs(q)}`),
  scans: (id: number, sources?: string) =>
    get<{ item: ItemDetail; scans: ScanRow[] }>(
      `/api/items/${id}/scans${buildQs({ sources })}`,
    ),
  candles: (id: number, bucket: Bucket, sources?: string) =>
    get<{ candles: CandleRow[] }>(
      `/api/items/${id}/candles${buildQs({ bucket, sources })}`,
    ),
  flips: (q: FlipsQuery = {}) => get<FlipsResult>(`/api/flips${buildQs(q)}`),
  edges: (realm?: string) => get<EdgesResult>(`/api/items/edges${buildQs({ realm })}`),
};

export type ItemEdge = {
  itemId: number;
  floorCopper: number;
  medianCopper: number;
  avgQtyPerDay: number;
  edgePct: number;
};

export type EdgesResult = {
  realm: string;
  edges: ItemEdge[];
};

export type Bucket = 'hour' | 'day' | 'week' | 'month';

export type FlipsQuery = {
  realm?: string;
  bankroll?: number;
  positions?: number;
  minEdge?: number;
  minVolume?: number;
  maxFloor?: number;
  minFloor?: number;
  includeProjectiles?: 0 | 1;
};

export type FlipCandidate = {
  itemId: number;
  name: string;
  category: string | null;
  classId: number | null;
  icon: string | null;
  quality: number | null;
  floorCopper: number;
  medianCopper: number;
  avgQtyPerDay: number;
  stackSize: number;
};

export type FlipPick = FlipCandidate & {
  edgePct: number;
  suggestedUnits: number;
  costCopper: number;
  estProfitCopper: number;
};

export type FlipsResult = {
  realm: string;
  picks: FlipPick[];
  traps: FlipCandidate[];
  totalCostCopper: number;
  totalProfitCopper: number;
};
