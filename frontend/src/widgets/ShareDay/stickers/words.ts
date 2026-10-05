import type { Locale, MyDayCard } from '@/shared/lib';
import { plural } from '@/pages/library/bookcase/plural';
import type { StickerData } from './types';

type T = (key: string, params?: Record<string, string | number>) => string;

/** The reader's day, in the words the stickers print. `today` is the reader's own date. */
export function stickerData(card: MyDayCard, t: T, locale: Locale, today: string): StickerData {
  const forms = (key: string) => ({ one: t(`${key}.one`), few: t(`${key}.few`), many: t(`${key}.many`) });
  const minuteWord = plural(locale, card.minutes, forms('sticker.minute'));
  const streak = card.streak >= 2 ? `${card.streak} ${plural(locale, card.streak, forms('dayPage.streak'))}` : null;
  const month = t(`month.${card.month}`);
  const title = card.book?.trim().replace(/^[«"“„']+|[»"”']+$/g, '') || null;
  const sofar = card.days.filter((d) => d.date <= card.day).length;

  return {
    minutes: card.minutes,
    day: card.day,
    days: card.days.map((d) => ({ date: d.date, minutes: d.minutes })),
    words: {
      unit: card.day === today ? t('sticker.unitToday', { unit: minuteWord }) : minuteWord,
      dayOf: t('dayPage.dayOf', { n: card.day_number, total: card.days.length }),
      streak,
      month,
      weekdays: t('sticker.weekdays').split(','),
      quoted: title ? (locale === 'en' ? `“${title}”` : `«${title}»`) : null,
      stats: [
        { label: t('sticker.today'), value: String(card.minutes), unit: t('sticker.min') },
        streak
          ? { label: t('sticker.streak'), value: String(card.streak), unit: plural(locale, card.streak, forms('shareDay.day')) }
          : { label: t('sticker.day'), value: String(card.day_number), unit: t('sticker.of', { n: card.days.length }) },
        { label: t('sticker.goalDays'), value: String(card.goal_days), unit: t('sticker.of', { n: sofar }) },
      ],
    },
  };
}
