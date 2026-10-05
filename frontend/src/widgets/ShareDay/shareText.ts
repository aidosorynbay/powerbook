import type { DayCard, Locale } from '@/shared/lib';
import { plural } from '@/pages/library/bookcase/plural';

type T = (key: string, params?: Record<string, string | number>) => string;

/** Minutes a day has to reach to count, as on the round page. */
export const GOAL_MINUTES = 30;

/** How a day reads on the round's calendar: the goal reached, some reading, or none. */
export function dayKind(minutes: number): 'goal' | 'some' | 'none' {
  if (minutes >= GOAL_MINUTES) return 'goal';
  // As the round's calendar draws it: a single minute is a missed day.
  if (minutes >= 2) return 'some';
  return 'none';
}

const SQUARE = { goal: '🟧', some: '🟨', none: '⬛' } as const;

/** The round so far in squares, a week to a line, like Wordle's grid:
 * it shows the run of days without saying what was read. */
export function daySquares(card: DayCard): string {
  const cells = card.days.filter((d) => d.date <= card.day).map((d) => SQUARE[dayKind(d.minutes)]);
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7).join(''));
  return rows.join('\n');
}

/** "powerbook.kz/r/madik": short enough to read in a chat, and every messenger makes it a link. */
export function dayLink(username: string): string {
  return `${window.location.host}/r/${encodeURIComponent(username)}`;
}

/**
 * The day as one message:
 *   PowerBook · октябрь, день 5
 *   📖 34 мин · 🔥 5 дней подряд
 *   🟧🟧🟨🟧🟧
 *   powerbook.kz/r/madik
 * Without the link when `link` is null (Telegram puts it on a line of its own).
 */
export function dayShareText(card: DayCard, link: string | null, t: T, locale: Locale): string {
  const monthWord = t(`month.${card.month}`);
  // A month inside a phrase is lower-case in Russian and Kazakh; English keeps its capital.
  const month = locale === 'en' ? monthWord : monthWord.toLowerCase();
  const line = [t('shareDay.textMinutes', { n: card.minutes })];
  if (card.streak >= 2) {
    const days = plural(locale, card.streak, {
      one: t('shareDay.day.one'),
      few: t('shareDay.day.few'),
      many: t('shareDay.day.many'),
    });
    line.push(t('shareDay.textStreak', { n: card.streak, days }));
  }
  return [t('shareDay.textHead', { month, n: card.day_number }), line.join(' · '), daySquares(card), link]
    .filter(Boolean)
    .join('\n');
}
