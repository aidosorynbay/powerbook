import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { track, useI18n } from '@/shared/lib';
import type { AllTimeProfile, CalendarDay, DayBook, MyRoundStats, RosterEntry, RoundReview } from '@/shared/lib';
import { Sheet } from './parts';
import { useBookCover } from './useBookCover';
import styles from './RoundToday.module.css';

/**
 * «Мой месяц» (the council's spec, 2026-10-13): the reader's own circle, today → month. One hero — the days
 * counted — with the minutes under it, one comparison with their own last circle, the month as bars on the
 * 30-minute line, four plain numbers, the book as a real cover, and one true sentence. No second ring (the dial
 * is the ring), nothing red, no «пропущено», never a bold zero, no motion. Everything is counted from the
 * calendar's own days (so it agrees with the calendar to the minute), the circle's roster, the round review
 * and /rounds/{id}/my-stats.
 */

const GOAL = 30;
const TOUCHED = 2;
const WD_KEYS = ['weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat', 'weekday.sun'];

export type MonthStatsProps = {
  days: CalendarDay[];
  todayStr: string;
  /** The last day that scores (the round's last day is for corrections only and stays out of the panel). */
  scoringEnd: number;
  monthLabel: string;
  dayOfRound: number;
  roundDays: number;
  roundDaysLeft: number;
  joinedDay: string | null;
  /** The reader's last circle, whole, when they read in it. */
  prevDays: CalendarDay[] | null;
  place: { rank: number; of: number } | null;
  onPlace: () => void;
  /** «Какую книгу читаете?» → the day form's book field. */
  onWhichBook: () => void;
  /** Everyone's minutes today, from the roster. */
  circleToday: RosterEntry[];
  /** Everyone's minutes this round, all days summed. */
  circleMinutes: number;
  circleSize: number;
  userId?: string;
  allTime: AllTimeProfile | null;
  review: RoundReview | null;
  extra: MyRoundStats | null;
  /** The reader's minutes on each title so far, every spelling and the reading room counted. */
  bookTotals: Record<string, number>;
  roundId: string;
  /** A computer: the third column shows three books, a phone one. */
  wide: boolean;
  /** The panel is on screen (the stats page of the pager, or the desktop column): only then is a record «seen». */
  active: boolean;
};

