/**
 * Flip finder. Given a gold bankroll, suggest items to buy at today's AH floor
 * and re-list at the historical clearing median.
 *
 *   pnpm flips                        # 20kg bankroll, default filters
 *   pnpm flips --bankroll 50000
 *   pnpm flips --realm Icecrown_Horde --top 200 --positions 8
 *   pnpm flips --min-volume 1000 --min-edge 40 --max-floor 100
 *   pnpm flips --json
 *
 * "Edge" is (clearing_median - ah_floor) / ah_floor. Floor comes from the latest
 * Auctionator ingest (items.latest_db_price). Clearing median comes from the most
 * recent nerfed:buyout_median scan for that item. Volume is the 7-day average of
 * nerfed:quantity (singular items posted per day; divide by stack-size for stacks).
 */

import { parseArgs } from 'node:util';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { openDb } from '../db/client.js';

const GOLD = 10_000; // copper per gold
const AH_CUT = 0.05; // 5% AH cut taken from the seller on sale

type Args = {
  realm: string | undefined;
  bankrollCopper: number;
  topCandidates: number;
  positions: number;
  minVolume: number;
  minEdgePct: number;
  maxFloorCopper: number;
  minFloorCopper: number;
  excludeProjectiles: boolean;
  json: boolean;
};

function parseCli(): Args {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      realm: { type: 'string' },
      bankroll: { type: 'string', default: '20000' }, // in gold
      top: { type: 'string', default: '120' },
      positions: { type: 'string', default: '6' },
      'min-volume': { type: 'string', default: '500' },
      'min-edge': { type: 'string', default: '25' },
      'max-floor': { type: 'string', default: '300' }, // in gold
      'min-floor': { type: 'string', default: '0.10' }, // in gold; skip vendor-priced junk
      'include-projectiles': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: pnpm flips [--realm <name>] [--bankroll <gold>] [--top <n>] [--positions <n>]\n' +
        '                  [--min-volume <units/day>] [--min-edge <pct>]\n' +
        '                  [--max-floor <gold>] [--min-floor <gold>]\n' +
        '                  [--include-projectiles] [--json]',
    );
    process.exit(0);
  }
  return {
    realm: values.realm,
    bankrollCopper: Math.round(Number(values.bankroll) * GOLD),
    topCandidates: Number(values.top),
    positions: Number(values.positions),
    minVolume: Number(values['min-volume']),
    minEdgePct: Number(values['min-edge']),
    maxFloorCopper: Math.round(Number(values['max-floor']) * GOLD),
    minFloorCopper: Math.round(Number(values['min-floor']) * GOLD),
    excludeProjectiles: !values['include-projectiles'],
    json: values.json,
  };
}

function pickRealm(sqlite: SqliteDatabase, realmFlag?: string): string {
  if (realmFlag) return realmFlag;
  const realms = sqlite
    .prepare('SELECT DISTINCT realm FROM items')
    .all()
    .map((r) => (r as { realm: string }).realm);
  if (realms.length === 1) return realms[0];
  throw new Error(`multiple realms in db (${realms.join(', ')}); pass --realm`);
}

type Candidate = {
  itemId: number;
  name: string;
  category: string | null;
  classId: number | null;
  floorCopper: number;
  medianCopper: number;
  avgQtyPerDay: number;
  stackSize: number;
};

type FlipPick = Candidate & {
  edgePct: number;
  suggestedUnits: number;
  costCopper: number;
  estProfitCopper: number;
};

