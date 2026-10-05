import type { BarysStage } from '@/widgets/Mascot';

/** The stickers, in the order the sheet offers them. */
export const STICKERS = ['page', 'shelf', 'slip', 'barys'] as const;
export type StickerKind = (typeof STICKERS)[number];

/** Every word a sticker prints, already in the reader's language. */
export type StickerWords = {
  /** "минут сегодня", or "минут" for another day than today. */
  unit: string;
  /** "день 5 из 31" */
  dayOf: string;
  /** "5 дней подряд"; null before a run of two days. */
  streak: string | null;
  /** "Октябрь" */
  month: string;
  /** "Октябрь 2026" */
  monthYear: string;
  /** "5 октября" */
  date: string;
  /** "ОКТ", for the date stamps. */
  monthShort: string;
  /** «Шантарам» or “Shantaram”. */
  quoted: string | null;
  /** The shelf's three figures, label over value, the way Strava sets distance, pace and time. */
  stats: { label: string; value: string; unit: string }[];
  slip: { title: string; reader: string; book: string; days: string; done: string; min: string };
  /** The line on Барыс's plate: "34 минуты" and "5 дней подряд". */
  plate: { big: string; small: string | null };
  site: string;
};

export type StickerData = {
  minutes: number;
  /** The day the sticker is about, and the round's days up to the end of the month. */
  day: string;
  days: { date: string; minutes: number }[];
  name: string;
  barysStage: BarysStage;
  words: StickerWords;
};
