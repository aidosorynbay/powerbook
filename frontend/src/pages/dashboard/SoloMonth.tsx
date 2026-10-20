import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPut, formatSpent, track, useI18n } from '@/shared/lib';
import { Button } from '@/shared/ui';
import { MinutesDial } from '@/widgets/RoundToday';
import rt from '@/widgets/RoundToday/RoundToday.module.css';
import styles from './DashboardPage.module.css';
import s from './SoloMonth.module.css';

/**
 * A month of one's own for a reader outside the circle (the founder, 2026-10-20): the same dial and calendar as the
 * Round's panel, running alongside the circle. The reading room's minutes land here too, and every day's minutes go
 * to the book on the reader's shelf. No leaderboard: it is only theirs (app/services/solo.py).
 */

type SoloBook = { title: string; minutes: number };
type SoloDay = { date: string; minutes: number; books: SoloBook[]; circle: boolean };
type SoloMonthResponse = {
  year: number;
  month: number;
  today: string;
  editable_from: string;
  today_in_circle: boolean;
  total_minutes: number;
  days_read: number;
  goal_days: number;
  streak: number;
  days: SoloDay[];
  books: SoloBook[];
};

const GOAL = 30;
const norm = (title: string) => title.trim().toLowerCase().replace(/\s+/g, ' ');

