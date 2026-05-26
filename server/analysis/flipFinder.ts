/**
 * Reusable flip-finding logic. Drives both `pnpm flips` (CLI) and `GET /api/flips`.
 *
 * "Edge" is (clearing_median - ah_floor) / ah_floor. Floor comes from the latest
 * Auctionator ingest (items.latest_db_price). Clearing median comes from the most
 * recent nerfed:buyout_median scan for that item. Volume is the 7-day average of
 * nerfed:quantity (singular items posted per day; divide by stack-size for stacks).
 */

import type { Database as SqliteDatabase } from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';

export const GOLD = 10_000;
export const AH_CUT = 0.05;
const LIQUIDITY_FRACTION = 0.1;

export type FlipOpts = {
  realm: string;
  bankrollCopper: number;
  topCandidates: number;
  positions: number;
  minVolume: number;
  minEdgePct: number;
  maxFloorCopper: number;
  minFloorCopper: number;
  excludeProjectiles: boolean;
};

export type Candidate = {
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

export type FlipPick = Candidate & {
  edgePct: number;
  suggestedUnits: number;
  costCopper: number;
  estProfitCopper: number;
};

export type FlipResult = {
  realm: string;
  picks: FlipPick[];
  traps: Candidate[];
  totalCostCopper: number;
  totalProfitCopper: number;
};

export function pickRealm(sqlite: SqliteDatabase, realmFlag?: string): string {
  if (realmFlag) return realmFlag;
  const realms = sqlite
    .prepare('SELECT DISTINCT realm FROM items')
    .all()
    .map((r) => (r as { realm: string }).realm);
  if (realms.length === 1) return realms[0];
  throw new Error(`multiple realms in db (${realms.join(', ')}); pass realm`);
}

export function findCandidates(db: DB, sqlite: SqliteDatabase, opts: FlipOpts): Candidate[] {
  // Step 1: 7-day average quantity per item. Constrained by observed_at so SQLite
  // can use the (observed_at) index rather than scanning all 30M scan rows.
  const rows = db.all<{
    itemId: number;
    name: string;
    category: string | null;
    classId: number | null;
    icon: string | null;
    quality: number | null;
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
      HAVING AVG(s.price_per_unit) >= ${opts.minVolume}
    )
    SELECT i.id          AS itemId,
           i.name        AS name,
           im.category   AS category,
           im.class_id   AS classId,
           im.icon       AS icon,
           im.quality    AS quality,
           i.latest_db_price AS floorCopper,
           q.avg_qty     AS avgQty
    FROM qty7 q
    JOIN items i ON i.id = q.item_id
    LEFT JOIN item_meta im ON im.id = i.meta_id
    WHERE i.realm = ${opts.realm}
    ORDER BY q.avg_qty DESC
    LIMIT ${opts.topCandidates}
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
      icon: r.icon,
      quality: r.quality,
      floorCopper: r.floorCopper,
      medianCopper: med.p,
      avgQtyPerDay: r.avgQty,
      stackSize: r.classId === 6 ? 1000 : 20,
    });
  }
  return out;
}

export function scorePicks(cands: Candidate[], opts: FlipOpts): FlipPick[] {
  const filtered = cands.filter((c) => {
    if (c.floorCopper < opts.minFloorCopper) return false;
    if (c.floorCopper > opts.maxFloorCopper) return false;
    if (opts.excludeProjectiles && c.classId === 6) return false;
    const edge = (c.medianCopper - c.floorCopper) / c.floorCopper;
    return edge * 100 >= opts.minEdgePct;
  });

  const perPositionBudget = Math.floor(opts.bankrollCopper / Math.max(opts.positions, 1));

  const scored: FlipPick[] = filtered.map((c) => {
    const edge = (c.medianCopper - c.floorCopper) / c.floorCopper;
    const liquidityCap = Math.floor(c.avgQtyPerDay * LIQUIDITY_FRACTION);
    const budgetCap = Math.floor(perPositionBudget / c.floorCopper);
    const rawUnits = Math.min(liquidityCap, budgetCap);
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

  scored.sort((a, b) => b.estProfitCopper - a.estProfitCopper);

  const picks: FlipPick[] = [];
  let remaining = opts.bankrollCopper;
  for (const s of scored) {
    if (picks.length >= opts.positions) break;
    if (s.suggestedUnits <= 0) continue;
    if (s.costCopper > remaining) {
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

export function findFlips(db: DB, sqlite: SqliteDatabase, opts: FlipOpts): FlipResult {
  const cands = findCandidates(db, sqlite, opts);
  const picks = scorePicks(cands, opts);
  const traps = cands
    .filter((c) => c.medianCopper < c.floorCopper)
    .sort((a, b) => b.floorCopper / b.medianCopper - a.floorCopper / a.medianCopper);
  return {
    realm: opts.realm,
    picks,
    traps,
    totalCostCopper: picks.reduce((a, p) => a + p.costCopper, 0),
    totalProfitCopper: picks.reduce((a, p) => a + p.estProfitCopper, 0),
  };
}
