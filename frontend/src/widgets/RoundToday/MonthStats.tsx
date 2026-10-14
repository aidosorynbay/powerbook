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
        {look.cover ? <img src={look.cover} alt="" loading="lazy" /> : <em>{book.title.trim()}</em>}
      </span>
      {showTime && <b>{time}</b>}
      <small className={done ? styles.m3Done : ''}>{sub}</small>
    </button>
  );
}

/** A book in the sheet: its cover, the title, the time, a line of meta. */
function BookRow({ book, tags, meta, right }: { book: Book; tags: string[]; meta?: string; right: string }) {
  const look = useBookCover(book.title);
  return (
    <div className={styles.msBook}>
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
    return { inRound, mins, start, late, M, N, elapsedIncl, total, readingDays, books, untitled, weekJustFull, todayCounted, cmp, prevRow, slotsN };
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

  const bookTags = (b: Book, i: number) => {
    const tags: string[] = [];
    if (i === 0 && s.books.length >= 2 && dayOfRound >= 15) tags.push(t('ms.bookOfMonth'));
    if (b.finished) tags.push(t('ms.finished'));
    return tags;
  };

  return (
    <div className={`${styles.pane} ${styles.ms3}`}>
      <div className={styles.msHead}>
        <b>{t('stats.myMonth', { month: p.monthLabel })}</b>
        <span>{s.late ? t('ms.dayFrom', { n: s.elapsedIncl, date: fmtDate(s.start) }) : t('stats.dayOf', { n: dayOfRound, total: roundDays })}</span>
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
        ) : !s.late && allTime && allTime.rounds_participated <= 1 ? (
          <span className={styles.m3Muted}>{t('ms.firstCircle')}</span>
        ) : null}
        <div className={styles.m3Axis} style={cols}>
          <span>1</span>
          {showDom && prevShown && <span style={{ gridColumn: dom }}>{dom}</span>}
          <span style={{ gridColumn: s.inRound.length || s.slotsN }}>{lastDay}</span>
        </div>
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

        {s.cmp.prev && s.cmp.prev.minutes > 0 && !early && !s.late && dom >= 3 && (
          <section className={styles.msSec}>
            <h4>{t('ms.sheet.prev', { d: dom })}</h4>
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
