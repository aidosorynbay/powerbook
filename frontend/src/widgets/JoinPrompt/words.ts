import type { Locale } from '@/shared/lib';

type T = (key: string, params?: Record<string, string | number>) => string;

const INTL: Record<Locale, string> = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' };

export function monthOf(t: T, month: number): string {
  return t(`month.${month}`);
}

/** "1 октября", "1 қазан", "1 October" — from the site's own month words
 * (the genitive in Russian), since not every browser knows Kazakh months. */
export function dayOf(iso: string, locale: Locale, t: T): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (locale === 'en') return new Date(y, m - 1, d, 12).toLocaleDateString(INTL.en, { day: 'numeric', month: 'long' });
  return `${d} ${t(`month.gen.${m}`).toLowerCase()}`;
}
