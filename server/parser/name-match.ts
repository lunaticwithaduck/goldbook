/**
 * Resolve an Auctionator-scanned item name against the item_meta reference table.
 *
 * WotLK greens/blues carry random-property suffixes ("Halgrind Gloves of Power") that
 * don't exist in Wowhead's item database — the base item ("Halgrind Gloves") does. We
 * try exact match first, then strip a trailing " of <…>" and try again.
 *
 * Names of the form "<Adjective> <Base>" (e.g. "Brilliant Saronite Boots") ARE distinct
 * items in the DB (a different itemId per adjective+base combo), so we never strip the
 * prefix.
 */

import type { DB } from '../db/client.js';

export type MetaMatch = {
  metaId: number;
  randomSuffix: string | null;
};

/** Strip a trailing " of <suffix>" if present. Returns [base, strippedSuffix]. */
export function stripRandomSuffix(name: string): [string, string | null] {
  // Use the LAST " of " — random suffixes are always at the end. If the prefix turns
  // out not to exist in item_meta, the caller will treat it as unmatched.
  const idx = name.lastIndexOf(' of ');
  if (idx === -1) return [name, null];
  const base = name.slice(0, idx);
  const suffix = name.slice(idx + 1); // "of <...>"
  return [base, suffix];
}

export function buildNameResolver(db: DB) {
  // Pre-load name → id index in memory. ~45k rows × ~40 bytes = ~2 MB. Fine.
  const byName = new Map<string, number>();
  const rows = db.all<{ id: number; name: string }>(
    'SELECT id, name FROM item_meta' as never,
  );
  for (const r of rows) {
    // If multiple ids share a name, prefer the lowest id (usually the canonical one).
    const existing = byName.get(r.name);
    if (existing == null || r.id < existing) byName.set(r.name, r.id);
  }

  return function resolve(name: string): MetaMatch | null {
    const direct = byName.get(name);
    if (direct != null) return { metaId: direct, randomSuffix: null };

    const [base, suffix] = stripRandomSuffix(name);
    if (suffix == null) return null;
    const baseId = byName.get(base);
    if (baseId != null) return { metaId: baseId, randomSuffix: suffix };
    return null;
  };
}
