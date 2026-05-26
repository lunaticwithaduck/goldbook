/**
 * Backfill historical AH data from ah.nerfed.net into our scans table.
 *
 * Safe to leave running unattended: throttled, resumable, signal-aware.
 *
 *   pnpm backfill                           # default: realm=Icecrown_Horde, delay 2500ms
 *   pnpm backfill --delay 5000              # be even more polite
 *   pnpm backfill --realm Icecrown_Alliance # other realm (15/0 by convention)
 *   pnpm backfill --reset                   # forget previous progress and restart
 *
 * Resume: the backfill_state table records done / no_data / error per Wowhead item id,
 * so re-running picks up where the last run stopped (whether SIGINT or crash).
 */

import { parseArgs } from 'node:util';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { openDb } from '../db/client.js';
import { backfillState, items } from '../db/schema.js';
import { fetchItem, type NerfedParsed } from './nerfed.js';

// Realm IDs as used by ah.nerfed.net. Icecrown = 15, Lordaeron = 12 (per their UI).
const REALM_TO_NERFED: Record<string, { realm: number; faction: number }> = {
  Icecrown_Horde: { realm: 15, faction: 1 },
  Icecrown_Alliance: { realm: 15, faction: 0 },
  Lordaeron_Horde: { realm: 12, faction: 1 },
  Lordaeron_Alliance: { realm: 12, faction: 0 },
};

type Args = {
  realm: string;
  delayMs: number;
  jitterMs: number;
  reset: boolean;
  limit: number | null;
  retryErrors: boolean;
};

function parseCliArgs(): Args {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      realm: { type: 'string', default: 'Icecrown_Horde' },
      delay: { type: 'string', default: '2500' },
      jitter: { type: 'string', default: '500' },
      reset: { type: 'boolean', default: false },
      limit: { type: 'string' },
      'retry-errors': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      [
        'Usage: pnpm backfill [options]',
        '',
        '  --realm <name>      Realm key (default: Icecrown_Horde). Supported:',
        `                      ${Object.keys(REALM_TO_NERFED).join(', ')}`,
        '  --delay <ms>        Mean delay between requests (default: 2500)',
        '  --jitter <ms>       Random extra delay 0..jitter (default: 500)',
        '  --limit <n>         Stop after n items (useful for testing)',
        '  --reset             Forget previous backfill_state and start over',
        '  --retry-errors      Also re-try items previously marked as error',
        '',
        'Resume: re-running the same command picks up where it stopped.',
      ].join('\n'),
    );
    process.exit(0);
  }
  return {
    realm: values.realm as string,
    delayMs: Number(values.delay),
    jitterMs: Number(values.jitter),
    reset: !!values.reset,
    limit: values.limit ? Number(values.limit) : null,
    retryErrors: !!values['retry-errors'],
  };
}

function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        clearTimeout(t);
        resolve();
      });
    }
  });
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '?';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Enumerate distinct Wowhead item ids on the given realm, in stable order. */
function loadWorkQueue(db: DB, realm: string): Array<{ metaId: number; sampleName: string }> {
  return db.all<{ metaId: number; sampleName: string }>(sql`
    select min(${items.id}) as item_pk,
           ${items.metaId} as metaId,
           min(${items.name}) as sampleName
    from ${items}
    where ${items.realm} = ${realm}
      and ${items.metaId} is not null
    group by ${items.metaId}
    order by metaId asc
  `);
}

function shouldSkip(
  status: string | undefined,
  retryErrors: boolean,
): boolean {
  if (status === 'done') return true;
  if (status === 'no_data') return true;
  if (status === 'error' && !retryErrors) return true;
  return false;
}

