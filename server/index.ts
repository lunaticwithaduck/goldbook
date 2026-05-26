import { serve } from '@hono/node-server';
import { and, asc, desc, eq, inArray, like, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { findFlips, GOLD, pickRealm } from './analysis/flipFinder.js';
import { openDb } from './db/client.js';
import { ingests, itemMeta, items, scans } from './db/schema.js';

const { db, sqlite } = openDb();
const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true }));

// 30s in-memory cache so /api/stats doesn't run count(*) FROM scans on every
// dashboard load. The scans table has 30M+ rows; even at SQLite's ~250ms it's
// the slowest call on the dashboard. Stats are only really used for the topbar
// counter, so staleness up to 30s is fine.
let statsCache: { at: number; payload: unknown } | null = null;
const STATS_TTL_MS = 30_000;

app.get('/api/stats', (c) => {
  if (statsCache && Date.now() - statsCache.at < STATS_TTL_MS) {
    return c.json(statsCache.payload);
  }
  const itemCount = db.select({ n: sql<number>`count(*)` }).from(items).get()?.n ?? 0;
  // sqlite_stat1 is populated by ANALYZE and gives us the row count without scanning
  // the table. Falls back to count(*) if stats are missing (fresh DB).
  const scanCount =
    (db
      .all<{ stat: string | null }>(sql`SELECT stat FROM sqlite_stat1 WHERE tbl = 'scans' LIMIT 1`)
      .map((r) => Number((r.stat ?? '').split(/\s+/)[0]))
      .find((n) => Number.isFinite(n) && n > 0) as number | undefined) ??
    (db.select({ n: sql<number>`count(*)` }).from(scans).get()?.n ?? 0);
  const metaCount = db.select({ n: sql<number>`count(*)` }).from(itemMeta).get()?.n ?? 0;
  const lastIngest = db
    .select()
    .from(ingests)
    .orderBy(desc(ingests.ingestedAt))
    .limit(1)
    .get();
  const payload = { itemCount, scanCount, metaCount, lastIngest: lastIngest ?? null };
  statsCache = { at: Date.now(), payload };
  return c.json(payload);
});

/** /api/taxonomy → categories with counts (drives the sidebar) */
app.get('/api/taxonomy', (c) => {
  const rows = db.all<{ category: string; n: number }>(sql`
    select ${itemMeta.category} as category, count(distinct ${items.id}) as n
    from ${items}
    inner join ${itemMeta} on ${itemMeta.id} = ${items.metaId}
    group by ${itemMeta.category}
    order by n desc
  `);
  return c.json({ categories: rows });
});

/** /api/items → dashboard grid */
app.get('/api/items', (c) => {
  const q = c.req.query('q')?.trim();
  const category = c.req.query('category')?.trim();
  const qualityMin = c.req.query('qualityMin');
  const limit = Math.min(Number(c.req.query('limit') ?? 60), 500);
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);

  const filters: SQL[] = [];
  if (q) filters.push(like(items.name, `%${q}%`));
  if (category) filters.push(eq(itemMeta.category, category));
  if (qualityMin) filters.push(sql`${itemMeta.quality} >= ${Number(qualityMin)}`);

  const where = filters.length > 0 ? and(...filters) : undefined;

  // List view fetches only what the tile renders. Price is read straight from the
  // denormalized `items.latest_db_price` (maintained by the ingest CLI), so this
  // endpoint never touches the (>25M row) scans table.
  const rows = db
    .select({
      id: items.id,
      name: items.name,
      randomSuffix: items.randomSuffix,
      icon: itemMeta.icon,
      quality: itemMeta.quality,
      category: itemMeta.category,
      latestPrice: items.latestDbPrice,
    })
    .from(items)
    .leftJoin(itemMeta, eq(itemMeta.id, items.metaId))
    .where(where)
    .orderBy(asc(items.name))
    .limit(limit)
    .offset(offset)
    .all();

  const totalRow = db
    .select({ n: sql<number>`count(*)` })
    .from(items)
    .leftJoin(itemMeta, eq(itemMeta.id, items.metaId))
    .where(where)
    .get();

  return c.json({ items: rows, total: totalRow?.n ?? 0, limit, offset });
});

// Default "primary price" series for the chart: median buyout is the most stable
// market signal. Listing bots regularly drag `nerfed:buyout_min` to vendor price, so
// using min as the default makes cheap consumables look like they're selling for ~0.
// Other nerfed series are surfaced via ?sources=...
const PRIMARY_PRICE_SOURCES = ['db', 'history', 'nerfed:buyout_median'] as const;
const ALL_KNOWN_SOURCES = [
  'db',
  'history',
  'nerfed:buyout_min',
  'nerfed:buyout_median',
  'nerfed:bid_mean',
  'nerfed:bid_median',
  'nerfed:quantity',
];

