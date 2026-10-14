import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet, circleOrdinal, getApiBaseUrl, track, trackSectionView, useAuth, useI18n, useWaitlist, type PublicStats } from '@/shared/lib';
import { Button, Container, Icon } from '@/shared/ui';
import { GuestRoom, MotionReel, ReadingRoom } from '@/widgets';
import { plural } from '@/pages/library/bookcase/plural';
import styles from './HomeSections.module.css';

/** Sends section_view once the block has been on screen for 2+ seconds. */
function useSectionView<T extends Element>(section: string) {
  // A callback ref: the block may mount after the data arrives.
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  return useCallback(
    (el: T | null) => {
      stop.current?.();
      stop.current = el ? trackSectionView(el, section) : null;
    },
    [section],
  );
}

/**
 * Russian and Kazakh line breaks (U+00A0): a one- or two-letter word or a number never hangs at a line's end, and no
 * line starts with a dash («30 / минут» split on 7 of the 9 GA4 windows).
 */
function tie(text: string): string {
  const w = text.split(' ');
  let out = w[0];
  for (let i = 1; i < w.length; i++) {
    const prev = w[i - 1];
    out += (/^[«(]?\p{L}{1,2}$/u.test(prev) || /^\d+[+%]?$/.test(prev) || w[i].startsWith('—') ? '\u00a0' : ' ') + w[i];
  }
  return out;
}

/**
 * The Round tab's reveal: a marked block (`styles.rv`, present when the section mounts) rises 30 px — 20 on phones —
 * and fades in over 600 ms on cubic-bezier(.16,1,.3,1) the first time it comes into view; `--i` steps a row 100 ms
 * apart. Reduced motion: everything is simply there.
 */
function useReveal() {
  // set up and torn down by the ref alone (called with null on unmount): an effect's cleanup would also run in the
  // strict-mode rehearsal and leave the observer disconnected, every block hidden
  const io = useRef<IntersectionObserver | null>(null);
  return useCallback((root: HTMLElement | null) => {
    io.current?.disconnect();
    io.current = null;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(`.${styles.rv}`));
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof IntersectionObserver === 'undefined') {
      items.forEach((el) => el.classList.add(styles.rvIn));
      return;
    }
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add(styles.rvIn);
        obs.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    items.forEach((el) => obs.observe(el));
    io.current = obs;
  }, []);
}

/** One ref for a section: its analytics view and its reveal. */
function useScene<T extends HTMLElement>(section: string) {
  const view = useSectionView<T>(section);
  const reveal = useReveal();
  return useCallback((el: T | null) => {
    view(el);
    reveal(el);
  }, [view, reveal]);
}

const stagger = (i: number) => ({ '--i': Math.min(i, 3) }) as CSSProperties;

/** Today's date in the circle's clock (Astana), not the reader's. */
function circleToday(): number {
  try {
    return Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Almaty', day: 'numeric' }).format(new Date()));
  } catch {
    return new Date().getDate();
  }
}

/**
 * Today's day of the round window, or null outside it — counted as the round page counts it: the month's last day is
 * for corrections only and scores nothing, so October is 30 reading days («день 14 из 30»), and on the last day it
 * still says «30 из 30». `left` is the reading days after today.
 */
function roundDay(stats: PublicStats | null): { day: number; len: number; left: number } | null {
  if (!stats?.is_round_active || !stats.round_start_day || !stats.round_end_day) return null;
  const start = stats.round_start_day;
  const scoringEnd = Math.max(start, stats.round_end_day - 1);
  const today = circleToday();
  if (today < start || today > stats.round_end_day) return null;
  return { day: Math.min(today, scoringEnd) - start + 1, len: scoringEnd - start + 1, left: Math.max(0, scoringEnd - today) };
}

/**
 * The one action for whoever is looking: a member goes to the circle, someone
 * outside it gets the open circle or the waiting list. A visitor always goes
 * through /join — there the sign-up also takes the place in the circle.
 */
