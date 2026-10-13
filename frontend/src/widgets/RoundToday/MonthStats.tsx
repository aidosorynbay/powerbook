import { useMemo, useState } from 'react';
import { useI18n } from '@/shared/lib';
import type { CalendarDay } from '@/shared/lib';
import styles from './RoundToday.module.css';

/**
 * «Мой месяц», the second page of the card: where the circle's minutes went
 * (a donut by book, the only honest pie: its parts add up to the month),
 * the days as bars with the 30-minute line and real dates under them, and
 * four numbers. Everything is counted from the calendar's own days, so it
 * agrees with the calendar to the minute.
 */

const COLORS = ['var(--color-accent-primary)', '#f5b14c', '#7c8a9e', '#4fb3a9', '#b98ad6'];
const OTHER = 'var(--color-text-muted)';
const GOAL = 30;

export function MonthStats({
  days,
  todayStr,
  todayMinutes,
  monthLabel,
  dayOfRound,
  roundDays,
  place,
  onPlace,
}: {
  days: CalendarDay[];
  todayStr: string;
  /** Today as the dial shows it right now, saved or not. */
  todayMinutes: number;
  monthLabel: string;
  dayOfRound: number;
  roundDays: number;
  place: { rank: number; of: number } | null;
  onPlace: () => void;
}) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string | null>(null);
  const [bar, setBar] = useState<string | null>(null);

  const s = useMemo(() => {
    const inRound = days.filter((d) => d.in_round !== false).sort((a, b) => a.date.localeCompare(b.date));
    const mins = (d: CalendarDay) => (d.date === todayStr ? todayMinutes : d.minutes);
    const upto = inRound.filter((d) => d.date <= todayStr);
    const total = upto.reduce((a, d) => a + mins(d), 0);
    const past = upto.filter((d) => d.date < todayStr);
    const counted = upto.filter((d) => mins(d) >= GOAL).length;
    let streak = 0;
    for (let i = upto.length - 1; i >= 0; i--) {
      const d = upto[i];
      if (mins(d) >= GOAL) streak++;
      else if (d.date === todayStr) continue;
      else break;
    }
    let best = 0;
    let run = 0;
    for (const d of upto) {
      run = mins(d) >= GOAL ? run + 1 : 0;
      best = Math.max(best, run);
    }
    const top = upto.reduce<CalendarDay | null>((b, d) => (!b || mins(d) > mins(b) ? d : b), null);
    // minutes by book: a day's books when it names them, else the day goes to «без названия»
    const per = new Map<string, number>();
    for (const d of upto) {
      const m = mins(d);
      if (!m) continue;
      const named = (d.books ?? []).filter((b) => b.minutes > 0);
      if (d.date !== todayStr && named.length) named.forEach((b) => per.set(b.title, (per.get(b.title) ?? 0) + b.minutes));
      else if (d.date !== todayStr && (d.books ?? []).length === 1) per.set(d.books![0].title, (per.get(d.books![0].title) ?? 0) + m);
      else per.set('', (per.get('') ?? 0) + m);
    }
    const sorted = [...per.entries()].sort((a, b) => b[1] - a[1]);
    const head = sorted.filter(([k]) => k).slice(0, 4);
    const restSum = total - head.reduce((a, [, m]) => a + m, 0);
    const segs = head.map(([k, m], i) => ({ key: k, title: k, minutes: m, color: COLORS[i] }));
    if (restSum > 0) segs.push({ key: '·other', title: head.length ? t('stats.otherBooks') : t('stats.noTitle'), minutes: restSum, color: OTHER });
    const avg = past.length ? Math.round(past.reduce((a, d) => a + d.minutes, 0) / past.length) : 0;
    return { inRound, mins, total, past, counted, streak, best, top, segs, avg };
  }, [days, todayStr, todayMinutes, t]);

  const fmtH = (m: number) => (m >= 60 ? t('stats.hm', { h: Math.floor(m / 60), m: m % 60 }) : t('stats.m', { m }));
  const R = 46;
  const C2 = 2 * Math.PI * R;
  let acc = 0;
  const pickedSeg = s.segs.find((x) => x.key === picked) ?? null;
  const max = Math.max(60, ...s.inRound.map((d) => (d.date <= todayStr ? s.mins(d) : 0)));
  const n = s.inRound.length || 1;
  const dayNum = (date: string) => Number(date.slice(8, 10));
  const barDay = bar ? s.inRound.find((d) => d.date === bar) : null;
  const barText = barDay
    ? barDay.date > todayStr
      ? t('stats.barAhead', { d: dayNum(barDay.date) })
      : t('stats.barDay', { d: dayNum(barDay.date), m: s.mins(barDay) }) +
        ((barDay.books ?? []).length ? ` · ${(barDay.books ?? []).map((b) => b.title).join(', ')}` : '')
    : t('stats.tapDay');
  const axisAt = [0, 7, 14, 21, 28].filter((i) => i < n);

  return (
    <div className={`${styles.pane} ${styles.stats}`}>
      <div className={styles.statsHead}>
        <b>{t('stats.myMonth', { month: monthLabel })}</b>
        <span>{t('stats.dayOf', { n: dayOfRound, total: roundDays })}</span>
      </div>

      <div className={styles.donutRow}>
        <div className={styles.donut}>
          <svg viewBox="0 0 120 120" role="img" aria-label={t('stats.byBooks')}>
            <circle cx="60" cy="60" r={R} fill="none" stroke="var(--color-bg-secondary)" strokeWidth="16" />
            {s.total > 0 &&
              s.segs.map((x) => {
                const len = (x.minutes / s.total) * C2;
                const el = (
                  <circle
                    key={x.key}
                    cx="60"
                    cy="60"
                    r={R}
                    fill="none"
                    stroke={x.color}
                    strokeWidth={picked === x.key ? 20 : 16}
                    strokeDasharray={`${Math.max(0, len - (s.segs.length > 1 ? 2.5 : 0))} ${C2}`}
                    strokeDashoffset={-acc}
                    transform="rotate(-90 60 60)"
                    opacity={!picked || picked === x.key ? 1 : 0.3}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setPicked(picked === x.key ? null : x.key)}
                  />
                );
                acc += len;
                return el;
              })}
          </svg>
          <div className={styles.donutC}>
            <b>{fmtH(pickedSeg ? pickedSeg.minutes : s.total)}</b>
            <span>{pickedSeg ? pickedSeg.title : t('stats.forCircle')}</span>
          </div>
        </div>
        {s.segs.length ? (
          <ul className={styles.books}>
            {s.segs.map((x) => (
              <li key={x.key} aria-current={picked === x.key} onClick={() => setPicked(picked === x.key ? null : x.key)}>
                <i style={{ background: x.color }} />
                <span className={styles.bt}>{x.title}</span>
                <span className={styles.bp}>{Math.round((x.minutes / s.total) * 100)}%</span>
                <span className={styles.bm}>{fmtH(x.minutes)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.noBooks}>{t('stats.empty')}</p>
        )}
      </div>

      <div>
        <div className={styles.barsTop}>
          <span>{t('stats.perDay')}</span>
          <span>{barText}</span>
        </div>
        <div className={styles.bars} style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          <div className={styles.goalLine} style={{ bottom: `${(GOAL / max) * 100}%` }}>
            <span>30</span>
          </div>
          {s.inRound.map((d) => {
            const future = d.date > todayStr;
            const m = future ? 0 : s.mins(d);
            const isToday = d.date === todayStr;
            const cls = future ? '' : m >= GOAL ? styles.bG : isToday ? (m >= 2 ? styles.bY : '') : m >= 2 ? styles.bY : styles.bR;
            return (
              <button
                key={d.date}
                type="button"
                aria-label={`${dayNum(d.date)}: ${m}`}
                className={`${cls} ${isToday ? styles.bNow : ''} ${bar === d.date ? styles.bSel : ''}`}
                style={{ height: future ? 2 : `${Math.max(m ? 4 : 2, (m / max) * 100)}%` }}
                onClick={() => setBar(bar === d.date ? null : d.date)}
              />
            );
          })}
        </div>
        <div className={styles.axis} style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          {axisAt.map((i, k) => (
            <span key={i} style={{ gridColumn: `${i + 1} / span ${k === axisAt.length - 1 ? Math.min(4, n - i) : 1}` }}>
              {dayNum(s.inRound[i].date)}
              {k === axisAt.length - 1 ? ` ${monthLabel.slice(0, 3).toLowerCase()}` : ''}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.tiles}>
        <div>
          <b>{t('stats.countedOf', { n: s.counted, of: s.past.length + (todayMinutes >= GOAL ? 1 : 0) })}</b>
          <span>{t('stats.counted')}</span>
        </div>
        <div>
          <b>{s.streak}</b>
          <span>{t('stats.streak', { best: s.best })}</span>
        </div>
        <div>
          <b>{s.avg}</b>
          <span>{t('stats.avg')}</span>
        </div>
        {place ? (
          <button type="button" onClick={onPlace}>
            <b>{t('stats.place', { n: place.rank })} ›</b>
            <span>{t('stats.placeOf', { n: place.of })}</span>
          </button>
        ) : (
          <div>
            <b>{s.top ? s.mins(s.top) : 0}</b>
            <span>{t('stats.best')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
