/**
 * WoW currency uses 3 denominations:
 *   1 gold = 100 silver = 10000 copper.
 * Auctionator stores prices in copper.
 */

export function formatCopper(c: number | null | undefined): string {
  if (c == null || !Number.isFinite(c)) return '—';
  const sign = c < 0 ? '-' : '';
  const abs = Math.abs(Math.round(c));
  const gold = Math.floor(abs / 10000);
  const silver = Math.floor((abs % 10000) / 100);
  const copper = abs % 100;
  const parts: string[] = [];
  if (gold) parts.push(`${gold.toLocaleString()}g`);
  if (silver || gold) parts.push(`${silver}s`);
  parts.push(`${copper}c`);
  return sign + parts.join(' ');
}

export function formatGoldShort(c: number | null | undefined): string {
  if (c == null || !Number.isFinite(c)) return '—';
  const g = c / 10000;
  if (g >= 1000) return `${(g / 1000).toFixed(1)}kg`;
  if (g >= 1) return `${g.toFixed(2)}g`;
  const s = c / 100;
  if (s >= 1) return `${s.toFixed(0)}s`;
  return `${c}c`;
}