function insertNerfedScans(
  sqlite: SqliteDatabase,
  itemRowIds: number[],
  parsed: NerfedParsed,
): number {
  // For each (timestamp, series), insert a scans row for every item-row that shares
  // this metaId. Most metaIds map to a single items row, but random-suffix gear can
  // have several ("Halgrind Gloves of Power" + "of Stamina" → same base).
  let inserted = 0;
  const insert = sqlite.prepare(
    'INSERT OR IGNORE INTO scans (item_id, observed_at, price_per_unit, stack_size, source) VALUES (?, ?, ?, 1, ?)',
  );

  const seriesData: Array<[string, Array<{ ts: number; valueCopper: number }>]> = [
    ['nerfed:buyout_min', parsed.buyout_min],
    ['nerfed:buyout_median', parsed.buyout_median],
    ['nerfed:bid_mean', parsed.bid_mean],
    ['nerfed:bid_median', parsed.bid_median],
  ];

  const txn = sqlite.transaction(() => {
    for (const [source, points] of seriesData) {
      for (const p of points) {
        for (const itemRowId of itemRowIds) {
          const res = insert.run(itemRowId, p.ts, p.valueCopper, source);
          inserted += res.changes;
        }
      }
    }
    for (const p of parsed.quantity) {
      for (const itemRowId of itemRowIds) {
        const res = insert.run(itemRowId, p.ts, p.count, 'nerfed:quantity');
        inserted += res.changes;
      }
    }
  });
  txn();
  return inserted;
}

