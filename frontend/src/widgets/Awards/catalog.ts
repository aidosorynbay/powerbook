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
  // genres read for at least 120 minutes each
  variety: [3, 6, 10],
};
/** One pin per genre (the topic keys of app/services/topics.py) at 600 minutes. */
export const GENRES = ['classics', 'modern_prose', 'fantasy_scifi', 'detective', 'romance', 'self_help', 'psychology', 'business', 'history', 'science', 'philosophy', 'religion', 'biography', 'poetry', 'kazakh'];
export const GENRE_MINUTES = 600;
export const TRACK_ORDER = ['days', 'minutes', 'streak', 'clean', 'together', 'variety'] as const;
export const SPECIAL = ['book_day', 'new_year', 'full_year', 'comeback', 'first_year', 'war_1'];
export const MILLION = 1_000_000;

export const ALL_KEYS: string[] = [...TRACK_ORDER.flatMap((t) => TRACKS[t].map((n) => `${t}_${n}`)), ...GENRES.map((g) => `genre_${g}`), ...SPECIAL];
export const isSecret = (key: string) => SPECIAL.includes(key);

export function trackOf(key: string): { track: string; n: number } {
  if (key.startsWith('genre_')) return { track: 'genre', n: GENRE_MINUTES };
  const i = key.lastIndexOf('_');
  const n = Number(key.slice(i + 1));
  return Number.isFinite(n) && key.slice(0, i) in TRACKS ? { track: key.slice(0, i), n } : { track: 'special', n: 1 };
}

/** The pin's picture: a small one for rows and grids, a large one for the close-up and the story.
 * Not under /awards: a public folder named like a page would shadow it (public/war did, 2026-10-17). */
export const pinSmall = (key: string) => `/award-pins/c/${key}.webp`;
export const pinLarge = (key: string) => `/award-pins/cl/${key}.webp`;
/** The pins are shown bare, cut out of their cloth (council, 2026-10-18): the cloth stays only as the story's
 * whole background. (The old cloth tiles are still in award-pins/<key>.webp and s/, unused.) */
export const CLOTH_STORY = '/award-pins/cloth-story.webp';
/** How much to grow or shrink each pin in its box so that all look the same size by eye (by the share of its
 * square the pin covers: a thin match grows, a wide river shrinks). */
export const PIN_SCALE: Record<string, number> = {
  book_day: 0.90, clean_1: 0.89, clean_10: 1.10, clean_20: 1.15, clean_3: 1.04, clean_5: 0.99,
  comeback: 1.22, days_1: 1.13, days_100: 0.90, days_1000: 1.06, days_200: 1.00, days_30: 0.88,
  days_365: 1.02, days_500: 1.10, first_year: 0.91, full_year: 0.89, genre_biography: 0.99, genre_business: 0.97,
  genre_classics: 1.00, genre_detective: 0.99, genre_fantasy_scifi: 1.00, genre_history: 1.22, genre_kazakh: 1.22, genre_modern_prose: 0.95,
  genre_philosophy: 0.99, genre_poetry: 1.08, genre_psychology: 1.22, genre_religion: 0.87, genre_romance: 0.93, genre_science: 0.99,
  genre_self_help: 1.22, minutes_1000: 1.17, minutes_10000: 1.22, minutes_25000: 1.22, minutes_5000: 1.04, minutes_50000: 0.82,
  new_year: 0.96, streak_100: 1.20, streak_30: 1.17, streak_365: 1.05, streak_7: 1.22, together_1: 1.08,
  together_10: 0.87, together_2: 0.98, together_3: 0.92, together_5: 0.82, variety_10: 0.92, variety_3: 0.83,
  variety_6: 1.12, war_1: 1.08,
};

/** The pin cut out of its cloth, for wearing by an avatar (transparent). */
export const pinCut = (key: string) => `/award-pins/c/${key}.webp`;
