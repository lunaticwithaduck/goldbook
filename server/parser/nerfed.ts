/**
 * Fetcher + parser for ah.nerfed.net (community-run Warmane AH price tracker).
 *
 * Each per-item page embeds the full price history as a JS variable in the page HTML:
 *
 *   var all_data = {
 *     "quantity":      { "data": [[unixTsSec, count], ...] },
 *     "bid_mean":      { "data": [[unixTsSec, goldFloat], ...] },
 *     "bid_median":    { "data": [[unixTsSec, goldFloat], ...] },
 *     "cost_price":    { "data": null | [...] },
 *     "buyout_median": { "data": [[unixTsSec, goldFloat], ...] },
 *     "buyout_min":    { "data": [[unixTsSec, goldFloat], ...] },
 *   };
 *
 * We yank that out with a simple regex (it's a one-liner in the HTML) and treat each
 * series as time-series of (observedAt, value). Prices are in decimal gold; convert
 * to integer copper via ×10000.
 */

const BASE_URL = 'https://ah.nerfed.net/item/index';
const ALL_DATA_RE = /var all_data\s*=\s*(\{[^;]+?\});/;

export const NERFED_PRICE_SERIES = [
  'buyout_min',
  'buyout_median',
  'bid_mean',
  'bid_median',
] as const;
export type NerfedPriceSeries = (typeof NERFED_PRICE_SERIES)[number];

export type NerfedPoint = { ts: number; valueCopper: number };
export type NerfedQuantityPoint = { ts: number; count: number };

export type NerfedParsed = {
  buyout_min: NerfedPoint[];
  buyout_median: NerfedPoint[];
  bid_mean: NerfedPoint[];
  bid_median: NerfedPoint[];
  quantity: NerfedQuantityPoint[];
};

export type FetchResult =
  | { kind: 'ok'; parsed: NerfedParsed }
  | { kind: 'no_data' } // 404 or page has no all_data
  | { kind: 'retry'; status: number; retryAfterSec: number | null }
  | { kind: 'fatal'; message: string };

const USER_AGENT =
  'goldbook-backfill/0.1 (https://github.com/lunaticwithaduck/goldbook; personal use)';

function gold(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  // Round to nearest copper. Avoid Math.round flakiness near 0.5 by adding a tiny offset.
  return Math.round(value * 10000);
}

function parseSeries(arr: unknown): NerfedPoint[] {
  if (!Array.isArray(arr)) return [];
  const out: NerfedPoint[] = [];
  for (const row of arr) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const ts = typeof row[0] === 'number' ? Math.floor(row[0]) : null;
    const v = gold(row[1]);
    if (ts == null || v == null) continue;
    out.push({ ts, valueCopper: v });
  }
  return out;
}

function parseQuantity(arr: unknown): NerfedQuantityPoint[] {
  if (!Array.isArray(arr)) return [];
  const out: NerfedQuantityPoint[] = [];
  for (const row of arr) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const ts = typeof row[0] === 'number' ? Math.floor(row[0]) : null;
    const c = typeof row[1] === 'number' ? Math.floor(row[1]) : null;
    if (ts == null || c == null) continue;
    out.push({ ts, count: c });
  }
  return out;
}

export function parseAllData(html: string): NerfedParsed | null {
  const m = ALL_DATA_RE.exec(html);
  if (!m) return null;
  let raw: Record<string, { data?: unknown }>;
  try {
    raw = JSON.parse(m[1]);
  } catch {
    return null;
  }
  return {
    buyout_min: parseSeries(raw.buyout_min?.data),
    buyout_median: parseSeries(raw.buyout_median?.data),
    bid_mean: parseSeries(raw.bid_mean?.data),
    bid_median: parseSeries(raw.bid_median?.data),
    quantity: parseQuantity(raw.quantity?.data),
  };
}

export function buildUrl(itemId: number, realmId = 15, faction = 1): string {
  return `${BASE_URL}?id=${itemId}&realm=${realmId}&faction=${faction}`;
}

/** Fetch + parse one item. Distinguishes recoverable (retry) from fatal failures. */
export async function fetchItem(
  itemId: number,
  opts: { realmId?: number; faction?: number; timeoutMs?: number } = {},
): Promise<FetchResult> {
  const url = buildUrl(itemId, opts.realmId ?? 15, opts.faction ?? 1);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
    });
  } catch (err) {
    return { kind: 'retry', status: 0, retryAfterSec: null };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) return { kind: 'no_data' };
  if (res.status === 429 || res.status >= 500) {
    const ra = Number(res.headers.get('retry-after'));
    return {
      kind: 'retry',
      status: res.status,
      retryAfterSec: Number.isFinite(ra) ? ra : null,
    };
  }
  if (!res.ok) return { kind: 'fatal', message: `HTTP ${res.status}` };

  const html = await res.text();
  const parsed = parseAllData(html);
  if (!parsed) return { kind: 'no_data' };

  // If every series is empty, treat as no-data (the page rendered but with no history).
  const total =
    parsed.buyout_min.length +
    parsed.buyout_median.length +
    parsed.bid_mean.length +
    parsed.bid_median.length +
    parsed.quantity.length;
  if (total === 0) return { kind: 'no_data' };

  return { kind: 'ok', parsed };
}
