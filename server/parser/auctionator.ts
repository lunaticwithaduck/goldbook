import type { LuaTable, LuaValue } from './lua.js';
import { parseLuaSavedVariables } from './lua.js';

export type ParsedHistoryScan = {
  itemName: string;
  auctionatorItemId: number;
  rawTs: number;
  pricePerUnit: number;
  stackSize: number;
};

export type ParsedDbEntry = {
  itemName: string;
  pricePerUnit: number;
};

export type ParsedAuctionator = {
  /** Unix seconds — taken from AUCTIONATOR_LAST_SCAN_TIME. Falls back to 0 if absent. */
  lastScanTime: number;
  /** Realms found in AUCTIONATOR_PRICE_DATABASE. Each maps to {itemName -> price}. */
  priceDatabase: Map<string, ParsedDbEntry[]>;
  /** Fine-grained per-scan history for items the user has watched. */
  history: ParsedHistoryScan[];
  /** rawTs range for calibrating history timestamps. */
  historyMinRawTs: number;
  historyMaxRawTs: number;
};

function asTable(v: LuaValue): LuaTable | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as LuaTable;
  return null;
}

export function parseAuctionator(luaSource: string): ParsedAuctionator {
  const root = parseLuaSavedVariables(luaSource);

  const lastScanTime =
    typeof root.AUCTIONATOR_LAST_SCAN_TIME === 'number' ? root.AUCTIONATOR_LAST_SCAN_TIME : 0;

  // --- PRICE_DATABASE: realm-keyed map of itemName -> copper price ---
  const priceDatabase = new Map<string, ParsedDbEntry[]>();
  const db = asTable(root.AUCTIONATOR_PRICE_DATABASE);
  if (db) {
    for (const [realm, entry] of Object.entries(db)) {
      if (realm.startsWith('__')) continue; // skip __dbversion etc.
      const realmTbl = asTable(entry);
      if (!realmTbl) continue;
      const items: ParsedDbEntry[] = [];
      for (const [itemName, raw] of Object.entries(realmTbl)) {
        if (typeof raw !== 'number') continue;
        if (raw <= 0) continue;
        items.push({ itemName, pricePerUnit: Math.round(raw) });
      }
      priceDatabase.set(realm, items);
    }
  }

  // --- PRICING_HISTORY: per-rawTs scans for the shopping-list items ---
  const history: ParsedHistoryScan[] = [];
  let minRaw = Number.POSITIVE_INFINITY;
  let maxRaw = Number.NEGATIVE_INFINITY;
  const hist = asTable(root.AUCTIONATOR_PRICING_HISTORY);
  if (hist) {
    for (const [itemName, entry] of Object.entries(hist)) {
      const tbl = asTable(entry);
      if (!tbl) continue;
      const isStr = typeof tbl.is === 'string' ? tbl.is : null;
      if (!isStr) continue;
      const auctionatorItemId = Number.parseInt(isStr.split(':')[0], 10);
      if (!Number.isFinite(auctionatorItemId) || auctionatorItemId <= 0) continue;
      for (const [key, raw] of Object.entries(tbl)) {
        if (key === 'is') continue;
        const rawTs = Number.parseInt(key, 10);
        if (!Number.isFinite(rawTs)) continue;
        if (typeof raw !== 'string') continue;
        const [priceStr, stackStr] = raw.split(':');
        const pricePerUnit = Number.parseInt(priceStr, 10);
        const stackSize = Number.parseInt(stackStr, 10);
        if (!Number.isFinite(pricePerUnit) || !Number.isFinite(stackSize)) continue;
        history.push({ itemName, auctionatorItemId, rawTs, pricePerUnit, stackSize });
        if (rawTs < minRaw) minRaw = rawTs;
        if (rawTs > maxRaw) maxRaw = rawTs;
      }
    }
  }

  return {
    lastScanTime,
    priceDatabase,
    history,
    historyMinRawTs: Number.isFinite(minRaw) ? minRaw : 0,
    historyMaxRawTs: Number.isFinite(maxRaw) ? maxRaw : 0,
  };
}

/**
 * Calibrate Auctionator's opaque raw_ts (minutes since some custom epoch) by aligning
 * the file's max raw_ts to lastScanTime. Returns the offset to add:
 *   observedAtUnixSec = rawTs * 60 + calibrationOffsetSec
 */
export function deriveHistoryCalibration(maxRawTs: number, lastScanTime: number): number {
  if (maxRawTs <= 0 || lastScanTime <= 0) return 0;
  return lastScanTime - maxRawTs * 60;
}
