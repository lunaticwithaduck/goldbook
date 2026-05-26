import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { eq, sql } from 'drizzle-orm';
import { openDb } from '../db/client.js';
import { ingests, items, scans } from '../db/schema.js';
import { deriveHistoryCalibration, parseAuctionator } from './auctionator.js';
import { buildNameResolver } from './name-match.js';

const DEFAULT_LUA_PATH =
  '/home/denshi/Games/WoW/WTF/Account/MIRKO344/SavedVariables/Auctionator.lua';

function parseCliArgs() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      realm: { type: 'string' },
      file: { type: 'string', short: 'f' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: pnpm ingest [--realm <realm>] [--file <path>] [path-to-Auctionator.lua]\n' +
        `Default path: ${DEFAULT_LUA_PATH}`,
    );
    process.exit(0);
  }
  const path = values.file ?? positionals[0] ?? process.env.GOLDBOOK_LUA_PATH ?? DEFAULT_LUA_PATH;
  return { path: resolve(path), realm: values.realm };
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function main() {
  const { path, realm: realmFlag } = parseCliArgs();
  console.log(`reading ${path}`);
  const raw = readFileSync(path);
  const stat = statSync(path);
  const fileHash = sha256(raw);
  const text = raw.toString('utf8');

  console.log('parsing lua…');
  const parsed = parseAuctionator(text);

  // Pick a realm: flag wins, otherwise if exactly one realm in PRICE_DATABASE use that.
  const realmsInDb = [...parsed.priceDatabase.keys()];
  const realm = realmFlag ?? (realmsInDb.length === 1 ? realmsInDb[0] : undefined);
  if (!realm) {
    console.error(
      `error: multiple realms in PRICE_DATABASE (${realmsInDb.join(', ')}); pass --realm <name>`,
    );
    process.exit(1);
  }

  const dbEntries = parsed.priceDatabase.get(realm) ?? [];
  const historyCalibration = deriveHistoryCalibration(parsed.historyMaxRawTs, parsed.lastScanTime);

  console.log(
    `  realm=${realm}  lastScan=${new Date(parsed.lastScanTime * 1000).toISOString()}\n` +
      `  PRICE_DATABASE: ${dbEntries.length} items\n` +
      `  PRICING_HISTORY: ${parsed.history.length} scans (rawTs ${parsed.historyMinRawTs}..${parsed.historyMaxRawTs}, offset ${historyCalibration}s)`,
  );

  if (parsed.lastScanTime <= 0) {
    console.error('error: AUCTIONATOR_LAST_SCAN_TIME missing; refusing to ingest without it');
    process.exit(1);
  }

  const { db, sqlite } = openDb();
  const resolveMeta = buildNameResolver(db);

  let dbInserted = 0;
  let historyInserted = 0;
  let metaMatched = 0;

  const ingestRow = db.transaction((tx) => {
    // Upsert items (PRICE_DATABASE provides name-only; PRICING_HISTORY also provides id)
    const nameToAuctionatorId = new Map<string, number | undefined>();
    for (const e of dbEntries) {
      if (!nameToAuctionatorId.has(e.itemName)) nameToAuctionatorId.set(e.itemName, undefined);
    }
    for (const h of parsed.history) {
      nameToAuctionatorId.set(h.itemName, h.auctionatorItemId);
    }

    // Insert/update item rows; remember internal id by name.
    const idByName = new Map<string, number>();
    for (const [name, aId] of nameToAuctionatorId) {
      const match = resolveMeta(name);
      if (match) metaMatched++;
      tx
        .insert(items)
        .values({
          name,
          realm,
          auctionatorItemId: aId ?? null,
          metaId: match?.metaId ?? null,
          randomSuffix: match?.randomSuffix ?? null,
        })
        .onConflictDoUpdate({
          target: [items.name, items.realm],
          set: {
            ...(aId != null ? { auctionatorItemId: aId } : {}),
            metaId: match?.metaId ?? null,
            randomSuffix: match?.randomSuffix ?? null,
          },
        })
        .run();
      const row = tx
        .select({ id: items.id })
        .from(items)
        .where(sql`${items.name} = ${name} AND ${items.realm} = ${realm}`)
        .get();
      if (row) idByName.set(name, row.id);
    }

    // Create the ingest row first so we can stamp scans with its id.
    const ingest = tx
      .insert(ingests)
      .values({
        sourcePath: path,
        fileHash,
        fileMtime: Math.floor(stat.mtimeMs / 1000),
        scanTime: parsed.lastScanTime,
        realm,
        dbItems: dbEntries.length,
        dbInserted: 0,
        historyItems: 0,
        historyInserted: 0,
      })
      .returning()
      .get();

    // Insert PRICE_DATABASE scans — one snapshot per item at scanTime.
    for (const e of dbEntries) {
      const itemId = idByName.get(e.itemName);
      if (itemId == null) continue;
      const res = tx
        .insert(scans)
        .values({
          itemId,
          observedAt: parsed.lastScanTime,
          pricePerUnit: e.pricePerUnit,
          stackSize: 1,
          source: 'db',
          ingestId: ingest.id,
        })
        .onConflictDoNothing()
        .run();
      dbInserted += res.changes;
    }

    // Insert PRICING_HISTORY scans with calibrated observedAt.
    const historyItemNames = new Set<string>();
    for (const h of parsed.history) {
      historyItemNames.add(h.itemName);
      const itemId = idByName.get(h.itemName);
      if (itemId == null) continue;
      const observedAt = h.rawTs * 60 + historyCalibration;
      const res = tx
        .insert(scans)
        .values({
          itemId,
          observedAt,
          pricePerUnit: h.pricePerUnit,
          stackSize: h.stackSize,
          source: 'history',
          ingestId: ingest.id,
        })
        .onConflictDoNothing()
        .run();
      historyInserted += res.changes;
    }

    tx
      .update(ingests)
      .set({
        dbInserted,
        historyItems: historyItemNames.size,
        historyInserted,
      })
      .where(eq(ingests.id, ingest.id))
      .run();

    return ingest;
  });

  console.log(
    `ingest #${ingestRow.id}: +${dbInserted} db scans, +${historyInserted} history scans, ` +
      `${metaMatched}/${nameToAuctionatorIdSize(parsed, dbEntries)} items matched to meta`,
  );
  sqlite.close();
}

function nameToAuctionatorIdSize(
  parsed: ReturnType<typeof parseAuctionator>,
  dbEntries: { itemName: string }[],
) {
  const s = new Set<string>();
  for (const e of dbEntries) s.add(e.itemName);
  for (const h of parsed.history) s.add(h.itemName);
  return s.size;
}

main();