function parseSourcesParam(raw: string | undefined): string[] {
  if (!raw) return [...PRIMARY_PRICE_SOURCES];
  if (raw === 'all') return ALL_KNOWN_SOURCES;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => ALL_KNOWN_SOURCES.includes(s));
}

app.get('/api/items/:id/scans', (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);
  const limit = Math.min(Number(c.req.query('limit') ?? 5000), 50000);
  const sources = parseSourcesParam(c.req.query('sources'));

  const item = db
    .select({
      id: items.id,
      name: items.name,
      realm: items.realm,
      randomSuffix: items.randomSuffix,
      icon: itemMeta.icon,
      quality: itemMeta.quality,
      category: itemMeta.category,
      classId: itemMeta.classId,
      subclassId: itemMeta.subclassId,
    })
    .from(items)
    .leftJoin(itemMeta, eq(itemMeta.id, items.metaId))
    .where(eq(items.id, id))
    .get();
  if (!item) return c.json({ error: 'not found' }, 404);

  const rows = db
    .select({
      observedAt: scans.observedAt,
      pricePerUnit: scans.pricePerUnit,
      stackSize: scans.stackSize,
      source: scans.source,
    })
    .from(scans)
    .where(and(eq(scans.itemId, id), inArray(scans.source, sources)))
    .orderBy(asc(scans.observedAt))
    .limit(limit)
    .all();

  return c.json({ item, scans: rows, sources });
});

const BUCKET_SECONDS: Record<string, number> = {
  hour: 3_600,
  day: 86_400,
  week: 604_800,
  month: 2_592_000, // 30-day chunks (not calendar months — consistent width matters more)
};

app.get('/api/items/:id/candles', (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);
  const bucket = c.req.query('bucket') ?? 'day';
  const seconds = BUCKET_SECONDS[bucket] ?? BUCKET_SECONDS.day;
  const sources = parseSourcesParam(c.req.query('sources'));

  const rows = db.all<{
    bucket: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>(sql`
    with ordered as (
      select
        ${scans.pricePerUnit} as price,
        ${scans.stackSize} as stack,
        cast(${scans.observedAt} / ${seconds} as integer) * ${seconds} as bucket,
        row_number() over (
          partition by cast(${scans.observedAt} / ${seconds} as integer)
          order by ${scans.observedAt} asc, ${scans.id} asc
        ) as rn_asc,
        row_number() over (
          partition by cast(${scans.observedAt} / ${seconds} as integer)
          order by ${scans.observedAt} desc, ${scans.id} desc
        ) as rn_desc
      from ${scans}
      where ${and(eq(scans.itemId, id), inArray(scans.source, sources))}
    )
    select
      bucket,
      max(case when rn_asc = 1 then price end) as open,
      max(price) as high,
      min(price) as low,
      max(case when rn_desc = 1 then price end) as close,
      sum(stack) as volume
    from ordered
    group by bucket
    order by bucket asc
  `);

  return c.json({ candles: rows, sources });
});

// Cached flip results — the 7-day-quantity grouped scan takes ~10s on the 30M-row
// scans table. Cache for a few minutes per distinct query so the dashboard feels
// instant after the first compute. Auctionator dumps come in once or twice a day
// so this is not stale-sensitive on a sub-minute scale.
const FLIPS_TTL_MS = 5 * 60_000;
const flipsCache = new Map<string, { at: number; payload: unknown }>();

function numParam(c: { req: { query: (k: string) => string | undefined } }, key: string): number | undefined {
  const v = c.req.query(key);
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

app.get('/api/flips', (c) => {
  let realm: string;
  try {
    realm = pickRealm(sqlite, c.req.query('realm'));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
  const opts = {
    realm,
    bankrollCopper: Math.round((numParam(c, 'bankroll') ?? 20000) * GOLD),
    topCandidates: Math.min(numParam(c, 'top') ?? 120, 500),
    positions: Math.min(numParam(c, 'positions') ?? 6, 30),
    minVolume: numParam(c, 'minVolume') ?? 500,
    minEdgePct: numParam(c, 'minEdge') ?? 25,
    maxFloorCopper: Math.round((numParam(c, 'maxFloor') ?? 300) * GOLD),
    minFloorCopper: Math.round((numParam(c, 'minFloor') ?? 0.1) * GOLD),
    excludeProjectiles: c.req.query('includeProjectiles') !== '1',
  };
  const key = JSON.stringify(opts);
  const hit = flipsCache.get(key);
  if (hit && Date.now() - hit.at < FLIPS_TTL_MS) {
    return c.json(hit.payload);
  }
  const result = findFlips(db, sqlite, opts);
  flipsCache.set(key, { at: Date.now(), payload: result });
  return c.json(result);
});

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port });
console.log(`api listening on http://localhost:${port}`);
