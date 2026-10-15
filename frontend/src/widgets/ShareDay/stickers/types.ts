/** The stickers, in the order the sheet offers them: «Число» first (the founder, 2026-10-16). */
export const STICKERS = ['number', 'month', 'shelf'] as const;
export type StickerKind = (typeof STICKERS)[number];

/** Every word a sticker prints, already in the reader's language. */
export type StickerWords = {
  /** "минуты сегодня", or "минуты чтения сегодня" when no book names what was read; "вчера", or the date, for a day sent later. */
  unit: string;
  /** «Три товарища» or “Three Comrades”; null when the day has no book. */
  quoted: string | null;
  /** "11 дней в октябре": the month's days of 30 minutes and more. */
  run: string;
  /** "Книга дочитана", on the day a book was finished. */
  finished: string | null;
  /** "Октябрь", over the calendar. */
  month: string;
  /** The calendar's column heads, Monday first: "п", "в", "с"… */
  weekdays: string[];
};

export type StickerData = {
  minutes: number;
  /** The day the sticker is about, and the round's days up to the end of the month. */
  day: string;
  days: { date: string; minutes: number }[];
  /** The month's books for the shelf, the order they were started in; `now` is the book of the day. */
  books: { title: string; minutes: number; now: boolean }[];
  words: StickerWords;
};