export function SoloMonth({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  const [ym, setYm] = useState<{ year: number; month: number } | null>(null);
  const [data, setData] = useState<SoloMonthResponse | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(0);
  const [book, setBook] = useState('');
  const [typing, setTyping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (at?: { year: number; month: number }) => {
    const q = at ? `?year=${at.year}&month=${at.month}` : '';
    const { data: d } = await apiGet<SoloMonthResponse>(`/solo/month${q}`, { requireAuth: true });
    if (d) setData(d);
    return d;
  }, []);

  useEffect(() => {
    void load(ym ?? undefined);
  }, [load, ym]);

  // The reading room writes here too: a sitting finished elsewhere on the page shows up when the tab comes back.
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === 'visible') void load(ym ?? undefined);
    };
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, [load, ym]);

  const day = useMemo(() => {
    if (!data) return null;
    const date = picked ?? data.today;
    return data.days.find((d) => d.date === date) ?? { date, minutes: 0, books: [], circle: false };
  }, [data, picked]);

  // The dial and the book follow the day picked on the calendar.
  useEffect(() => {
    if (!day) return;
    setMinutes(day.minutes);
    setBook(day.books[0]?.title ?? (day.date === data?.today ? data?.books[0]?.title ?? '' : ''));
    setTyping(false);
    setError(null);
  }, [day?.date, day?.minutes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !day) return null;
  // in the circle today: the circle's own panel takes the day
  if (data.today_in_circle && data.year === Number(data.today.slice(0, 4)) && data.month === Number(data.today.slice(5, 7))) return null;

  const isToday = day.date === data.today;
  const editable = !day.circle && day.date <= data.today && day.date >= data.editable_from;
  const others = day.books.filter((b) => norm(b.title) !== norm(book));
  const othersSum = others.reduce((a, b) => a + b.minutes, 0);
  const dirty = minutes !== day.minutes || (book.trim() !== '' && norm(book) !== norm(day.books[0]?.title ?? ''));
  const choices = Array.from(new Map(
    [...data.books, ...day.books].map((b) => [norm(b.title), b.title] as const),
  ).values()).slice(0, 6);
  const onBook = data.books.find((b) => norm(b.title) === norm(book))?.minutes ?? 0;

  const save = async () => {
    if (saving || !editable) return;
    setSaving(true);
    setError(null);
    const title = book.trim();
    const total = Math.max(minutes, othersSum);
    const body = title
      ? { date: day.date, minutes: total, books: [{ title, minutes: Math.max(0, total - othersSum) }, ...others] }
      : { date: day.date, minutes: total };
    const { error: err } = await apiPut<SoloDay>('/solo/day', body, { requireAuth: true });
    setSaving(false);
    if (err) {
      setError(t('solo.error'));
      return;
    }
    track('solo_minutes_logged', { minutes: total, today: isToday });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
    await load(ym ?? undefined);
  };

  // the calendar: Monday first, as the Round's
  const first = new Date(data.year, data.month - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const cells: (SoloDay | null)[] = [...Array(lead).fill(null), ...data.days];
  const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => t(`weekday.${d}`));
  const firstRead = data.days.find((d) => d.minutes > 0)?.date;
  const dayClass = (d: SoloDay) => {
    if (d.date > data.today) return styles.dayFuture;
    if (d.minutes >= GOAL) return styles.dayGreen;
    if (d.minutes >= 2) return styles.dayYellow;
    if (d.date === data.today) return styles.dayOpen;
    // empty days before the first one read this month are not misses: the month only began for them later
    return firstRead && d.date > firstRead ? styles.dayMissed : styles.dayOpen;
  };
  const shift = (by: number) => {
    const m = data.month - 1 + by;
    const next = { year: data.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 + 1 };
    setYm(next);
    setPicked(null);
  };
  const thisMonth = data.today.slice(0, 7) === `${data.year}-${String(data.month).padStart(2, '0')}`;
  const dayTitle = isToday
    ? t('solo.today')
    : `${Number(day.date.slice(8, 10))} ${t(`month.gen.${Number(day.date.slice(5, 7))}`)}`;

  return (
    <>
      <div className={`${styles.section} ${className}`}>
        <div className={s.head}>
          <div className={styles.sectionTitle}>{t('solo.title')}</div>
          <p className={s.lead}>{t('solo.lead')}</p>
        </div>
        <div className={s.dayName}>
          {dayTitle}
          {!isToday && (
            <button type="button" className={s.back} onClick={() => setPicked(null)}>{t('solo.backToToday')}</button>
          )}
        </div>

        {editable ? (
          <>
            <div className={s.books}>
              {choices.map((title) => (
                <button
                  key={title}
                  type="button"
                  className={s.chip}
                  aria-pressed={norm(title) === norm(book)}
                  onClick={() => { setBook(title); setTyping(false); }}
                >
                  {title}
                </button>
              ))}
              {typing || choices.length === 0 ? (
                <input
                  className={s.input}
                  value={book}
                  maxLength={300}
                  placeholder={t('solo.bookAsk')}
                  onChange={(e) => setBook(e.target.value)}
                  autoFocus={typing}
                />
              ) : (
                <button type="button" className={`${s.chip} ${s.chipOther}`} onClick={() => { setBook(''); setTyping(true); }}>
                  + {t('solo.otherBook')}
                </button>
              )}
            </div>
            {others.length > 0 && (
              <p className={s.note}>
                {t('solo.alsoRead', { list: others.map((b) => `${b.title} · ${b.minutes}`).join(', ') })}
              </p>
            )}
            <MinutesDial value={minutes} onChange={setMinutes} />
            {onBook > 0 && <p className={s.note}>{t('bookTime.onBook', { time: formatSpent(onBook, t) })}</p>}
            <div className={rt.save}>
              <Button onClick={save} disabled={saving || !dirty}>
                {saved ? t('solo.saved') : saving ? t('dashboard.saving') : t('dashboard.save')}
              </Button>
            </div>
            {error && <p className={s.error} role="alert">{error}</p>}
            <button
              type="button"
              className={styles.toRoom}
              onClick={() => {
                track('room_door_tap', { from: 'solo' });
                document.querySelector('[data-room-door]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {t('nav2.toRoom')} <span aria-hidden="true">↓</span>
            </button>
          </>
        ) : (
          <p className={s.note}>
            {day.circle ? t('solo.circleDay') : t('solo.closedDay')}
            {day.minutes > 0 && ` · ${day.minutes} ${t('rings.minutesShort')}`}
          </p>
        )}
      </div>

      <div className={`${styles.section} ${className}`}>
        <div className={s.monthRow}>
          <button type="button" className={s.arrow} onClick={() => shift(-1)} aria-label={t('solo.prevMonth')}>‹</button>
          <div className={s.monthName}>{t(`month.${data.month}`)} {data.year}</div>
          <button type="button" className={s.arrow} onClick={() => shift(1)} disabled={thisMonth} aria-label={t('solo.nextMonth')}>›</button>
        </div>
        <div className={styles.calendar}>
          {weekdays.map((w) => <div key={w} className={styles.calendarHeader}>{w}</div>)}
          {cells.map((cell, i) => {
            if (cell === null) return <div key={`e-${i}`} className={`${styles.calendarDay} ${styles.empty}`} />;
            const n = Number(cell.date.slice(8, 10));
            const cls = `${styles.calendarDay} ${dayClass(cell)}`
              + (cell.circle ? ` ${styles.outOfRound}` : '')
              + (cell.date === data.today ? ` ${styles.dayToday}` : '')
              + (cell.date === day.date && !isToday ? ` ${s.picked}` : '');
            const canPick = cell.date <= data.today;
            return (
              <button
                key={cell.date}
                type="button"
                className={cls}
                disabled={!canPick}
                onClick={() => setPicked(cell.date === data.today ? null : cell.date)}
                aria-label={`${n}: ${cell.minutes} ${t('rings.minutesShort')}`}
              >
                <span className={styles.dayNumber}>{n}</span>
                {cell.minutes > 0 && (
                  <span className={styles.dayMinutes}>{cell.minutes}{cell.minutes < 1000 && <span className={styles.dayMinutesUnit}> {t('rings.minutesShort')}</span>}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className={s.stats}>
          <div><b>{formatSpent(data.total_minutes, t)}</b><span>{t('solo.statTotal')}</span></div>
          <div><b>{data.days_read}</b><span>{t('solo.statDays')}</span></div>
          <div><b>{data.goal_days}</b><span>{t('solo.statGoal')}</span></div>
          <div><b>{data.streak}</b><span>{t('solo.statStreak')}</span></div>
        </div>
        <p className={s.note}>{t('solo.joinHint')}</p>
      </div>
    </>
  );
}
