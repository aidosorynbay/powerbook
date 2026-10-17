/** The awards as the app draws them. Which awards exist and when each is earned is decided in
 * app/services/awards.py (TRACKS, SPECIAL); this mirrors its order for the showcase. */

export const TRACKS: Record<string, number[]> = {
  days: [1, 30, 100, 200, 365, 500, 1000],
  // every minute read, since the first one
  minutes: [1000, 5000, 10000, 25000, 50000],
  streak: [7, 30, 100, 365],
  clean: [1, 3, 5, 10, 20],
  // millions of minutes in the shared treasury
  together: [1, 2, 3, 5, 10],
};
export const TRACK_ORDER = ['days', 'minutes', 'streak', 'clean', 'together'] as const;
export const SPECIAL = ['book_day', 'new_year', 'full_year', 'comeback', 'first_year', 'war_1'];
export const MILLION = 1_000_000;

export const ALL_KEYS: string[] = [...TRACK_ORDER.flatMap((t) => TRACKS[t].map((n) => `${t}_${n}`)), ...SPECIAL];
export const isSecret = (key: string) => SPECIAL.includes(key);

export function trackOf(key: string): { track: string; n: number } {
  const i = key.lastIndexOf('_');
  const n = Number(key.slice(i + 1));
  return Number.isFinite(n) && key.slice(0, i) in TRACKS ? { track: key.slice(0, i), n } : { track: 'special', n: 1 };
}

/** The pin's picture: a small one for rows and grids, a large one for the close-up and the story.
 * Not under /awards: a public folder named like a page would shadow it (public/war did, 2026-10-17). */
export const pinSmall = (key: string) => `/award-pins/s/${key}.webp`;
export const pinLarge = (key: string) => `/award-pins/${key}.webp`;