function plural(n: number, forms: string): string {
  const f = forms.split('|');
  if (f.length === 1) return f[0];
  if (f.length === 2) return n === 1 ? f[0] : f[1];
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return f[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return f[1];
  return f[2];
}

const dayNum = (date: string) => Number(date.slice(8, 10));
const monthNum = (date: string) => Number(date.slice(5, 7));
const toStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const toDate = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
/** Monday = 0 … Sunday = 6. */
const dow = (s: string) => (toDate(s).getDay() + 6) % 7;
const norm = (x: string) => x.toLowerCase().replace(/[«»"'.,:;!?()]/g, '').replace(/\s+/g, ' ').trim();

type Book = { title: string; minutes: number; days: number; finished: boolean; finishedOn: string | null };

/** One book of the circle: its cover (the reader's own copy first), the title, the time, a bar for its share. */
function BookRow({ book, tags, meta, right, onClick }: { book: Book; tags: string[]; meta?: string; right: string; onClick?: () => void }) {
  const look = useBookCover(book.title);
  const inner = (
    <>
      <span className={styles.msCover} aria-hidden="true">
        {look.cover ? <img src={look.cover} alt="" loading="lazy" /> : <b>{book.title.trim().charAt(0).toUpperCase()}</b>}
      </span>
      <span className={styles.msBookBody}>
        <span className={styles.msBookTop}>
          <span className={styles.msBt}>{book.title}</span>
          <span className={styles.msBr}>{right}</span>
        </span>
        {(meta || tags.length > 0) && (
          <span className={styles.msBm}>
            {meta}
            {tags.map((x, i) => (
              <em key={x}>
                {meta || i > 0 ? ' · ' : ''}
                {x}
              </em>
            ))}
          </span>
        )}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className={styles.msBook} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className={styles.msBook}>{inner}</div>
  );
}

export function MonthStats(p: MonthStatsProps) {
  const { t, locale } = useI18n();
  const { days, todayStr, dayOfRound, roundDays, roundDaysLeft, joinedDay, prevDays, extra, review, allTime } = p;
  const [bar, setBar] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const pl = (n: number, key: string) => plural(n, t(key));
  const fmtT = (m: number) => (m >= 60 ? (m % 60 ? t('ms.hm', { h: Math.floor(m / 60), m: m % 60 }) : t('ms.h', { h: Math.floor(m / 60) })) : t('ms.m', { m }));
  const fmtDate = (date: string) => {
    const d = dayNum(date);
    const mo = monthNum(date);
    if (locale === 'en') return `${t(`month.${mo}`).slice(0, 3)} ${d}`;
    if (locale === 'kk') return `${d} ${t(`month.${mo}`).toLowerCase()}`;
    return `${d} ${t(`month.gen.${mo}`)}`;
  };
  const wdShort = (date: string) => {
    const w = t(WD_KEYS[dow(date)]);
    return locale === 'en' ? w : w.toLowerCase();
  };
  const monthName = (mo: number) => (locale === 'en' ? t(`month.${mo}`) : t(`month.${mo}`).toLowerCase());
  const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

  const s = useMemo(() => {
    // the saved days inside the scoring window; the dial's unsaved minutes never count here
    const inRound = days.filter((d) => d.in_round !== false && dayNum(d.date) <= p.scoringEnd).sort((a, b) => a.date.localeCompare(b.date));
    const mins = (d: CalendarDay) => d.minutes;
    const first = inRound[0]?.date ?? todayStr;
    // the reader's honest start: the day they joined, or an earlier day they filled in afterwards
    const firstLog = inRound.find((d) => d.minutes >= TOUCHED)?.date;
    const start = joinedDay && joinedDay > first ? (firstLog && firstLog < joinedDay ? firstLog : joinedDay) : first;
    const late = start > first;
    const upto = inRound.filter((d) => d.date <= todayStr);
    const mine = upto.filter((d) => d.date >= start);
    // decided days: every past day, and today once it has its 30 (a day still being read is never «missed»)
    const decided = mine.filter((d) => d.date < todayStr || mins(d) >= GOAL);
    const M = decided.length;
    const N = decided.filter((d) => mins(d) >= GOAL).length;
    const elapsedIncl = mine.length;
    const myDays = elapsedIncl + roundDaysLeft;
    const total = upto.reduce((a, d) => a + mins(d), 0);
    let streak = 0;
    for (let i = upto.length - 1; i >= 0; i--) {
      const d = upto[i];
      if (mins(d) >= GOAL) streak++;
      else if (d.date === todayStr) continue;
      else break;
    }
    let longest = 0;
    let run = 0;
    for (const d of upto) {
      run = mins(d) >= GOAL ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    // days read, as saved (today only once it is saved): the same days /results averages over
    const readingDays = upto.filter((d) => d.minutes >= TOUCHED);
    const avg = readingDays.length ? Math.round(readingDays.reduce((a, d) => a + d.minutes, 0) / readingDays.length) : 0;
    let best: CalendarDay | null = null;
    for (const d of upto) if (mins(d) > 0 && (!best || mins(d) > mins(best))) best = d;
    // minutes by book: the saved days' books; today from the form while it is being edited
    const per = new Map<string, Book>();
    let untitled = 0;
    const add = (title: string, minutes: number, finished: boolean, date: string) => {
      const key = norm(title);
      if (!key) {
        untitled += minutes;
        return;
      }
      const b = per.get(key) ?? { title: title.trim(), minutes: 0, days: 0, finished: false, finishedOn: null };
      b.minutes += minutes;
      if (minutes > 0) b.days += 1;
      if (finished) {
        b.finished = true;
        b.finishedOn = date;
      }
      per.set(key, b);
    };
    for (const d of upto) {
      const books: DayBook[] = d.books ?? [];
      const dayMinutes = d.minutes;
      const named = books.filter((b) => b.title.trim() && (b.minutes > 0 || b.finished));
      const namedSum = named.reduce((a, b) => a + b.minutes, 0);
      named.forEach((b) => add(b.title, Math.min(b.minutes, dayMinutes), b.finished, d.date));
      if (dayMinutes - namedSum > 0) untitled += dayMinutes - namedSum;
    }
    const books = [...per.values()].filter((b) => b.minutes > 0 || b.finished).sort((a, b) => b.minutes - a.minutes);
    // a Monday–Sunday week inside the round, every day counted, closed yesterday or the day before: news
    const inWin = new Map(inRound.map((d) => [d.date, d] as const));
    let weekJustFull = false;
    const firstMon = toDate(start);
    firstMon.setDate(firstMon.getDate() + ((7 - dow(start)) % 7));
    for (let mon = new Date(firstMon); ; mon.setDate(mon.getDate() + 7)) {
      const dates = Array.from({ length: 7 }, (_, i) => {
        const dt = new Date(mon);
        dt.setDate(mon.getDate() + i);
        return toStr(dt);
      });
      if (dates[6] >= todayStr || !dates.every((x) => inWin.has(x))) break;
      const gap = (toDate(todayStr).getTime() - toDate(dates[6]).getTime()) / 86_400_000;
      if (gap <= 2 && dates.every((x) => mins(inWin.get(x)!) >= GOAL)) weekJustFull = true;
    }
    // you against your last circle, both sides cut at the same day: today only once it is counted, so an
    // unread morning never reads as «−1 день · −40 мин»
    const todayCounted = (upto.find((d) => d.date === todayStr)?.minutes ?? 0) >= GOAL;
    const cmpDom = todayCounted ? dayNum(todayStr) : dayNum(todayStr) - 1;
    const sum = (rows: CalendarDay[]) => ({
      minutes: rows.reduce((a, d) => a + d.minutes, 0),
      goalDays: rows.filter((d) => d.minutes >= GOAL).length,
      best: rows.reduce((a, d) => Math.max(a, d.minutes), 0),
    });
    const cmp = {
      dom: cmpDom,
      own: sum(upto.filter((d) => dayNum(d.date) <= cmpDom)),
      prev: prevDays ? sum(prevDays.filter((d) => d.in_round !== false && dayNum(d.date) <= cmpDom)) : null,
    };
    return { inRound, mins, start, late, M, N, elapsedIncl, myDays, total, streak, longest, readingDays, avg, best, books, untitled, weekJustFull, todayCounted, cmp };
  }, [days, todayStr, joinedDay, prevDays, roundDaysLeft, p.scoringEnd]);

  const { M, N } = s;
  // no counted day yet: a sentence, never a bold zero
  const nothingYet = N === 0;
  // a late joiner's first days are their own first days; averages wait for three days of reading
  const early = s.elapsedIncl <= 3;
  const fewData = s.readingDays.length < 3;
  const projected = M >= 4 && N > 0 ? Math.min(s.myDays, Math.round((N / M) * s.myDays)) : 0;
  const bestStreak = Math.max(s.longest, allTime?.longest_streak_days ?? 0, extra?.records.longest_streak ?? 0);
  const isRecordStreak = s.streak >= 3 && s.streak >= bestStreak;
  const treasuryHours = Math.floor(p.circleMinutes / 60);

  // one sentence about the reader, the first that is true: a record, a milestone, a finished book, the circle today
  const insight = useMemo(() => {
    const seen = (k: string) => {
      try {
        return localStorage.getItem(`pb.record.${p.roundId}.${k}`) === '1';
      } catch {
        return false;
      }
    };
    const rec = extra?.records;
    const records: { key: string; text: string }[] = [];
    if (rec && rec.rounds >= 2) {
      for (const k of rec.new_this_round) {
        if (k === 'best_day' && rec.best_day) records.push({ key: 'recordDay', text: t('ms.i.recordDay', { m: rec.best_day.minutes }) });
        if (k === 'minutes') records.push({ key: 'recordMinutes', text: t('ms.i.recordMinutes') });
        if (k === 'goal_days') records.push({ key: 'recordDays', text: t('ms.i.recordDays') });
        if (k === 'books') records.push({ key: 'recordBooks', text: t('ms.i.recordBooks') });
      }
    }
    // a record is news once (the streak's record lives in its tile, never here)
    const fresh = records.find((r) => !seen(r.key));
    if (!early) {
      if (fresh) return { ...fresh, record: true };
      if (s.todayCounted && (N === 7 || N === 15 || N === 21)) return { key: `m${N}`, text: t(`ms.i.m${N}`) };
      if (s.weekJustFull) return { key: 'fullWeek', text: t('ms.i.fullWeek') };
    }
    const done = s.books.find((b) => b.finishedOn && (toDate(todayStr).getTime() - toDate(b.finishedOn).getTime()) / 86_400_000 <= 1);
    if (done) return { key: 'bookDone', text: t('ms.i.bookDone', { title: done.title, n: done.days, days: pl(done.days, 'ms.plural.days'), t: fmtT(done.minutes) }) };
    const others = p.circleToday.filter((e) => e.user_id !== p.userId && e.minutes >= TOUCHED);
    const tm = others.reduce((x, e) => x + e.minutes, 0);
    if (others.length >= 2 && tm >= 60) return { key: 'circleToday', text: t('ms.i.circleToday', { n: others.length, people: pl(others.length, 'ms.plural.people'), t: fmtT(tm) }) };
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [early, extra, s, N, todayStr, p.circleToday, p.userId, p.roundId, locale]);

  const tracked = useRef<string | null>(null);
  useEffect(() => {
    if (!p.active || !insight || tracked.current === insight.key) return;
    tracked.current = insight.key;
    track('stats_insight_shown', { key: insight.key });
    if (!('record' in insight)) return;
    // a record is news once; after that the other sentences get their turn
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(`pb.record.${p.roundId}.${insight.key}`, '1');
      } catch {
        /* no storage */
      }
    }, 4000);
    return () => window.clearTimeout(id);
  }, [insight, p.roundId, p.active]);

  const openSheet = (from: string) => {
    setOpen(true);
    track('stats_detail_open', { from });
  };

  // ---- the lines ----
  const comparison = (() => {
    if (dayOfRound <= 2 && review?.previous) {
      return (
        <Link to="/results" className={`${styles.msLine} ${styles.msLink}`} onClick={() => track('recap_open', { from: 'stats' })}>
          {t('ms.recap', { month: monthName(review.previous.month) })}
        </Link>
      );
    }
    if (nothingYet || early || s.cmp.dom < 3) return null;
    if (s.cmp.prev && !s.late && s.cmp.prev.minutes > 0) {
      const dd = s.cmp.own.goalDays - s.cmp.prev.goalDays;
      const dm = s.cmp.own.minutes - s.cmp.prev.minutes;
      const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');
      const text = t('ms.cmpLine', { d: s.cmp.dom, days: `${signed(dd)} ${pl(Math.abs(dd), 'ms.plural.days')}`, min: dm === 0 ? `0 ${t('ms.minShort')}` : `${sign(dm)}${fmtT(Math.abs(dm))}` });
      return (
        <button type="button" className={`${styles.msLine} ${styles.msLineBtn} ${dd >= 0 && dm >= 0 && dd + dm > 0 ? styles.msCmpUp : ''}`} onClick={() => openSheet('compare')}>
          {text}&nbsp;›
        </button>
      );
    }
    if (!prevDays && allTime && allTime.rounds_participated <= 1) return <span className={`${styles.msLine} ${styles.msMuted}`}>{t('ms.firstCircle')}</span>;
    return null;
  })();

  const pace = (() => {
    if (M < 4 || N === 0 || roundDaysLeft < 1 || s.late) return null;
    if (roundDaysLeft <= 6) return t('ms.paceLeft', { n: roundDaysLeft, days: pl(roundDaysLeft, 'ms.plural.days') });
    if (N === M) return t('ms.paceAll', { total: s.myDays, days: pl(s.myDays, 'ms.plural.days') });
    const prevGoal = review?.previous?.goal_days ?? 0;
    if (prevGoal > projected && prevGoal - projected <= 5) return t('ms.paceAction', { b: prevGoal });
    // a low projection is a verdict, not a help: the line stays quiet
    if (projected < 15 && !(prevGoal > 0 && projected >= prevGoal)) return null;
    return t('ms.pace', { n: projected, total: s.myDays, days: pl(s.myDays, 'ms.plural.ofDays') });
  })();

  const max = Math.min(180, Math.max(60, ...s.inRound.map((d) => (d.date <= todayStr ? s.mins(d) : 0))));
  const n = s.inRound.length || 1;
  const barRow = bar ? s.inRound.find((d) => d.date === bar) : null;
  const barText = barRow
    ? barRow.date > todayStr
      ? t('ms.barAhead', { date: fmtDate(barRow.date) })
      : barRow.date === todayStr
        ? t('ms.barToday', { m: s.mins(barRow) })
        : s.mins(barRow) < TOUCHED
          ? t('ms.barNone', { date: fmtDate(barRow.date) })
          : t('ms.barDay', { date: fmtDate(barRow.date), m: s.mins(barRow) }) +
            ((barRow.books ?? []).filter((b) => b.minutes > 0).length ? ` · ${(barRow.books ?? []).filter((b) => b.minutes > 0).map((b) => b.title).join(', ')}` : '') +
            (barRow.book_finished ? ` · ${t('ms.finished')}` : '') +
            (s.best?.date === barRow.date && s.mins(barRow) >= GOAL ? ` · ${t('ms.barBest')}` : '')
    : t('stats.tapDay');
  const todayIdx = s.inRound.findIndex((d) => d.date === todayStr);
  const axis = s.inRound.length
    ? [
        { i: 0, today: false },
        ...(todayIdx > 1 && todayIdx < n - 2 ? [{ i: todayIdx, today: true }] : []),
        ...(n > 1 ? [{ i: n - 1, today: false }] : []),
      ]
    : [];

  const bookTags = (b: Book, i: number) => {
    const tags: string[] = [];
    if (i === 0 && s.books.length >= 2 && dayOfRound >= 15) tags.push(t('ms.bookOfMonth'));
    if (b.finished) tags.push(t('ms.finished'));
    return tags;
  };
  const shownBooks = p.wide ? 3 : 1;

  // the streak tile: the current run as the number (never a bold zero), its record under it
  const recordSub = bestStreak >= 2 ? t('ms.recordDays', { n: bestStreak, days: pl(bestStreak, 'ms.plural.days') }) : '';
  const streakTile = (
    <div className={styles.msTile}>
      <span>{t('ms.streak')}</span>
      {s.streak >= 1 ? (
        <>
          <b>
            {s.streak} {pl(s.streak, 'ms.plural.days')}
          </b>
          <small>{isRecordStreak ? <em className={styles.msChip}>{t('ms.isRecord')}</em> : recordSub || t('ms.streakFirst')}</small>
        </>
      ) : (
        <>
          <b className={styles.msSoft}>{t('ms.startsToday')}</b>
          {recordSub && <small>{recordSub}</small>}
        </>
      )}
    </div>
  );
  const treasuryTile = (
    <button
      type="button"
      className={styles.msTile}
      onClick={() => {
        p.onPlace();
        track('stats_tile_tap', { tile: 'treasury' });
      }}
    >
      <span>{t('ms.treasury')}</span>
      <b>{treasuryHours >= 1 ? t('ms.h', { h: treasuryHours }) : fmtT(p.circleMinutes)}</b>
      <small>{p.place && N >= 7 ? t('ms.placeOf', { r: p.place.rank, n: p.place.of }) : p.circleSize ? t('ms.readersN', { n: p.circleSize, readers: pl(p.circleSize, 'ms.plural.readers') }) : t('ms.readers')}</small>
    </button>
  );

  return (
    <div className={`${styles.pane} ${styles.ms}`}>
      <div className={styles.msHead}>
        <b>{t('stats.myMonth', { month: p.monthLabel })}</b>
        <span>{s.late ? t('ms.dayFrom', { n: s.elapsedIncl, date: fmtDate(s.start) }) : t('stats.dayOf', { n: dayOfRound, total: roundDays })}</span>
      </div>
      {comparison}

      {/* the hero: days counted */}
      {nothingYet ? (
        <div className={styles.msHeroText}>
          <b>{s.elapsedIncl <= 1 ? t('ms.firstDay') : s.total > 0 ? t('ms.noDaysYet', { t: fmtT(s.total) }) : t('ms.noDaysYetPlain')}</b>
          <span>{t('ms.firstDayRule')}</span>
        </div>
      ) : (
        <div className={styles.msHeroText}>
          <span className={styles.msLabel}>{t('ms.heroLabel')}</span>
          <div className={styles.msNumRow}>
            <b className={styles.msNum}>{N}</b>
            <span className={styles.msOf}>{N === 1 && M === 1 ? t('ms.firstCounted') : t('ms.ofDays', { m: M })}</span>
          </div>
          <span className={styles.msMin}>{t('ms.forCircle', { t: fmtT(s.total) })}</span>
          {pace && <span className={styles.msPace}>{pace}</span>}
        </div>
      )}

      {/* the month as bars */}
      <div>
        <div className={styles.msBarsTop}>
          <span className={styles.msLabel}>{t('ms.perDay')}</span>
          <span className={bar ? '' : styles.msMuted}>{barText}</span>
        </div>
        <div className={styles.msBars} style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          <div className={styles.msGoal} style={{ bottom: `${(GOAL / max) * 100}%` }}>
            <span>{t('ms.goalLabel')}</span>
          </div>
          {s.inRound.map((d) => {
            const future = d.date > todayStr || d.date < s.start;
            const m = future ? 0 : s.mins(d);
            const isToday = d.date === todayStr;
            const cls = future ? styles.bF : m >= GOAL ? styles.bG : m >= TOUCHED ? styles.bY : isToday ? styles.bF : styles.bZ;
            const h = future || m < TOUCHED ? 2 : Math.min(100, Math.max(4, (m / max) * 100));
            return (
              <button
                key={d.date}
                type="button"
                className={`${styles.msSlot} ${bar === d.date ? styles.bSel : ''}`}
                data-mon={dow(d.date) === 0 && d.date !== s.inRound[0].date ? '' : undefined}
                aria-label={`${fmtDate(d.date)}: ${t('ms.m', { m })}`}
                onClick={() => setBar(bar === d.date ? null : d.date)}
              >
                <i className={`${cls} ${isToday ? styles.bNow : ''}`} style={{ height: h <= 4 ? `${h}px` : `${h}%` }} />
                {d.book_finished && !future && <em style={{ bottom: `calc(${Math.min(100, (m / max) * 100)}% + 3px)` }} />}
              </button>
            );
          })}
        </div>
        <div className={styles.msAxis} style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          {axis.map((a) => (
            <span key={a.i} style={{ gridColumn: `${a.i + 1} / span 1` }} data-today={a.today ? '' : undefined} data-last={a.i === n - 1 ? '' : undefined}>
              {dayNum(s.inRound[a.i].date)}
            </span>
          ))}
        </div>
      </div>

      {/* four numbers */}
      {fewData ? (
        <>
          <div className={styles.msTiles}>
            {streakTile}
            {treasuryTile}
          </div>
          {s.readingDays.length > 0 && <p className={styles.msNote}>{t('ms.firstNumbers')}</p>}
        </>
      ) : (
        <div className={styles.msTiles}>
          {streakTile}
          <div className={styles.msTile}>
            <span>{t('ms.avg')}</span>
            <b>{s.avg ? t('ms.m', { m: s.avg }) : '·'}</b>
            <small>{t('ms.avgSub')}</small>
          </div>
          <div className={styles.msTile}>
            <span>{t('ms.bestDay')}</span>
            <b>{s.best ? t('ms.m', { m: s.mins(s.best) }) : '·'}</b>
            <small>{s.best ? (s.best.date === todayStr ? t('ms.today') : `${wdShort(s.best.date)}, ${fmtDate(s.best.date)}`) : ''}</small>
          </div>
          {treasuryTile}
        </div>
      )}

      {/* the book, as a cover */}
      {s.books.length ? (
        <div className={styles.msBooks}>
          <div className={styles.msBarsTop}>
            <span className={styles.msLabel}>{t('ms.books')}</span>
            {s.books.length > shownBooks && (
              <button type="button" className={styles.msLink} onClick={() => openSheet('books')}>
                {t('ms.more', { n: s.books.length - shownBooks })}
              </button>
            )}
          </div>
          {s.books.slice(0, shownBooks).map((b, i) => (
            <BookRow key={b.title} book={b} tags={bookTags(b, i)} right={fmtT(b.minutes)} onClick={() => openSheet('book')} />
          ))}
        </div>
      ) : s.total > 0 ? (
        <button type="button" className={`${styles.msLink} ${styles.msAsk}`} onClick={p.onWhichBook}>
          {t('ms.whichBook')}
        </button>
      ) : null}

      {insight && (
        <p className={styles.msInsight}>
          {'record' in insight && <em className={styles.msChip}>{t('ms.recordChip')}</em>}
          {insight.text}
        </p>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} label={t('ms.sheet.title')}>
        <h3 className={styles.sheetTitle}>{t('stats.myMonth', { month: p.monthLabel })}</h3>
        <p className={styles.sheetLead}>{t('ms.sheet.title')}</p>
        {s.books.length > 0 && (
        <section className={styles.msSec}>
          <h4>{t('ms.sheet.books')}</h4>
        <div className={styles.msBooks}>
          {s.books.map((b, i) => {
            const all = Object.entries(p.bookTotals).find(([k]) => norm(k) === norm(b.title))?.[1] ?? 0;
            const pct = s.total ? Math.round((b.minutes / s.total) * 100) : 0;
            const meta = `${t('ms.daysOn', { n: b.days, days: pl(b.days, 'ms.plural.days') })} · ${t('ms.pctOfCircle', { p: pct })}${all > b.minutes ? ` · ${t('ms.onBook', { t: fmtT(all) })}` : ''}`;
            return <BookRow key={b.title} book={b} tags={bookTags(b, i)} meta={meta} right={fmtT(b.minutes)} />;
          })}
          {s.untitled > 0 && (
            <div className={styles.msRow}>
              <span className={styles.msMuted}>{t('ms.noTitle')}</span>
              <span>{fmtT(s.untitled)}</span>
            </div>
          )}
        </div>
        </section>
        )}

        {extra && extra.records.rounds >= 2 && (extra.records.best_day || extra.records.longest_streak > 0) && (
          <section className={styles.msSec}>
            <h4>{t('ms.sheet.records')}</h4>
            {extra.records.best_day && (
              <div className={styles.msRow}>
                <span>{t('ms.sheet.recBestDay')}</span>
                <span>
                  <b>{t('ms.m', { m: extra.records.best_day.minutes })}</b> · {fmtDate(extra.records.best_day.date)} {extra.records.best_day.date.slice(0, 4)}
                </span>
              </div>
            )}
            {extra.records.longest_streak > 0 && (
              <div className={styles.msRow}>
                <span>{t('ms.sheet.recStreak')}</span>
                <span>
                  <b>
                    {extra.records.longest_streak} {pl(extra.records.longest_streak, 'ms.plural.days')}
                  </b>
                </span>
              </div>
            )}
            {extra.records.best_round_minutes != null && extra.records.best_round_month != null && (
              <div className={styles.msRow}>
                <span>{t('ms.sheet.recRound')}</span>
                <span>
                  <b>{fmtT(extra.records.best_round_minutes)}</b> · {monthName(extra.records.best_round_month)} {extra.records.best_round_year}
                </span>
              </div>
            )}
            {extra.records.best_goal_days != null && extra.records.best_goal_of != null && (
              <div className={styles.msRow}>
                <span>{t('ms.sheet.recGoal')}</span>
                <span>
                  <b>{t('ms.ofTotal', { n: extra.records.best_goal_days, of: extra.records.best_goal_of })}</b>
                </span>
              </div>
            )}
            {allTime && (
              <div className={styles.msRow}>
                <span>{t('ms.sheet.total')}</span>
                <span>
                  <b>{t('ms.sheet.totalLine', { t: t('ms.h', { h: allTime.total_hours }), n: allTime.rounds_participated, rounds: pl(allTime.rounds_participated, 'ms.plural.rounds') })}</b>
                </span>
              </div>
            )}
          </section>
        )}

        {s.cmp.prev && s.cmp.prev.minutes > 0 && !early && !s.late && s.cmp.dom >= 3 && (
          <section className={styles.msSec}>
            <h4>{t('ms.sheet.prev', { d: s.cmp.dom })}</h4>
            <div className={styles.msRow}>
              <span>{t('ms.sheet.prevDays')}</span>
              <span>
                {s.cmp.prev.goalDays} → <b>{s.cmp.own.goalDays}</b>
              </span>
            </div>
            <div className={styles.msRow}>
              <span>{t('ms.sheet.prevMinutes')}</span>
              <span>
                {fmtT(s.cmp.prev.minutes)} → <b>{fmtT(s.cmp.own.minutes)}</b>
              </span>
            </div>
            <div className={styles.msRow}>
              <span>{t('ms.sheet.prevBest')}</span>
              <span>
                {t('ms.m', { m: s.cmp.prev.best })} → <b>{t('ms.m', { m: s.cmp.own.best })}</b>
              </span>
            </div>
            {review?.previous && (
              <p className={styles.msNote}>{t('ms.sheet.prevWhole', { n: review.previous.goal_days, days: pl(review.previous.goal_days, 'ms.plural.days'), t: fmtT(review.previous.minutes) })}</p>
            )}
          </section>
        )}

        <p className={styles.msFoot}>
          <Link to="/results" className={styles.msLink} onClick={() => track('stats_review_open', {})}>
            {t('ms.sheet.review')}
          </Link>
        </p>
      </Sheet>
    </div>
  );
}
