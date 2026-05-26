import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Currency: all prices stored in copper (1g = 100s = 10000c).
// Timestamps: stored as raw unix-seconds integers so they round-trip cleanly through JSON.

/**
 * Reference metadata for every known WotLK item, populated by `pnpm meta:fetch`.
 * Keyed on Wowhead/Blizzard item id. Used to drive icons + AH-style filters.
 */
export const itemMeta = sqliteTable(
  'item_meta',
  {
    id: integer('id').primaryKey(), // Wowhead/Blizzard item id
    name: text('name').notNull(),
    quality: integer('quality').notNull(), // 0..7 (poor → heirloom)
    icon: text('icon').notNull(), // "inv_misc_gem_bloodgem_03" (no extension)
    // From tooltip <!--scstart{class}:{subclass}-->. Null for non-gear / consumables.
    classId: integer('class_id'),
    subclassId: integer('subclass_id'),
    // Coarse AH-style category derived from class + name heuristics.
    category: text('category').notNull(), // see CATEGORIES in meta-import.ts
  },
  (t) => ({
    metaNameIdx: index('item_meta_name_idx').on(t.name),
    metaCategoryIdx: index('item_meta_category_idx').on(t.category),
  }),
);

export const items = sqliteTable(
  'items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    realm: text('realm').notNull(),
    // Auctionator numeric item id, when known (only PRICING_HISTORY exposes it).
    auctionatorItemId: integer('auctionator_item_id'),
    // Resolved via name match against item_meta at ingest time. Null if no match.
    metaId: integer('meta_id').references(() => itemMeta.id, { onDelete: 'set null' }),
    // The random-property suffix portion (e.g. "of Power") stripped during meta matching.
    randomSuffix: text('random_suffix'),
    // Denormalized "current price" from the latest source='db' scan. Maintained by the
    // ingest CLI so the dashboard list view can render without touching the scans table
    // (which is now >25M rows after the nerfed backfill).
    latestDbPrice: integer('latest_db_price'),
    latestDbObservedAt: integer('latest_db_observed_at'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    nameRealmUniq: uniqueIndex('items_name_realm_uniq').on(t.name, t.realm),
    nameIdx: index('items_name_idx').on(t.name),
    metaIdx: index('items_meta_idx').on(t.metaId),
  }),
);

export const scans = sqliteTable(
  'scans',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    // Unix seconds. From AUCTIONATOR_LAST_SCAN_TIME for PRICE_DATABASE rows; calibrated
    // from raw_ts for PRICING_HISTORY rows.
    observedAt: integer('observed_at').notNull(),
    pricePerUnit: integer('price_per_unit').notNull(),
    stackSize: integer('stack_size').notNull().default(1),
    // Free-form tag identifying where the price point came from. Known values:
    //   'db'                    — AUCTIONATOR_PRICE_DATABASE (one snapshot per ingest)
    //   'history'               — AUCTIONATOR_PRICING_HISTORY (per-scan, watched items)
    //   'nerfed:buyout_min'     — ah.nerfed.net backfill, min buyout per day
    //   'nerfed:buyout_median'  — ah.nerfed.net backfill, median buyout per day
    //   'nerfed:bid_mean'       — ah.nerfed.net backfill, mean bid per day
    //   'nerfed:bid_median'     — ah.nerfed.net backfill, median bid per day
    //   'nerfed:quantity'       — ah.nerfed.net backfill, auctions-posted count
    source: text('source').notNull(),
    ingestId: integer('ingest_id').references(() => ingests.id, { onDelete: 'set null' }),
  },
  (t) => ({
    // Same item can't be ingested twice at the same observed_at from the same source.
    itemObservedSourceUniq: uniqueIndex('scans_item_observed_source_uniq').on(
      t.itemId,
      t.observedAt,
      t.source,
    ),
    itemIdx: index('scans_item_idx').on(t.itemId),
    observedIdx: index('scans_observed_idx').on(t.observedAt),
  }),
);

/**
 * Per-meta-item state for the ah.nerfed.net backfill. Used to make `pnpm backfill`
 * resumable across crashes / SIGINT and to avoid re-scraping items we've already
 * covered. Keyed on Wowhead/Blizzard item id (matches item_meta.id and items.metaId).
 */
export const backfillState = sqliteTable('backfill_state', {
  metaId: integer('meta_id').primaryKey(),
  realm: text('realm').notNull(), // e.g. "Icecrown_Horde"; future-proofs cross-realm runs
  status: text('status', { enum: ['pending', 'done', 'no_data', 'error'] }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastAttemptAt: integer('last_attempt_at'),
  scansInserted: integer('scans_inserted').notNull().default(0),
  errorMessage: text('error_message'),
});

export const ingests = sqliteTable('ingests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourcePath: text('source_path').notNull(),
  fileHash: text('file_hash').notNull(),
  fileMtime: integer('file_mtime'),
  ingestedAt: integer('ingested_at').notNull().default(sql`(unixepoch())`),
  // The authoritative scan time from AUCTIONATOR_LAST_SCAN_TIME.
  scanTime: integer('scan_time').notNull(),
  realm: text('realm').notNull(),
  dbItems: integer('db_items').notNull(),
  dbInserted: integer('db_inserted').notNull(),
  historyItems: integer('history_items').notNull(),
  historyInserted: integer('history_inserted').notNull(),
});

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Scan = typeof scans.$inferSelect;
export type NewScan = typeof scans.$inferInsert;
export type Ingest = typeof ingests.$inferSelect;
export type ItemMeta = typeof itemMeta.$inferSelect;
export type NewItemMeta = typeof itemMeta.$inferInsert;
export type BackfillState = typeof backfillState.$inferSelect;