function findCandidates(
  db: DB,
  sqlite: SqliteDatabase,
  realm: string,
  args: Args,
): Candidate[] {
  // Step 1: 7-day average quantity per item. Constrained by observed_at so SQLite
  // can use the (observed_at) index rather than scanning all 30M scan rows.
  const rows = db.all<{
    itemId: number;
    name: string;
    category: string | null;
    classId: number | null;
    floorCopper: number | null;
    avgQty: number;
  }>(sql`
    WITH max_qty_ts AS (
      SELECT MAX(observed_at) AS t
      FROM scans
      WHERE source = 'nerfed:quantity'
    ),
    qty7 AS (
      SELECT s.item_id, AVG(s.price_per_unit) AS avg_qty
      FROM scans s
      WHERE s.source = 'nerfed:quantity'
        AND s.observed_at >= (SELECT t FROM max_qty_ts) - 7 * 86400
      GROUP BY s.item_id
      HAVING AVG(s.price_per_unit) >= ${args.minVolume}
    )
    SELECT i.id          AS itemId,
           i.name        AS name,
           im.category   AS category,
           im.class_id   AS classId,
           i.latest_db_price AS floorCopper,
           q.avg_qty     AS avgQty
    FROM qty7 q
    JOIN items i ON i.id = q.item_id
    LEFT JOIN item_meta im ON im.id = i.meta_id
    WHERE i.realm = ${realm}
    ORDER BY q.avg_qty DESC
    LIMIT ${args.topCandidates}
  `);

  if (rows.length === 0) return [];

  // Step 2: latest nerfed:buyout_median per candidate (indexed by item_id).
  const medianStmt = sqlite.prepare(
    `SELECT price_per_unit AS p
       FROM scans
       WHERE item_id = ? AND source = 'nerfed:buyout_median'
       ORDER BY observed_at DESC
       LIMIT 1`,
  );

  const out: Candidate[] = [];
  for (const r of rows) {
    if (r.floorCopper == null || r.floorCopper <= 0) continue;
    const med = medianStmt.get(r.itemId) as { p: number } | undefined;
    if (!med || med.p <= 0) continue;
    out.push({
      itemId: r.itemId,
      name: r.name,
      category: r.category,
      classId: r.classId,
      floorCopper: r.floorCopper,
      medianCopper: med.p,
      avgQtyPerDay: r.avgQty,
      stackSize: r.classId === 6 ? 1000 : 20,
    });
  }
  return out;
}

function scorePicks(cands: Candidate[], args: Args): FlipPick[] {
  // Apply price-band and edge filters.
  const filtered = cands.filter((c) => {
    if (c.floorCopper < args.minFloorCopper) return false;
    if (c.floorCopper > args.maxFloorCopper) return false;
    if (args.excludeProjectiles && c.classId === 6) return false;
    const edge = (c.medianCopper - c.floorCopper) / c.floorCopper;
    return edge * 100 >= args.minEdgePct;
  });

  // Score each candidate by (estProfit after AH cut, capped by liquidity and bankroll budget).
  const perPositionBudget = Math.floor(args.bankrollCopper / Math.max(args.positions, 1));
  // Conservative liquidity cap: don't buy more than ~10% of one day's market volume.
  const liquidityFraction = 0.1;

  const scored: FlipPick[] = filtered.map((c) => {
    const edge = (c.medianCopper - c.floorCopper) / c.floorCopper;
    const liquidityCap = Math.floor(c.avgQtyPerDay * liquidityFraction);
    const budgetCap = Math.floor(perPositionBudget / c.floorCopper);
    const rawUnits = Math.min(liquidityCap, budgetCap);
    // Snap down to a whole stack so the suggestion is something the user can actually post.
    const units = Math.max(c.stackSize, Math.floor(rawUnits / c.stackSize) * c.stackSize);
    const safeUnits = Math.min(units, rawUnits > 0 ? rawUnits : 0);
    const cost = safeUnits * c.floorCopper;
    const grossRevenue = safeUnits * c.medianCopper * (1 - AH_CUT);
    const profit = Math.round(grossRevenue - cost);
    return {
      ...c,
      edgePct: edge * 100,
      suggestedUnits: safeUnits,
      costCopper: cost,
      estProfitCopper: profit,
    };
  });

  // Highest absolute profit first; the user has finite slots and wants max gold/day.
  scored.sort((a, b) => b.estProfitCopper - a.estProfitCopper);

  // Greedy bankroll fit: take picks in order until we run out of gold.
  const picks: FlipPick[] = [];
  let remaining = args.bankrollCopper;
  for (const s of scored) {
    if (picks.length >= args.positions) break;
    if (s.suggestedUnits <= 0) continue;
    if (s.costCopper > remaining) {
      // Shrink this position to fit what's left, rounded down to a stack.
      const shrunkUnits = Math.floor(remaining / s.floorCopper / s.stackSize) * s.stackSize;
      if (shrunkUnits <= 0) continue;
      const cost = shrunkUnits * s.floorCopper;
      const profit = Math.round(shrunkUnits * s.medianCopper * (1 - AH_CUT) - cost);
      picks.push({ ...s, suggestedUnits: shrunkUnits, costCopper: cost, estProfitCopper: profit });
      remaining -= cost;
      continue;
    }
    picks.push(s);
    remaining -= s.costCopper;
  }
  return picks;
}

