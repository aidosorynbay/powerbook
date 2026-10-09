import type { TranslationKey } from './i18n';

/** «6 ч 20 мин»: the time given a book, wherever it is shown (the shelf, «Что читаю», the reading room, the library). */
export function formatSpent(minutes: number, t: (key: TranslationKey) => string): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} ${t('rings.minutesShort')}`;
  return m ? `${h} ${t('rings.hoursShort')} ${m} ${t('rings.minutesShort')}` : `${h} ${t('rings.hoursShort')}`;
}
