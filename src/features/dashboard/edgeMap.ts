import type { ItemEdge } from '../../lib/api.js';

export type EdgeMap = Map<number, ItemEdge>;

export function buildEdgeMap(edges: ItemEdge[] | undefined): EdgeMap {
  const m: EdgeMap = new Map();
  if (!edges) return m;
  for (const e of edges) m.set(e.itemId, e);
  return m;
}