function useNextStep() {
  const { t, locale } = useI18n();
  const { isAuthenticated } = useAuth();
  const { state: wait, join, joinRound } = useWaitlist();
  const navigate = useNavigate();

  return useMemo(() => {
    // the home's own words: the circle as the Round tab names it («Записаться в ноябрьский круг»), the waiting list
    // without quote marks («Ноябрь» in «» read as a book's title) — and never «записаться» for the list: a place on it is
    // only offered when sign-up opens (waitlist.py)
    const m = wait?.month;
    const title = m ? t(`roundTitle.${m}`) : '';
    const titleIn = locale === 'ru' ? title.toLowerCase() : locale === 'en' ? title.replace(/^The /, 'the ') : title;
    const monthIn = m ? (locale === 'ru' ? t(`month.${m}`).toLowerCase() : t(`month.${m}`)) : '';
    if (wait?.in_current_round || (isAuthenticated && wait?.in_open_round) || (isAuthenticated && !wait)) {
      return { label: t('home.cta.round'), action: 'round', run: () => navigate('/round') };
    }
    if (!wait || wait.phase === 'registration') {
      if (isAuthenticated) {
        return {
          label: t('home.cta.join', { title: titleIn }),
          action: 'join',
          run: async () => navigate((await joinRound()) ? '/join' : '/round'),
        };
      }
      return { label: wait ? t('home.cta.join', { title: titleIn }) : t('hero.joinBtn'), action: 'join', run: () => navigate('/join') };
    }
    if (wait.on_waitlist) return { label: t('wl.heroOnList'), action: 'waitlist', run: () => navigate('/join') };
    return {
      label: t('home.cta.wait', { month: monthIn }),
      action: 'waitlist',
      run: async () => {
        if (isAuthenticated) await join();
        navigate('/join');
      },
    };
  }, [wait, isAuthenticated, t, locale, join, joinRound, navigate]);
}

/** «10 октября»: a date in the reader's language (month in the genitive where the language has one). */
function dayMonth(t: (k: string, p?: Record<string, string | number>) => string, iso: string): { day: number; month: string } {
  return { day: Number(iso.slice(8, 10)), month: t(`month.gen.${Number(iso.slice(5, 7))}`) };
}

/**
 * The circle at a glance, as the old front page had it (the founder's wish): which one, how far in, and the three
 * numbers. The bar's right end says what matters to whoever looks: the days left (a member), until when sign-up runs
 * (days 1–10), or when the next circle starts — never «осталось 17 дней» to someone who can only wait.
 */
function CirclePanel({ stats }: { stats: PublicStats }) {
  const { t, locale } = useI18n();
  const { state: wait } = useWaitlist();
  const day = roundDay(stats);
  if (!stats.is_round_active || !stats.round_month || !day) return null;
  const left = day.left;
  const dayWord = (n: number) => plural(locale, n, { one: t('home.day.one'), few: t('home.day.few'), many: t('home.day.many') });
  const people = stats.current_round_participants;
  const inCircle = !!wait && (wait.in_current_round || wait.in_open_round);
  const lastDay = stats.round_end_day != null && circleToday() >= stats.round_end_day;
  const right = (() => {
    if (wait && !inCircle && wait.phase === 'registration' && wait.open_round) {
      const d = dayMonth(t, wait.open_round.registration_until);
      return t('home.panel.regUntil', { day: d.day, month: d.month });
    }
    if (wait && !inCircle && wait.phase === 'waitlist' && wait.starts_on) {
      const d = dayMonth(t, wait.starts_on);
      return t('home.panel.next', { day: d.day, month: d.month });
    }
    // the month's last day scores nothing — it is for fixing entries (the Round tab's rule)
    if (lastDay) return t('home.panel.lastDay');
    return t('home.panel.left', { days: `${left} ${dayWord(left)}` });
  })();
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        {/* named as the Round tab names it: «Октябрьский круг · 66-й» */}
        <span className={styles.panelTitle}>
          {t(`roundTitle.${stats.round_month}`)}
          {stats.round_number ? <span className={styles.panelNo}>{'\u00a0· '}{circleOrdinal(locale, stats.round_number, false)}</span> : null}
        </span>
        <span className={`${styles.panelBadge} ${stats.round_registration_open ? styles.panelBadgeReg : ''}`}>
          <i aria-hidden="true" />
          {stats.round_registration_open ? t('home.panel.reg') : t('home.panel.on')}
        </span>
      </div>
      <div className={styles.panelBar} role="progressbar" aria-valuemin={1} aria-valuemax={day.len} aria-valuenow={day.day} aria-label={t('home.panel.day', { day: day.day, len: day.len })}>
        <span style={{ width: `${Math.round((day.day / day.len) * 100)}%` }} />
      </div>
      <div className={styles.panelDay}>
        <span>{t('home.panel.day', { day: day.day, len: day.len })}</span>
        <span>{right}</span>
      </div>
      <dl className={styles.panelStats}>
        <div><dt>{t('home.panel.perDay')}</dt><dd>30</dd></div>
        <div><dt>{t('home.panel.days')}</dt><dd>{day.len}</dd></div>
        {/* a label above its number is a fixed word, as on the Round tab («читателей: 61»), never «участник 61» */}
        <div><dt>{t('home.panel.readers')}</dt><dd>{people}</dd></div>
      </dl>
    </div>
  );
}

