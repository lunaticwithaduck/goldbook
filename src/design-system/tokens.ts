/**
 * Design tokens. Kept intentionally small (<= 6 values per scale) so the UI stays
 * disciplined. Components must consume tokens, never raw values.
 */

export const color = {
  bg: '#0c0d10', // page background
  surface: '#15171c', // panels, cards
  border: '#23262d', // dividers, separators
  text: '#e6e7eb', // primary text (use opacity for muted)
  up: '#26a69a', // bullish / price up (TradingView green)
  down: '#ef5350', // bearish / price down (TradingView red)
} as const;

export const space = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '24px',
  6: '32px',
} as const;

export const font = {
  1: '11px', // micro / labels
  2: '12px', // small
  3: '14px', // body
  4: '16px', // emphasized
  5: '20px', // heading
  6: '28px', // display
} as const;

export const radius = {
  1: '2px',
  2: '4px',
  3: '6px',
  4: '8px',
} as const;

export const weight = {
  regular: 400,
  medium: 500,
  bold: 600,
} as const;

export type ColorToken = keyof typeof color;
export type SpaceToken = keyof typeof space;
export type FontToken = keyof typeof font;
export type RadiusToken = keyof typeof radius;