async function main() {
  const args = parseCliArgs();
  const nerfed = REALM_TO_NERFED[args.realm];
  if (!nerfed) {
    console.error(
      `error: unknown realm '${args.realm}'. Supported: ${Object.keys(REALM_TO_NERFED).join(', ')}`,
    );
    process.exit(1);
  }

  const { db, sqlite } = openDb();

  if (args.reset) {
    const r = sqlite.prepare('DELETE FROM backfill_state WHERE realm = ?').run(args.realm);
    console.log(`reset: cleared ${r.changes} prior backfill_state rows for ${args.realm}`);
  }

  const queue = loadWorkQueue(db, args.realm);
  if (queue.length === 0) {
    console.error(`no items to backfill for realm=${args.realm} (have you run ingest yet?)`);
    process.exit(1);
  }

  // Pre-load existing backfill_state to decide what to skip without round-tripping.
  const stateRows = db
    .select()
    .from(backfillState)
    .where(eq(backfillState.realm, args.realm))
    .all();
  const stateByMeta = new Map(stateRows.map((s) => [s.metaId, s]));

  // Build a metaId -> item-row-ids map so we can fan-out inserts in one query.
  const metaToItemRows = new Map<number, number[]>();
  {
    const all = db
      .select({ id: items.id, metaId: items.metaId })
      .from(items)
      .where(eq(items.realm, args.realm))
      .all();
    for (const r of all) {
      if (r.metaId == null) continue;
      const list = metaToItemRows.get(r.metaId) ?? [];
      list.push(r.id);
      metaToItemRows.set(r.metaId, list);
    }
  }

  // Plan the run.
  const todo = queue.filter(
    (q) => !shouldSkip(stateByMeta.get(q.metaId)?.status, args.retryErrors),
  );
  const limited = args.limit != null ? todo.slice(0, args.limit) : todo;
  console.log(
    `backfill plan: ${limited.length} item(s) to fetch ` +
      `(${queue.length} unique on realm, ${queue.length - todo.length} already covered)`,
  );
  console.log(
    `throttle: ${args.delayMs}ms + 0..${args.jitterMs}ms jitter, realm=${args.realm} (nerfed=${nerfed.realm}/faction=${nerfed.faction})`,
  );
  const meanDelaySec = (args.delayMs + args.jitterMs / 2) / 1000;
  console.log(
    `estimated wall-clock: ${formatDuration(limited.length * meanDelaySec)} (≈${meanDelaySec.toFixed(1)}s per item)`,
  );
  console.log('---');

  const abortController = new AbortController();
  let stopRequested = false;
  process.on('SIGINT', () => {
    if (stopRequested) {
      console.log('\nforce-quitting');
      process.exit(130);
    }
    console.log('\nSIGINT received — finishing current item and exiting cleanly…');
    stopRequested = true;
    abortController.abort();
  });

  const upsertState = sqlite.prepare(`
    INSERT INTO backfill_state (meta_id, realm, status, attempts, last_attempt_at, scans_inserted, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(meta_id) DO UPDATE SET
      realm = excluded.realm,
      status = excluded.status,
      attempts = excluded.attempts,
      last_attempt_at = excluded.last_attempt_at,
      scans_inserted = backfill_state.scans_inserted + excluded.scans_inserted,
      error_message = excluded.error_message
  `);

  const startedAt = Date.now();
  let i = 0;
  let totalInserted = 0;
  let okCount = 0;
  let noDataCount = 0;
  let errorCount = 0;

  for (const q of limited) {
    if (stopRequested) break;
    i++;
    const prior = stateByMeta.get(q.metaId);
    const attempts = (prior?.attempts ?? 0) + 1;
    const itemRowIds = metaToItemRows.get(q.metaId) ?? [];

    // Retry loop for transient failures (max 3 tries with exponential backoff).
    let result: Awaited<ReturnType<typeof fetchItem>> | null = null;
    for (let attempt = 0; attempt < 3 && !stopRequested; attempt++) {
      result = await fetchItem(q.metaId, {
        realmId: nerfed.realm,
        faction: nerfed.faction,
        timeoutMs: 30_000,
      });
      if (result.kind !== 'retry') break;
      const backoffSec =
        result.retryAfterSec != null ? result.retryAfterSec : [10, 30, 90][attempt] ?? 90;
      console.log(
        `  retry: ${q.sampleName} (#${q.metaId}) HTTP ${result.status}, waiting ${backoffSec}s`,
      );
      await sleep(backoffSec * 1000, abortController.signal);
    }
    if (!result) break;

    const now = Math.floor(Date.now() / 1000);
    if (result.kind === 'ok') {
      const inserted = insertNerfedScans(sqlite, itemRowIds, result.parsed);
      totalInserted += inserted;
      okCount++;
      upsertState.run(q.metaId, args.realm, 'done', attempts, now, inserted, null);
    } else if (result.kind === 'no_data') {
      noDataCount++;
      upsertState.run(q.metaId, args.realm, 'no_data', attempts, now, 0, null);
    } else if (result.kind === 'retry') {
      // Exhausted retries — treat as transient error, can be retried later.
      errorCount++;
      upsertState.run(
        q.metaId,
        args.realm,
        'error',
        attempts,
        now,
        0,
        `HTTP ${result.status} (retries exhausted)`,
      );
    } else {
      errorCount++;
      upsertState.run(q.metaId, args.realm, 'error', attempts, now, 0, result.message);
    }

    if (i % 25 === 0 || i === limited.length) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = i / elapsed;
      const eta = rate > 0 ? (limited.length - i) / rate : 0;
      console.log(
        `[${new Date().toISOString().slice(11, 19)}] ${i}/${limited.length} ` +
          `(${((i / limited.length) * 100).toFixed(1)}%) ` +
          `ok=${okCount} no_data=${noDataCount} err=${errorCount} ` +
          `+${totalInserted.toLocaleString()} scans · ETA ${formatDuration(eta)}`,
      );
    }

    if (!stopRequested && i < limited.length) {
      const jitter = args.jitterMs > 0 ? Math.random() * args.jitterMs : 0;
      await sleep(args.delayMs + jitter, abortController.signal);
    }
  }

  const elapsedSec = (Date.now() - startedAt) / 1000;
  console.log('---');
  console.log(
    `done: processed=${i} ok=${okCount} no_data=${noDataCount} error=${errorCount} ` +
      `inserted ${totalInserted.toLocaleString()} scan rows in ${formatDuration(elapsedSec)}`,
  );
  if (stopRequested) console.log('(stopped early via SIGINT — re-run to resume)');

  sqlite.close();
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