/**
 * The first screen's words over the community's own picture: the circle's live line, the promise, one plain
 * sentence, and the two actions in the order that fits the day — a member's circle first; on sign-up days the circle
 * first; otherwise reading right now (no sign-up) first and the waiting list second.
 */
export function HomeHero({ stats, calm = false }: { stats: PublicStats | null; calm?: boolean }) {
  const { t, locale } = useI18n();
  const { isAuthenticated, isLoading } = useAuth();
  const { state: wait } = useWaitlist();
  const next = useNextStep();
  const navigate = useNavigate();
  const ref = useSectionView<HTMLElement>('hero');

  const day = roundDay(stats);
  const month = stats?.round_month ? t(`month.${stats.round_month}`) : wait ? t(`month.${wait.month}`) : '';
  const state = (() => {
    if (wait?.in_current_round && day) return t('home.state.member', { month, day: day.day, len: day.len });
    if (wait?.phase === 'registration' && wait.open_round) return t('home.state.reg', { month: t(`month.${wait.open_round.month}`) });
    if (day) return t('home.state.running', { month, day: day.day, len: day.len });
    return t('home.state.off');
  })();

  // The circle's live line (never «0»): who read today, or everything read together.
  // how many have read today, never «из 61»: logged «до сна», a midday count read as «most skipped» (the council)
  const live = stats?.today_logged && stats.today_logged >= 5 && stats.current_round_participants
    ? t('home.live.today', {
      n: stats.today_logged,
      people: plural(locale, stats.today_logged, { one: t('home.people.one'), few: t('home.people.few'), many: t('home.people.many') }),
    })
    : stats?.total_minutes_read
      ? t('home.live.total', { n: new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ru-RU').format(stats.total_minutes_read) })
      : null;

  const inCircle = !!wait && (wait.in_current_round || wait.in_open_round);
  const signUpDays = !!wait && wait.phase === 'registration' && !!wait.open_round && !inCircle;
  const circleFirst = inCircle || signUpDays;

  const read = (
    <Button
      key="read"
      variant={circleFirst ? 'secondary' : 'primary'}
      size="lg"
      icon={circleFirst ? undefined : <Icon name="arrow-right" size="sm" />}
      className={circleFirst ? styles.heroSecondBtn : styles.heroCta}
      onClick={() => {
        track('home_cta', { place: 'hero', action: 'read' });
        navigate('/library/hall');
      }}
    >
      {isAuthenticated ? t('home.cta.room') : (
        <span className={styles.ctaStack}>
          <b>{t('home.cta.read')}</b>
          <small>{t('home.cta.readNote')}</small>
        </span>
      )}
    </Button>
  );
  const circle = (
    <Button
      key="circle"
      variant={circleFirst ? 'primary' : 'secondary'}
      size="lg"
      icon={circleFirst ? <Icon name="arrow-right" size="sm" /> : undefined}
      className={circleFirst ? styles.heroCta : styles.heroSecondBtn}
      onClick={() => {
        track('home_cta', { place: 'hero', action: next.action });
        next.run();
      }}
    >
      {next.label}
    </Button>
  );

  return (
    <div ref={ref} className={`${styles.heroInner} ${calm ? styles.calm : ''}`}>
      {/* until the numbers come, the live line and the card keep their room, so nothing below them jumps (CLS 0.20
          with a slow API) */}
      {live ? (
        <p className={styles.live}>
          <span className={styles.liveDot} aria-hidden="true" />
          {tie(live)}
        </p>
      ) : !stats ? (
        <p className={`${styles.live} ${styles.ghost}`} aria-hidden="true">{'\u00a0'}</p>
      ) : null}
      <h1 className={styles.heroTitle}>{tie(t('home.title'))}</h1>
      {!isAuthenticated && <p className={styles.heroWhat}>{tie(t('home.what'))}</p>}
      {stats && day ? (
        <div className={styles.heroPanel}><CirclePanel stats={stats} /></div>
      ) : !stats ? (
        <div className={`${styles.heroPanel} ${styles.panelGhost}`} aria-hidden="true" />
      ) : (
        <p className={styles.heroState}>{tie(state)}</p>
      )}

      <div className={styles.heroActions} aria-busy={isLoading}>
        {isLoading ? <span className={styles.ctaSkeleton} aria-hidden="true" /> : circleFirst ? [circle, read] : [read, circle]}
        {!isAuthenticated && !isLoading && (
          <Link to="/login" className={styles.heroLogin} onClick={() => track('home_cta', { place: 'hero', action: 'login' })}>
            {t('home.login')}
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * The reading room, once on the page, right under the shared treasury — entered the Round tab's way (the founder,
 * 2026-10-14): as the page scrolls, the hall shows as a framed window, opens to the full screen and draws the camera in,
 * smoothly, its top and foot melting into the page; at the end of the way in one can sit down and start the timer right
 * here — a visitor in the library hall (GuestRoom), a member in their circle's hall or the library's (ReadingRoom, as on
 * /round) — or scroll on, and the hall sinks into the page. Mounted only when the reader comes near: the textures are
 * heavy and most visitors never come this far.
 */
export function RoomSection() {
  const { isAuthenticated, isLoading } = useAuth();
  const { state, ready: settled } = useWaitlist();
  const ref = useSectionView<HTMLDivElement>('room');
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setNear(true);
        io.disconnect();
      }
    }, { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // a member's hall is the one /library/hall would give them: their circle's, or the library's
  const ready = !isLoading && (!isAuthenticated || settled);
  const inCircle = !!state && (state.in_current_round || state.in_open_round);

  return (
    <div ref={ref} className={styles.roomSection}>
      <div ref={box} className={`${styles.roomScroll} ${isAuthenticated ? styles.roomScrollMember : ''}`}>
        {near && ready ? (
          isAuthenticated
            ? <ReadingRoom key={inCircle ? 'round' : 'library'} hall={inCircle ? 'round' : 'library'} layout="scroll" />
            : <GuestRoom layout="scroll" cinematic />
        ) : (
          <div className={styles.roomWait} aria-hidden="true" />
        )}
      </div>
    </div>
  );
}

type PublicBook = { title: string; author: string | null; cover_url: string; minutes: number; readers: number };

/** The shared total: everything read together, this month's part, and the books it went into. */
export function SharedTotal({ stats }: { stats: PublicStats | null }) {
  const { t, locale } = useI18n();
  const ref = useScene<HTMLElement>('treasury');
  const [books, setBooks] = useState<PublicBook[]>([]);
  const [shown, setShown] = useState<number | null>(null);
  const numRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let alive = true;
    apiGet<PublicBook[]>('/stats/public/books').then(({ data }) => {
      if (alive && data) setBooks(data);
    });
    return () => {
      alive = false;
    };
  }, []);

  // The big number counts this circle's minutes up into the total, once, when it comes into view: it starts from what
  // the total was before the circle (never «0»), so only the last digits roll and its width holds.
  const total = stats?.total_minutes_read ?? 0;
  const before = Math.max(0, total - (stats?.is_round_active ? stats.round_minutes ?? 0 : 0));
  useEffect(() => {
    const el = numRef.current;
    if (!el || !total) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined' || before >= total) {
      setShown(total);
      return;
    }
    setShown(before);
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / 1600);
        setShown(Math.round(before + (total - before) * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.5 });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [total, before]);

  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ru-RU');
  const minWord = (n: number) => plural(locale, n, { one: t('home.min.one'), few: t('home.min.few'), many: t('home.min.many') });
  const readerWord = (n: number) => plural(locale, n, { one: t('home.reader.one'), few: t('home.reader.few'), many: t('home.reader.many') });
  const since = stats?.yearly?.[0]?.year ?? 2021;
  const active = stats?.is_round_active && !!stats.round_month && (stats.round_minutes ?? 0) > 0;

  return (
    <section ref={ref} className={styles.total} aria-labelledby="total-title">
      <Container className={styles.totalIn}>
        {/* the Round tab's word for it («Казна круга») and the film's («Общая казна круга»): one name across the product */}
        <h2 id="total-title" className={`${styles.kicker} ${styles.rv}`}>{t('home.treasury.kicker')}</h2>

        {/* the shot: one number, white like the Round dial's 76 */}
        <div className={`${styles.totalNumber} ${styles.rv}`}>
          <span ref={numRef} className={styles.totalValue}>{shown != null ? nf.format(shown) : '\u00a0'}</span>
          <span className={styles.totalUnit}>
            {tie(`${minWord(total)} ${t('home.tr.caption', { year: since })}`)}
          </span>
        </div>
        <p className={`${styles.totalLead} ${styles.rv}`}>{tie(t('home.tr.lead'))}</p>

        {stats && (
          <p className={styles.totalFacts}>
            {active && (
              <>
                {/* the circle's own treasury as the Round tab writes it: whole hours («433 ч») */}
                {t('home.tr.month', {
                  title: t(`roundTitle.${stats.round_month}`),
                  minutes: (stats.round_minutes ?? 0) >= 60
                    ? t('ms.h', { h: nf.format(Math.floor((stats.round_minutes ?? 0) / 60)) }).replace(' ', '\u00a0')
                    : `${stats.round_minutes ?? 0}\u00a0${t('home.room.min')}`,
                })}
                {' · '}
              </>
            )}
            {nf.format(stats.total_participants)}{'\u00a0'}{readerWord(stats.total_participants)}
            {' · '}
            {nf.format(stats.total_rounds)}{'\u00a0'}
            {plural(locale, stats.total_rounds, { one: t('home.round.one'), few: t('home.round.few'), many: t('home.round.many') })}
            {' · '}
            <Link to="/about" className={styles.storyLink} onClick={() => track('home_cta', { place: 'treasury', action: 'about' })}>
              {t('home.tr.story')}{'\u00a0'}›
            </Link>
          </p>
        )}

        {books.length >= 3 && (
          <div className={styles.books}>
            <h3 className={styles.booksTitle}>{t('home.tr.books')}</h3>
            <ul className={styles.bookRow} tabIndex={0} aria-label={t('home.tr.books')}>
              {books.map((b) => (
                <li key={b.title} className={styles.book}>
                  <img
                    className={styles.cover}
                    src={`${getApiBaseUrl()}${b.cover_url}`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <span className={styles.bookTitle}>{b.title}</span>
                  {b.author && <span className={styles.bookAuthor}>{b.author}</span>}
                  {/* as the Round tab's book tiles: the time, then who read it */}
                  <span className={styles.bookMeta}>{nf.format(b.minutes)}{'\u00a0'}{t('home.room.min')}</span>
                  <span className={styles.bookReaders}>{b.readers}{'\u00a0'}{readerWord(b.readers)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Container>
    </section>
  );
}

const GETS = [1, 2, 3, 4];

/** What a month in the circle gives, and the little it asks. */
export function MonthGets() {
  const { t } = useI18n();
  const ref = useScene<HTMLElement>('gets');
  return (
    <section ref={ref} className={styles.gets} aria-labelledby="gets-title">
      <Container>
        <h2 id="gets-title" className={`${styles.h2} ${styles.rv}`}>{tie(t('home.get.title'))}</h2>
        <ul className={styles.getGrid}>
          {GETS.map((n, i) => (
            <li key={n} className={`${styles.get} ${styles.rv}`} style={stagger(i)}>
              <span className={styles.getBig}>{tie(t(`home.get.${n}.b`))}</span>
              <span className={styles.getText}>{tie(t(`home.get.${n}.t`))}</span>
            </li>
          ))}
        </ul>
        <p className={`${styles.need} ${styles.rv}`}>{tie(t('home.need'))}</p>
      </Container>
    </section>
  );
}

const FAQ = [1, 2, 3, 4, 5];

/**
 * The Round tab at work — the dial turned to 90, «+90» in the calendar, the circle's treasury — cut from the circle's
 * own film («Новый «Круг»» v9, real screens in a phone). Russian and Kazakh have it; English keeps the drawn reel.
 * Mounted when the section comes near (the poster is 100 KB), plays only while on screen, a still poster under reduced
 * motion.
 */
const POSTER_AT = 100 / 30;

function CircleFilm() {
  const { t, locale } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  const lang = locale === 'kk' ? 'kk' : 'ru';

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setNear(true);
        io.disconnect();
      }
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!near || !v) return;
    v.muted = true;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof IntersectionObserver === 'undefined') return;
    // the poster is frame 100 (the dial at 90, its caption on): the first play starts there, so the picture never
    // jumps back to an empty dial; the loop then runs from the top
    let first = true;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) {
        v.pause();
        return;
      }
      if (first) {
        first = false;
        try {
          v.currentTime = POSTER_AT;
        } catch {
          // not seekable yet: it starts from the top
        }
        // counted from the first day (GA4 cannot backfill): did the film get a play, in which language
        v.play().then(() => track('home_film', { action: 'play', lang }), () => track('home_film', { action: 'blocked', lang }));
        return;
      }
      v.play().catch(() => {});
    }, { threshold: 0.35 });
    io.observe(v);
    return () => io.disconnect();
  }, [near, lang]);

  return (
    <div ref={box} className={styles.filmBox}>
      {near && (
        <video
          ref={video}
          className={styles.film}
          src={`/home/reel-${lang}.mp4?v=20261014`}
          poster={`/home/reel-${lang}.jpg?v=20261014`}
          muted
          playsInline
          loop
          preload="none"
          aria-label={t('reel.label')}
        />
      )}
    </div>
  );
}