function fmtGold(copper: number): string {
  const sign = copper < 0 ? '-' : '';
  const c = Math.abs(copper);
  return `${sign}${(c / GOLD).toFixed(2)}g`;
}

function printTable(picks: FlipPick[], traps: Candidate[], args: Args, realm: string) {
  const totalCost = picks.reduce((a, p) => a + p.costCopper, 0);
  const totalProfit = picks.reduce((a, p) => a + p.estProfitCopper, 0);

  console.log(`\nflip picks (realm=${realm}, bankroll=${fmtGold(args.bankrollCopper)})`);
  console.log('-'.repeat(102));
  console.log(
    'item'.padEnd(28) +
      'buy @'.padStart(11) +
      'sell @'.padStart(11) +
      'edge'.padStart(8) +
      'qty/day'.padStart(10) +
      'units'.padStart(9) +
      'cost'.padStart(13) +
      'profit'.padStart(12),
  );
  console.log('-'.repeat(102));
  for (const p of picks) {
    console.log(
      p.name.slice(0, 27).padEnd(28) +
        fmtGold(p.floorCopper).padStart(11) +
        fmtGold(p.medianCopper).padStart(11) +
        `${p.edgePct.toFixed(0)}%`.padStart(8) +
        p.avgQtyPerDay.toFixed(0).padStart(10) +
        p.suggestedUnits.toString().padStart(9) +
        fmtGold(p.costCopper).padStart(13) +
        fmtGold(p.estProfitCopper).padStart(12),
    );
  }
  console.log('-'.repeat(102));
  console.log(
    `totals: cost ${fmtGold(totalCost)}, projected profit ${fmtGold(totalProfit)} ` +
      `(after ${(AH_CUT * 100).toFixed(0)}% AH cut; assumes full sell-through at median)`,
  );

  if (traps.length > 0) {
    console.log('\ntraps (current floor >= clearing median; do not flip):');
    for (const t of traps.slice(0, 8)) {
      const drift = ((t.floorCopper - t.medianCopper) / t.medianCopper) * 100;
      console.log(
        `  ${t.name.padEnd(27)} floor ${fmtGold(t.floorCopper).padStart(9)} vs med ` +
          `${fmtGold(t.medianCopper).padStart(9)}  (${drift >= 0 ? '+' : ''}${drift.toFixed(0)}%)`,
      );
    }
  }
}

function main() {
  const args = parseCli();
  const { db, sqlite } = openDb();
  const realm = pickRealm(sqlite, args.realm);

  const candidates = findCandidates(db, sqlite, realm, args);
  if (candidates.length === 0) {
    console.error('no candidates — try lowering --min-volume or check that the db has nerfed data');
    process.exit(1);
  }

  const picks = scorePicks(candidates, args);
  const traps = candidates
    .filter((c) => c.medianCopper < c.floorCopper)
    .sort((a, b) => b.floorCopper / b.medianCopper - a.floorCopper / a.medianCopper);

  if (args.json) {
    console.log(JSON.stringify({ realm, bankrollCopper: args.bankrollCopper, picks, traps }, null, 2));
  } else {
    printTable(picks, traps, args, realm);
  }

  sqlite.close();
}

main();
