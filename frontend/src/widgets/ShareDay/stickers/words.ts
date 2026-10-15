import type { Locale, MyDayCard } from '@/shared/lib';
import { plural } from '@/pages/library/bookcase/plural';
import { dayDate, daysAgo } from '../shareText';
import type { StickerData } from './types';

type T = (key: string, params?: Record<string, string | number>) => string;

/** A title is cut after this many letters: two lines at most on any sticker. */
const TITLE_MAX = 28;

const bare = (title: string | null | undefined) => title?.trim().replace(/^[«"“„']+|[»"”']+$/g, '') || null;

/** The reader's day, in the words the stickers print. `today` is the reader's own date. */
export function stickerData(card: MyDayCard, t: T, locale: Locale, today: string): StickerData {
  const forms = (key: string) => ({ one: t(`${key}.one`), few: t(`${key}.few`), many: t(`${key}.many`) });
  const minuteWord = plural(locale, card.minutes, forms('sticker.minute'));
  const title = bare(card.book);
  const short = title && [...title].length > TITLE_MAX ? `${[...title].slice(0, TITLE_MAX - 1).join('').trimEnd()}…` : title;
  // Without a book the unit says what the minutes were; with one, the title does. Either way it says which day,
  // so «34» never reads as the month's total (the council, 2026-10-16).
  const read = title ? '' : 'Read';
  const ago = daysAgo(card.day, today);
  const unit =
    ago === 0
      ? t(`sticker.unitToday${read}`, { unit: minuteWord })
      : ago === 1
        ? t(`sticker.unitYesterday${read}`, { unit: minuteWord })
        : t(`sticker.unitOn${read}`, { unit: minuteWord, date: dayDate(card.day, locale, true) });
  const now = title?.toLocaleLowerCase();

  return {
    minutes: card.minutes,
    day: card.day,
    days: card.days.map((d) => ({ date: d.date, minutes: d.minutes })),
    books: (card.month_books ?? []).map((b) => ({ title: b.title, minutes: b.minutes, now: !!now && bare(b.title)?.toLocaleLowerCase() === now })),
    words: {
      unit,
      quoted: short ? (locale === 'en' ? `“${short}”` : `«${short}»`) : null,
      run: t('sticker.run', { n: card.goal_days, days: plural(locale, card.goal_days, forms('shareDay.day')), month: t(`month.in.${card.month}`) }),
      finished: card.finished_days?.includes(card.day) ? t('sticker.finished') : null,
      month: t(`month.${card.month}`),
      weekdays: t('sticker.weekdays').split(','),
    },
  };
}
