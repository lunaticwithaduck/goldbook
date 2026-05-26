/** Wowhead/Blizzard item quality (0..7). Quality color hexes match the in-game palette. */
export const QUALITY_COLORS = [
  '#9d9d9d', // 0 Poor (grey)
  '#ffffff', // 1 Common (white)
  '#1eff00', // 2 Uncommon (green)
  '#0070dd', // 3 Rare (blue)
  '#a335ee', // 4 Epic (purple)
  '#ff8000', // 5 Legendary (orange)
  '#e6cc80', // 6 Artifact (gold)
  '#00ccff', // 7 Heirloom (cyan)
];

export function qualityColor(q: number | null | undefined): string {
  if (q == null) return '#9d9d9d';
  return QUALITY_COLORS[Math.max(0, Math.min(7, q))];
}

/**
 * Build a Wowhead/Zamimg icon URL from an icon name. Uses the medium-size CDN.
 * Hotlinking is publicly allowed; for offline use the icons could be mirrored locally.
 */
export function iconUrl(icon: string | null | undefined, size: 'small' | 'medium' | 'large' = 'medium'): string | null {
  if (!icon) return null;
  return `https://wow.zamimg.com/images/wow/icons/${size}/${icon}.jpg`;
}