/** How a circle goes: the four steps, the film, and the questions people ask. */
export function HowItWorks() {
  const { t, locale } = useI18n();
  const ref = useScene<HTMLElement>('how');
  const faqRef = useSectionView<HTMLDivElement>('faq');

  return (
    <section ref={ref} id="powerbook" className={styles.how} aria-labelledby="how-title">
      <Container>
        <h2 id="how-title" className={`${styles.h2} ${styles.rv}`}>{t('home.steps')}</h2>
        <div className={styles.howGrid}>
          <div>
            <ol className={styles.steps}>
              {[1, 2, 3, 4].map((n, i) => (
                <li key={n} className={`${styles.step} ${styles.rv}`} style={stagger(i)}>
                  <span className={styles.stepNum}>{n}</span>
                  <div>
                    <h3 className={styles.stepTitle}>{tie(t(`ex.step${n}.t`))}</h3>
                    <p className={styles.stepText}>{tie(t(`ex.step${n}.d`))}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className={`${styles.reel} ${locale === 'en' ? '' : styles.reelFilm}`}>
            {locale === 'en' ? <MotionReel /> : <CircleFilm />}
          </div>
        </div>

        <div ref={faqRef} className={styles.faq}>
          <h2 className={styles.h3}>{t('home.faq')}</h2>
          {FAQ.map((n) => (
            <details
              key={n}
              className={styles.faqItem}
              onToggle={(e) => {
                if ((e.target as HTMLDetailsElement).open) track('home_faq', { q: n });
              }}
            >
              <summary>
                <span>{tie(t(`ex.q${n}`))}</span>
                <span className={styles.faqMark} aria-hidden="true">›</span>
              </summary>
              <p>{tie(t(`ex.a${n}`))}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}

const PERKS = [
  { key: 'room', icon: 'candle', to: '/library/hall' },
  { key: 'calendar', icon: 'calendar', to: '/round' },
  { key: 'shelf', icon: 'book', to: '/library' },
  { key: 'books', icon: 'star', to: '/books' },
  { key: 'ai', icon: 'sparkle', to: '/reading' },
  { key: 'market', icon: 'tag', to: '/market' },
  { key: 'people', icon: 'users', to: '/readers' },
  { key: 'fame', icon: 'medal', to: '/hall-of-fame' },
  { key: 'tg', icon: 'telegram', href: 'https://t.me/+ZSmueLtmT8Y1MDBi' },
] as const;

/** Everything else the platform has: for a member each card opens it, for a visitor it tells what waits. */
export function PlatformPerks() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const ref = useScene<HTMLElement>('perks');
  return (
    <section ref={ref} className={styles.perks} aria-labelledby="perks-title">
      <Container>
        <h2 id="perks-title" className={`${styles.h2} ${styles.rv}`}>{tie(t('ex.perksTitle'))}</h2>
        <div className={styles.perkGrid}>
          {PERKS.map((p) => {
            const body = (
              <>
                <span className={styles.perkIcon} aria-hidden="true"><Icon name={p.icon} size="md" /></span>
                <strong className={styles.perkTitle}>{tie(t(`ex.perk.${p.key}.t`))}</strong>
                <span className={styles.perkText}>{tie(t(`ex.perk.${p.key}.d`))}</span>
              </>
            );
            const onClick = () => track('home_perk', { perk: p.key });
            if ('href' in p) {
              return <a key={p.key} className={styles.perk} href={p.href} target="_blank" rel="noopener noreferrer" onClick={onClick}>{body}</a>;
            }
            return isAuthenticated
              ? <Link key={p.key} className={styles.perk} to={p.to} onClick={onClick}>{body}</Link>
              : <div key={p.key} className={styles.perk}>{body}</div>;
          })}
        </div>
      </Container>
    </section>
  );
}

/** The last word, over the Library's shelves: start now, or take the circle's next step. */
export function HomeFinal() {
  const { t } = useI18n();
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const next = useNextStep();
  const ref = useSectionView<HTMLElement>('final');

  return (
    <section ref={ref} className={styles.final}>
      {/* the Library's own bookcase, darkened and out of focus (the founder, 2026-10-14) */}
      <picture className={styles.finalArt} aria-hidden="true">
        <source media="(max-width: 759px)" type="image/webp" srcSet="/home/shelves-tall.webp" />
        <source media="(max-width: 759px)" srcSet="/home/shelves-tall.jpg" />
        <source type="image/webp" srcSet="/home/shelves-wide.webp" />
        <img src="/home/shelves-wide.jpg" alt="" loading="lazy" decoding="async" />
      </picture>
      <div className={styles.finalShade} aria-hidden="true" />
      <Container>
        <div className={styles.finalInner}>
          <h2 className={styles.finalTitle}>{tie(t('home.final.title'))}</h2>
          <p className={styles.finalSub}>{tie(t('home.final.sub'))}</p>
          {!isLoading && (
            <div className={styles.finalActions}>
              <Button
                variant="primary"
                size="lg"
                className={styles.ctaBig}
                onClick={() => {
                  track('home_cta', { place: 'final', action: 'read' });
                  navigate('/library/hall');
                }}
              >
                {isAuthenticated ? t('home.cta.room') : t('home.cta.read')}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                className={styles.heroSecondBtn}
                onClick={() => {
                  track('home_cta', { place: 'final', action: next.action });
                  next.run();
                }}
              >
                {next.label}
              </Button>
              {!isAuthenticated && (
                <Link to="/login" className={styles.finalLogin} onClick={() => track('home_cta', { place: 'final', action: 'login' })}>
                  {t('home.login')}
                </Link>
              )}
            </div>
          )}
        </div>
      </Container>
    </section>
  );
}
