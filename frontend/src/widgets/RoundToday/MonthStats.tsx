import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { track, useI18n } from '@/shared/lib';
import type { AllTimeProfile, CalendarDay, DayBook, MyRoundStats, RosterEntry, RoundReview } from '@/shared/lib';
import { Sheet } from './parts';
import { useBookCover } from './useBookCover';
import styles from './RoundToday.module.css';

/**
 * «Мой месяц» v3 (the founder's pick, 2026-10-14): a card the dial's size. The hero is the days counted; under
 * it this month and the last one as two rows of days cut at the same day, so the comparison is seen, not read;
 * the books as real covers with their time under them; the circle's treasury as a bar with today's slice.
 * Minutes are printed once, on the month's row. Nothing red, no tiles, no averages, no pace, no place; the rest
 * is in the «Подробнее» sheet. The card grows only when there are more books than fit in a row.
 */

const GOAL = 30;
const TOUCHED = 2;

export type MonthStatsProps = {
  days: CalendarDay[];
  todayStr: string;
  /** The last day that scores (the round's last day is for corrections only and stays out of the panel). */
  scoringEnd: number;
  monthLabel: string;
  /** The round's month, 1–12: the row's label. */
  monthNum: number;
  dayOfRound: number;
  roundDays: number;
  joinedDay: string | null;
  /** The reader's last circle, whole, when they read in it. */
  prevDays: CalendarDay[] | null;
  prevMonthNum: number | null;
  /** The treasury line → the readers sheet. */
  onPlace: () => void;
  /** «Какую книгу читаете?» → the day form's book field. */
  onWhichBook: () => void;
  /** Everyone's minutes today and yesterday, from the roster. */
  circleToday: RosterEntry[];
  circleYesterday: RosterEntry[];
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
  /** A computer: the third column; a phone: the page behind the dial. */
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
/** A day on a row: counted, partial, nothing, still ahead, today still open. */
type DayState = 'c' | 'p' | 'z' | 'f' | 't';

/** A book of the circle on the card: its cover, the time under it, then «дочитана 7 окт» or «читаю». */
function CoverCard({ book, sub, done, showTime, onClick }: { book: Book; sub: string; done: boolean; showTime: boolean; onClick: () => void }) {
  const look = useBookCover(book.title);
  const { t } = useI18n();
  const time = book.minutes >= 60 ? (book.minutes % 60 ? t('ms.hm', { h: Math.floor(book.minutes / 60), m: book.minutes % 60 }) : t('ms.h', { h: Math.floor(book.minutes / 60) })) : t('ms.m', { m: book.minutes });
  return (
    <button type="button" className={styles.m3Book} onClick={onClick} aria-label={`${book.title} · ${time}`}>
      <span className={styles.m3Cover} aria-hidden="true">
        {look.cover ? <img src={look.cover} alt="" loading="lazy" /> : <em lang={/[а-яёәіңғүұқөһ]/i.test(book.title) ? 'ru' : 'en'}>{book.title.trim()}</em>}
      </span>
      {showTime && <b>{time}</b>}
      <small className={done ? styles.m3Done : ''}>{sub}</small>
    </button>
  );
}

/** A book in the sheet: a real cover (or its title set plainly), the title, its status, the time on the right. */
function SheetBook({ book, status, done, tag, meta, time }: { book: Book; status: string; done: boolean; tag?: string; meta: string; time: string }) {
  const look = useBookCover(book.title);
  return (
    <div className={styles.s3Book}>
      <span className={styles.s3Cover} aria-hidden="true">
        {/* the title is printed beside it, so a cover-less book shows its first letter only */}
        {look.cover ? <img src={look.cover} alt="" loading="lazy" /> : <em>{book.title.trim().charAt(0).toUpperCase()}</em>}
      </span>
      <span className={styles.s3BookBody}>
        <b>
          {book.title}
          {tag && <em className={styles.s3Tag}>{tag}</em>}
        </b>
        <span className={styles.s3BookTime}>{time}</span>
        <small className={done ? styles.m3Done : ''}>{status}</small>
        <small>{meta}</small>
      </span>
    </div>
  );
}

export function MonthStats(p: MonthStatsProps) {
  const { t, locale } = useI18n();
  const { days, todayStr, dayOfRound, roundDays, joinedDay, prevDays, extra, review, allTime } = p;
  const [open, setOpen] = useState(false);
  // a tap on a row names the day under the finger for a moment
  const [pick, setPick] = useState<{ row: 'cur' | 'prev'; i: number } | null>(null);
  const pickTimer = useRef<number | null>(null);

  // the forms may carry a whole sentence («Вчера читал {n} человек|Вчера читали {n} человека|…»): pick the form, then the number
  const pl = (n: number, key: string) => plural(n, t(key)).replace(/\{n\}/g, String(n));
  const fmtT = (m: number) => (m >= 60 ? (m % 60 ? t('ms.hm', { h: Math.floor(m / 60), m: m % 60 }) : t('ms.h', { h: Math.floor(m / 60) })) : t('ms.m', { m }));
  const fmtH = (m: number) => (m >= 60 ? t('ms.h', { h: Math.round(m / 60) }) : t('ms.m', { m }));
  const fmtDate = (date: string) => {
    const d = dayNum(date);
    const mo = monthNum(date);
    if (locale === 'en') return `${t(`month.${mo}`).slice(0, 3)} ${d}`;
    if (locale === 'kk') return `${d} ${t(`month.${mo}`).toLowerCase()}`;
    return `${d} ${t(`month.gen.${mo}`)}`;
  };
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const monthName = (mo: number) => (locale === 'en' ? t(`month.${mo}`) : t(`month.${mo}`).toLowerCase());

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
    const total = upto.reduce((a, d) => a + mins(d), 0);
    let longest = 0;
    let run = 0;
    for (const d of upto) {
      run = mins(d) >= GOAL ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    // days read, as saved (today only once it is saved): the same days /results averages over
    const readingDays = upto.filter((d) => d.minutes >= TOUCHED);
    // minutes by book: the saved days' books
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
    // the last circle, whole, without its corrections-only last day; both rows are cut at the same day:
    // today only once it is counted, so an unread morning never reads as a day behind
    const prevAll = prevDays ? prevDays.filter((d) => d.in_round !== false).sort((a, b) => a.date.localeCompare(b.date)) : [];
    const prevLast = prevAll.length ? dayNum(prevAll[prevAll.length - 1].date) : 0;
    const prevEnd = prevAll.length >= 28 ? prevLast - 1 : prevLast;
    const prevRow = prevAll.filter((d) => dayNum(d.date) <= prevEnd);
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
      prev: prevRow.length ? sum(prevRow.filter((d) => dayNum(d.date) <= cmpDom)) : null,
    };
    const slotsN = Math.max(inRound.length, prevRow.length, 1);
    return { inRound, mins, start, late, M, N, elapsedIncl, total, longest, readingDays, books, untitled, weekJustFull, todayCounted, cmp, prevRow, slotsN };
  }, [days, todayStr, joinedDay, prevDays, p.scoringEnd]);

  const { M, N } = s;
  // no counted day yet: a sentence, never a bold zero
  const nothingYet = N === 0;
  // a late joiner's first days are their own first days
  const early = s.elapsedIncl <= 3;
  // the last circle's row: the reader read in it, and started this one with everyone
  const prevShown = s.prevRow.length > 0 && !s.late && s.prevRow.some((d) => d.minutes >= TOUCHED);

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
        if (k === 'best_day' && rec.best_day) records.push({ key: 'recordDay', text: t('ms.i.recordDay', { m: rec.best_day.minutes, date: fmtDate(rec.best_day.date) }) });
        if (k === 'minutes') records.push({ key: 'recordMinutes', text: t('ms.i.recordMinutes') });
        if (k === 'goal_days') records.push({ key: 'recordDays', text: t('ms.i.recordDays') });
        if (k === 'books') records.push({ key: 'recordBooks', text: t('ms.i.recordBooks') });
      }
    }
    // a record is news once
    const fresh = records.find((r) => !seen(r.key));
    if (!early) {
      if (fresh) return { ...fresh, record: true };
      if (s.todayCounted && (N === 7 || N === 15 || N === 21)) return { key: `m${N}`, text: t(`ms.i.m${N}`) };
      if (s.weekJustFull) return { key: 'fullWeek', text: t('ms.i.fullWeek') };
    }
    const done = s.books.find((b) => b.finishedOn && (toDate(todayStr).getTime() - toDate(b.finishedOn).getTime()) / 86_400_000 <= 1);
    if (done) return { key: 'bookDone', text: t('ms.i.bookDone', { title: done.title, n: done.days, days: pl(done.days, 'ms.plural.days'), t: fmtT(done.minutes) }) };
    const others = p.circleToday.filter((e) => e.user_id !== p.userId && e.minutes >= TOUCHED).length;
    const meToday = (p.circleToday.find((e) => e.user_id === p.userId)?.minutes ?? 0) >= TOUCHED;
    if (others >= 1) return { key: 'circleToday', text: pl(others, meToday ? 'ms.circleWithYou' : 'ms.circleToday') };
    const yesterday = p.circleYesterday.filter((e) => e.user_id !== p.userId && e.minutes >= TOUCHED).length;
    if (yesterday >= 1) return { key: 'circleYesterday', text: pl(yesterday, 'ms.circleYesterday') };
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [early, extra, s, N, todayStr, p.circleToday, p.circleYesterday, p.userId, p.roundId, locale]);

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

  // the caption's timer dies with the panel
  useEffect(() => () => {
    if (pickTimer.current) window.clearTimeout(pickTimer.current);
  }, []);

  const openSheet = (from: string) => {
    setOpen(true);
    track('stats_detail_open', { from });
  };

  // ---- the rows ----
  const dotState = (d: CalendarDay, cur: boolean): DayState => {
    const m = d.minutes;
    if (cur) {
      if (d.date > todayStr || d.date < s.start) return 'f';
      if (m >= GOAL) return 'c';
      if (d.date === todayStr) return 't';
    } else if (m >= GOAL) return 'c';
    return m >= TOUCHED ? 'p' : 'z';
  };
  const dotClass: Record<DayState, string> = { c: styles.d3c, p: styles.d3p, z: styles.d3z, f: styles.d3f, t: styles.d3t };
  const tap = (row: 'cur' | 'prev', len: number) => (e: ReactMouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left) / Math.max(1, r.width)) * s.slotsN);
    if (i < 0 || i >= len) return;
    setPick((cur) => (cur && cur.row === row && cur.i === i ? null : { row, i }));
    if (pickTimer.current) window.clearTimeout(pickTimer.current);
    pickTimer.current = window.setTimeout(() => setPick(null), 3000);
    track('stats_day_tap', { row });
  };
  const caption = (row: 'cur' | 'prev', i: number) => {
    const d = row === 'cur' ? s.inRound[i] : s.prevRow[i];
    if (!d) return '';
    if (row === 'cur' && d.date > todayStr) return t('ms.barAhead', { date: fmtDate(d.date) });
    if (row === 'cur' && d.date === todayStr) return t('ms.barToday', { m: d.minutes });
    if (d.minutes < TOUCHED) return t('ms.barNone', { date: fmtDate(d.date) });
    const titles = (d.books ?? []).filter((b) => b.minutes > 0).map((b) => b.title);
    return t('ms.barDay', { date: fmtDate(d.date), m: d.minutes }) + (titles.length ? ` · ${titles.join(', ')}` : '') + (d.book_finished ? ` · ${t('ms.finished')}` : '');
  };
  const dom = s.cmp.dom;
  const lastDay = s.inRound.length ? dayNum(s.inRound[s.inRound.length - 1].date) : roundDays;
  const showDom = dom >= 2 && dom <= s.slotsN - 2;
  // the last circle's figures: up to the same day while the cut is inside the month, else the whole circle
  const prevFig = showDom ? s.cmp.prev : s.prevRow.length ? { minutes: s.prevRow.reduce((a, d) => a + d.minutes, 0), goalDays: s.prevRow.filter((d) => d.minutes >= GOAL).length } : null;
  const cols: CSSProperties = { gridTemplateColumns: `repeat(${s.slotsN}, 1fr)` };

  // ---- the treasury: the whole bar is everyone's minutes this round, the bright end is what today added ----
  const sumMin = (rows: RosterEntry[]) => rows.reduce((a, e) => a + e.minutes, 0);
  const todayAll = sumMin(p.circleToday);
  const yesterdayAll = sumMin(p.circleYesterday);
  const slice = todayAll >= TOUCHED ? { minutes: todayAll, today: true } : yesterdayAll >= TOUCHED ? { minutes: yesterdayAll, today: false } : null;
  const share = slice && p.circleMinutes > 0 ? Math.max(2.5, Math.min(100, (slice.minutes / p.circleMinutes) * 100)) : 0;
  const treasuryText = p.circleMinutes >= 60 ? t('ms.h', { h: Math.floor(p.circleMinutes / 60) }) : fmtT(p.circleMinutes);


  return (
    <div className={`${styles.pane} ${styles.ms3}`}>
      <div className={styles.msHead}>
        <b>{t('stats.myMonth', { month: p.monthLabel })}</b>
        <button type="button" className={styles.m3More} onClick={() => openSheet('header')}>
          {t('ms.sheet.title')}
          {'\u00a0›'}
        </button>
      </div>

      {/* the hero: days counted */}
      {nothingYet ? (
        <div className={styles.m3HeroText}>
          <b>{s.elapsedIncl <= 1 ? t('ms.firstDay') : t('ms.noDaysYetPlain')}</b>
          <span>{t('ms.firstDayRule')}</span>
        </div>
      ) : (
        <div className={styles.m3Hero}>
          <b className={styles.m3Num}>{N}</b>
          <span className={styles.m3Unit}>{pl(N, 'ms.plural.days')}</span>
          <span className={styles.m3Of}>
            {N === 1 && M === 1 ? t('ms.firstCounted') : t('ms.ofDays', { m: M })}
            <span className={styles.m3Rule}> · {t('ms.ruleShort')}</span>
          </span>
        </div>
      )}

      {/* this month and the last one as rows of days, cut at the same day */}
      <div className={styles.m3Rows}>
        <div className={styles.m3Row} onClick={tap('cur', s.inRound.length)} role="presentation">
          <div className={styles.m3RowHead}>
            <b>{t(`month.${p.monthNum}`)}</b>
            <span className={pick?.row === 'cur' ? styles.m3Cap : ''}>
              {pick?.row === 'cur' ? (
                caption('cur', pick.i)
              ) : (
                <>
                  {N > 0 && (
                    <b>
                      {N} {pl(N, 'ms.plural.days')}
                    </b>
                  )}
                  {s.total > 0 && (N > 0 ? ` · ${fmtT(s.total)}` : fmtT(s.total))}
                </>
              )}
            </span>
          </div>
          <div className={styles.m3Dots} style={cols}>
            {s.inRound.map((d, i) => (
              <i key={d.date} className={`${dotClass[dotState(d, true)]} ${pick?.row === 'cur' && pick.i === i ? styles.m3Sel : ''}`} />
            ))}
          </div>
        </div>
        {prevShown && prevFig ? (
          <div className={styles.m3Row} onClick={tap('prev', s.prevRow.length)} role="presentation">
            <div className={styles.m3RowHead}>
              <b>{p.prevMonthNum ? t(`month.${p.prevMonthNum}`) : t('ms.lastCircle')}</b>
              <span className={pick?.row === 'prev' ? styles.m3Cap : ''}>
                {pick?.row === 'prev' ? (
                  caption('prev', pick.i)
                ) : (
                  <>
                    {showDom && `${t('ms.toDay', { d: dom })} `}
                    {prevFig.goalDays > 0 ? (
                      <>
                        {prevFig.goalDays} {pl(prevFig.goalDays, 'ms.plural.days')}
                        <span className={styles.m3PrevMin}> · {fmtT(prevFig.minutes)}</span>
                      </>
                    ) : (
                      fmtT(prevFig.minutes)
                    )}
                  </>
                )}
              </span>
            </div>
            <div className={styles.m3Dots} style={cols}>
              {s.prevRow.map((d, i) => (
                <i key={d.date} className={`${dotClass[dotState(d, false)]} ${showDom && i >= dom ? styles.m3Dim : ''} ${pick?.row === 'prev' && pick.i === i ? styles.m3Sel : ''}`} />
              ))}
            </div>
          </div>
        ) : null}
        <div className={styles.m3Axis} style={cols}>
          <span>1</span>
          {showDom && prevShown && <span style={{ gridColumn: dom }}>{dom}</span>}
          <span style={{ gridColumn: s.inRound.length || s.slotsN }}>{lastDay}</span>
        </div>
        {/* a first circle: the line under the axis says when the second row comes */}
        {!(prevShown && prevFig) && !s.late && allTime && allTime.rounds_participated <= 1 && (
          <span className={styles.m3Muted}>{t('ms.firstCircle', { when: cap(t(`month.in.${(p.monthNum % 12) + 1}`)), whenLow: t(`month.in.${(p.monthNum % 12) + 1}`), monthWith: t(`month.with.${p.monthNum}`) })}</span>
        )}
        {showDom && prevShown && <i className={styles.m3Line} style={{ left: `calc((100% + 2px) * ${dom} / ${s.slotsN} - 1px)` }} aria-hidden="true" />}
      </div>
      {dayOfRound <= 2 && review?.previous && (
        <Link to="/results" className={`${styles.msLink} ${styles.m3Recap}`} onClick={() => track('recap_open', { from: 'stats' })}>
          {t('ms.recap', { month: monthName(review.previous.month) })}
        </Link>
      )}

      {/* the books, as covers */}
      {s.books.length ? (
        <div className={styles.m3Books}>
          {s.books.map((b) => (
            // one book with all the month's minutes: its time is the month's row already, the cover keeps only its status
            <CoverCard key={b.title} book={b} done={b.finished} showTime={!(s.books.length === 1 && b.minutes === s.total)} sub={b.finished ? t('ms.finished') : t('ms.reading')} onClick={() => openSheet('book')} />
          ))}
        </div>
      ) : s.total > 0 ? (
        <button type="button" className={`${styles.msLink} ${styles.msAsk}`} onClick={p.onWhichBook}>
          {t('ms.whichBook')}
        </button>
      ) : null}

      {/* the circle: one sentence, the treasury as a bar, today's slice bright */}
      <div className={styles.m3Tre}>
        {insight && (
          <p className={styles.m3Sent}>
            {'record' in insight && <em className={styles.msChip}>{t('ms.recordChip')}</em>}
            {insight.text}
          </p>
        )}
        {p.circleMinutes > 0 && (
          <>
            <div className={styles.m3Bar} aria-hidden="true">
              {slice && <i style={{ width: `${share}%` }} />}
            </div>
            <div className={styles.m3TreLine}>
              <button
                type="button"
                className={styles.m3TreBtn}
                onClick={() => {
                  p.onPlace();
                  track('stats_tile_tap', { tile: 'treasury' });
                }}
              >
                {t('ms.treasury')} · <b>{treasuryText}</b>{'\u00a0›'}
              </button>
              {slice && <em>{slice.today ? t('ms.plusToday', { t: fmtH(slice.minutes) }) : t('ms.plusYesterday', { t: fmtH(slice.minutes) })}</em>}
            </div>
          </>
        )}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} label={t('ms.sheet.title')}>
        {/* built only while open: nothing of the sheet is computed under the card */}
        {open && (<>
        <div className={styles.s3Head}>
          <div>
            <h3 className={styles.sheetTitle}>{t('stats.myMonth', { month: p.monthLabel })}</h3>
            <p className={styles.sheetLead}>{s.late ? t('ms.dayFrom', { n: s.elapsedIncl, date: fmtDate(s.start) }) : t('stats.dayOf', { n: dayOfRound, total: roundDays })}</p>
          </div>
          <button type="button" className={styles.s3Close} onClick={() => setOpen(false)} aria-label={t('today.close')}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* the books of the circle */}
        {s.books.length > 0 && (
          <section className={styles.s3Sec}>
            <h4>{t('ms.sheet.books', { when: t(`month.in.${p.monthNum}`) })}</h4>
            <div className={styles.s3Panel}>
              {s.books.map((b, i) => {
                const all = Object.entries(p.bookTotals).find(([k]) => norm(k) === norm(b.title))?.[1] ?? 0;
                const pct = s.total ? Math.round((b.minutes / s.total) * 100) : 0;
                const meta = `${t('ms.daysOn', { n: b.days, days: pl(b.days, 'ms.plural.days') })}${s.books.length > 1 ? ` · ${t('ms.pctOfCircle', { p: pct })}` : ''}${all > b.minutes ? ` · ${t('ms.onBook', { t: fmtT(all) })}` : ''}`;
                const status = b.finished ? (b.finishedOn ? t('ms.doneOn', { date: fmtDate(b.finishedOn) }) : t('ms.finished')) : t('ms.reading');
                const tag = i === 0 && s.books.length >= 2 && dayOfRound >= 15 ? t('ms.bookOfMonth') : undefined;
                return <SheetBook key={b.title} book={b} status={status} done={b.finished} tag={tag} meta={meta} time={fmtT(b.minutes)} />;
              })}
              {s.untitled > 0 && (
                <p className={styles.s3Untitled}>
                  {t('ms.noTitle')} · {fmtT(s.untitled)}
                </p>
              )}
            </div>
          </section>
        )}

        {/* this month and the last one by the same day, as pairs of bars from zero */}
        {s.cmp.prev && s.cmp.prev.minutes > 0 && s.cmp.own.minutes > 0 && !early && !s.late && dom >= 3 && (() => {
          const prevName = p.prevMonthNum ? monthName(p.prevMonthNum) : t('ms.lastCircle');
          const curName = monthName(p.monthNum);
          const rows = [
            { key: 'min', label: t('ms.sheet.prevMinutes'), prev: s.cmp.prev.minutes, cur: s.cmp.own.minutes, fmt: fmtT },
            { key: 'best', label: t('ms.sheet.prevBest'), prev: s.cmp.prev.best, cur: s.cmp.own.best, fmt: (m: number) => t('ms.m', { m }) },
          ];
          return (
            <section className={styles.s3Sec}>
              <h4>{cap(t('ms.sheet.prev', { prev: prevName, cur: curName, d: dom }))}</h4>
              <div className={styles.s3Panel}>
                {rows.map((r) => {
                  const max = Math.max(r.prev, r.cur, 1);
                  return (
                    <div key={r.key} className={styles.s3Metric}>
                      <b>{r.label}</b>
                      <div className={styles.s3PairRow}>
                        <span>{cap(prevName)}</span>
                        <span className={styles.s3Track}>
                          <i style={{ width: `${Math.max(r.prev ? 3 : 0, (r.prev / max) * 100)}%` }} />
                        </span>
                        <span className={styles.s3Val}>{r.fmt(r.prev)}</span>
                      </div>
                      <div className={styles.s3PairRow}>
                        <span>{cap(curName)}</span>
                        <span className={styles.s3Track}>
                          <i className={styles.s3Cur} style={{ width: `${Math.max(r.cur ? 3 : 0, (r.cur / max) * 100)}%` }} />
                        </span>
                        <span className={styles.s3Val}>{r.fmt(r.cur)}</span>
                      </div>
                    </div>
                  );
                })}
                {review?.previous && (
                  <p className={styles.s3Untitled}>{cap(t('ms.sheet.prevWhole', { month: monthName(review.previous.month), n: review.previous.goal_days, days: pl(review.previous.goal_days, 'ms.plural.days'), t: fmtT(review.previous.minutes) }))}</p>
                )}
              </div>
            </section>
          );
        })()}

        {/* records over every circle: big numbers, a «новый» mark on the ones beaten this circle */}
        {extra && extra.records.rounds >= 2 && (extra.records.best_day || extra.records.longest_streak > 0) && (() => {
          const rec = extra.records;
          const fresh = new Set<string>(rec.new_this_round);
          const thisMonth = `${monthName(p.monthNum)} ${todayStr.slice(0, 4)}`;
          const tiles = [
            rec.best_day && { key: 'best_day', fresh: fresh.has('best_day'), big: t('ms.m', { m: rec.best_day.minutes }), cap: t('ms.sheet.recBestDay'), sub: `${fmtDate(rec.best_day.date)} ${rec.best_day.date.slice(0, 4)}` },
            rec.longest_streak > 0 && { key: 'streak', fresh: fresh.has('streak') && s.longest >= rec.longest_streak, big: `${rec.longest_streak} ${pl(rec.longest_streak, 'ms.plural.days')}`, cap: t('ms.sheet.recStreak'), sub: '' },
            fresh.has('minutes')
              ? { key: 'minutes', fresh: true, big: fmtT(s.total), cap: t('ms.sheet.recRound'), sub: thisMonth }
              : rec.best_round_minutes != null && rec.best_round_month != null && { key: 'minutes', fresh: false, big: fmtT(rec.best_round_minutes), cap: t('ms.sheet.recRound'), sub: `${monthName(rec.best_round_month)} ${rec.best_round_year ?? ''}` },
            fresh.has('goal_days')
              ? { key: 'goal_days', fresh: true, big: `${N} ${pl(N, 'ms.plural.days')}`, cap: t('ms.sheet.recGoal'), sub: thisMonth }
              : rec.best_goal_days != null && rec.best_goal_of != null && { key: 'goal_days', fresh: false, big: t('ms.ofTotal', { n: rec.best_goal_days, of: rec.best_goal_of }), cap: t('ms.sheet.recGoal'), sub: '' },
          ].filter(Boolean) as { key: string; fresh: boolean; big: string; cap: string; sub: string }[];
          return (
            <section className={styles.s3Sec}>
              <h4>{t('ms.sheet.recordsN')}</h4>
              <div className={styles.s3Tiles}>
                {tiles.map((x) => (
                  <div key={x.key} className={styles.s3Tile}>
                    <b>{x.big}</b>
                    <span>
                      {x.cap}
                      {x.fresh && <em className={styles.msChip}>{t('ms.sheet.new')}</em>}
                    </span>
                    {x.sub && <small>{x.sub}</small>}
                  </div>
                ))}
              </div>
              {allTime && (
                <p className={styles.s3Total}>
                  {t('ms.sheet.total')} · <b>{t('ms.h', { h: allTime.total_hours })}</b> · {allTime.rounds_participated} {pl(allTime.rounds_participated, 'ms.plural.rounds')}
                </p>
              )}
            </section>
          );
        })()}

        {/* what the dots on the card mean */}
        <section className={styles.s3Sec}>
          <h4>{t('ms.legend.title')}</h4>
          <ul className={styles.s3Legend}>
            {(['c', 'p', 'z', 'f', 't'] as DayState[]).map((k) => (
              <li key={k}>
                <i className={dotClass[k]} aria-hidden="true" />
                {t(`ms.legend.${k}`)}
              </li>
            ))}
          </ul>
        </section>

        <Link to="/results" className={styles.s3Review} onClick={() => track('stats_review_open', {})}>
          {t('ms.sheet.review')}
        </Link>
        </>)}
      </Sheet>
    </div>
  );
}
