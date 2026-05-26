export type ItemRow = {
  id: number;
  name: string;
  realm: string;
  randomSuffix: string | null;
  metaId: number | null;
  icon: string | null;
  quality: number | null;
  category: string | null;
  classId: number | null;
  subclassId: number | null;
  scanCount: number;
  latestPrice: number | null;
  latestObservedAt: number | null; // unix seconds
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
  items: (q: ItemsQuery = {}) =>
    get<{ items: ItemRow[]; total: number }>(`/api/items${buildQs(q)}`),
  scans: (id: number) => get<{ item: ItemDetail; scans: ScanRow[] }>(`/api/items/${id}/scans`),
  candles: (id: number, bucket: 'hour' | 'day') =>
    get<{ candles: CandleRow[] }>(`/api/items/${id}/candles?bucket=${bucket}`),
};
