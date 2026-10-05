import type { Locale, MyDayCard } from '@/shared/lib';
import { plural } from '@/pages/library/bookcase/plural';
import { dayOf } from '@/widgets/JoinPrompt';
import type { BarysStage } from '@/widgets/Mascot';
import type { StickerData } from './types';

type T = (key: string, params?: Record<string, string | number>) => string;

const UPPER: Record<Locale, string> = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' };

/** The reader's day, in the words the stickers print. `today` is the reader's own date. */
export function stickerData(card: MyDayCard, t: T, locale: Locale, barysStage: BarysStage, today: string): StickerData {
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
    name: card.display_name,
    barysStage,
    words: {
      unit: card.day === today ? t('sticker.unitToday', { unit: minuteWord }) : minuteWord,
      dayOf: t('dayPage.dayOf', { n: card.day_number, total: card.days.length }),
      streak,
      month,
      monthYear: `${month} ${card.year}`,
      date: dayOf(card.day, locale, t),
      monthShort: month.slice(0, 3).toLocaleUpperCase(UPPER[locale]),
      quoted: title ? (locale === 'en' ? `“${title}”` : `«${title}»`) : null,
      stats: [
        { label: t('sticker.today'), value: String(card.minutes), unit: t('sticker.min') },
        streak
          ? { label: t('sticker.streak'), value: String(card.streak), unit: plural(locale, card.streak, forms('shareDay.day')) }
          : { label: t('sticker.day'), value: String(card.day_number), unit: t('sticker.of', { n: card.days.length }) },
        { label: t('sticker.goalDays'), value: String(card.goal_days), unit: t('sticker.of', { n: sofar }) },
      ],
      slip: {
        title: t('sticker.slip.title'),
        reader: t('sticker.slip.reader'),
        book: t('sticker.slip.book'),
        days: t('sticker.slip.days'),
        done: t('sticker.slip.done').toLocaleUpperCase(UPPER[locale]),
        min: t('sticker.min'),
      },
      plate: { big: `${card.minutes} ${minuteWord}`, small: streak },
      site: 'powerbook.kz',
    },
  };
}
