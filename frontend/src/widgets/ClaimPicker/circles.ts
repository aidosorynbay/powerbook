import type { Locale } from '@/shared/lib';
import { plural } from '@/pages/library/bookcase/plural';

/** "12 кругов · 2021–2023" from round labels like "May 2023". */
export function circlesLine(rounds: string[], locale: Locale, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const n = rounds.length;
  const count = plural(locale, n, {
    one: t('claims.circles.one', { n }),
    few: t('claims.circles.few', { n }),
    many: t('claims.circles.many', { n }),
  });
  const years = rounds.map((r) => Number(r.split(' ').pop())).filter((y) => Number.isFinite(y) && y > 2000);
  if (!years.length) return count;
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  return `${count} · ${lo === hi ? lo : `${lo}–${hi}`}`;
}
