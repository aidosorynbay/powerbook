/**
 * Deterministic color from a string — same seed always gets the same color,
 * different seeds spread across a curated palette instead of everyone
 * sharing the one brand-accent orange.
 */
const PALETTE = [
  '#F26430', // brand accent (kept in rotation, not the only option)
  '#4ECDC4', // teal
  '#7C83FD', // indigo
  '#F2A93B', // amber
  '#63E6BE', // mint
  '#F783C8', // pink
  '#45AAF2', // sky
  '#E8574B', // coral red
  '#B980F0', // violet
  '#E8C547', // gold
  '#5FD068', // green
  '#F76E9C', // rose
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function colorFromSeed(seed: string): string {
  if (!seed) return PALETTE[0];
  return PALETTE[hashString(seed) % PALETTE.length];
}
