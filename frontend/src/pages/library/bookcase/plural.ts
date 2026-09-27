import type { Locale } from '@/shared/lib';

/** Russian counts take one of three forms; Kazakh never changes, English has two. */
export function plural(locale: Locale, n: number, forms: { one: string; few: string; many: string }): string {
  if (locale === 'ru') {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return forms.one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms.few;
    return forms.many;
  }
  if (locale === 'en') return n === 1 ? forms.one : forms.many;
  return forms.many;
}

/** "58 книг", "1 book", "12 кітап". */
export function bookCount(locale: Locale, n: number, t: (key: string) => string): string {
  return `${n} ${plural(locale, n, { one: t('shelf.book.one'), few: t('shelf.book.few'), many: t('shelf.book.many') })}`;
}
