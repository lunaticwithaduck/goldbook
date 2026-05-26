import { serve } from '@hono/node-server';
import { and, asc, desc, eq, inArray, like, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { openDb } from './db/client.js';
import { ingests, itemMeta, items, scans } from './db/schema.js';

const { db } = openDb();
const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/stats', (c) => {
  const itemCount = db.select({ n: sql<number>`count(*)` }).from(items).get()?.n ?? 0;
  const scanCount = db.select({ n: sql<number>`count(*)` }).from(scans).get()?.n ?? 0;
  const metaCount = db.select({ n: sql<number>`count(*)` }).from(itemMeta).get()?.n ?? 0;
  const lastIngest = db
    .select()
    .from(ingests)
    .orderBy(desc(ingests.ingestedAt))
    .limit(1)
    .get();
  return c.json({ itemCount, scanCount, metaCount, lastIngest: lastIngest ?? null });
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
  const limit = Math.min(Number(c.req.query('limit') ?? 200), 5000);
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);

  const filters: SQL[] = [];
  if (q) filters.push(like(items.name, `%${q}%`));
  if (category) filters.push(eq(itemMeta.category, category));
  if (qualityMin) filters.push(sql`${itemMeta.quality} >= ${Number(qualityMin)}`);

  const where = filters.length > 0 ? and(...filters) : undefined;

  const rows = db
    .select({
      id: items.id,
      name: items.name,
      realm: items.realm,
      randomSuffix: items.randomSuffix,
      metaId: itemMeta.id,
      icon: itemMeta.icon,
      quality: itemMeta.quality,
      category: itemMeta.category,
      classId: itemMeta.classId,
      subclassId: itemMeta.subclassId,
      scanCount: sql<number>`count(${scans.id})`.as('scan_count'),
      latestPrice: sql<number | null>`(
        select ${scans.pricePerUnit}
        from ${scans}
        where ${scans.itemId} = ${items.id}
        order by ${scans.observedAt} desc
        limit 1
      )`.as('latest_price'),
      latestObservedAt: sql<number | null>`(
        select ${scans.observedAt}
        from ${scans}
        where ${scans.itemId} = ${items.id}
        order by ${scans.observedAt} desc
        limit 1
      )`.as('latest_observed_at'),
    })
    .from(items)
    .leftJoin(itemMeta, eq(itemMeta.id, items.metaId))
    .leftJoin(scans, eq(scans.itemId, items.id))
    .where(where)
    .groupBy(items.id)
    .orderBy(asc(items.name))
    .limit(limit)
    .offset(offset)
    .all();

  // Total count (matching filters), for pagination
  const totalRow = db
    .select({ n: sql<number>`count(distinct ${items.id})` })
    .from(items)
    .leftJoin(itemMeta, eq(itemMeta.id, items.metaId))
    .where(where)
    .get();

  return c.json({ items: rows, total: totalRow?.n ?? 0 });
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

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port });
console.log(`api listening on http://localhost:${port}`);
