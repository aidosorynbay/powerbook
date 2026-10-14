import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet, circleOrdinal, getApiBaseUrl, track, trackSectionView, useAuth, useI18n, useWaitlist, type PublicStats } from '@/shared/lib';
import { Button, Container, Icon } from '@/shared/ui';
import { LiveRoom, MotionReel } from '@/widgets';
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

/** Today's date in the circle's clock (Astana), not the reader's. */
function circleToday(): number {
  try {
    return Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Almaty', day: 'numeric' }).format(new Date()));
  } catch {
    return new Date().getDate();
  }
}

/** Today's day of the round window, or null outside it. */
function roundDay(stats: PublicStats | null): { day: number; len: number } | null {
  if (!stats?.is_round_active || !stats.round_start_day || !stats.round_end_day) return null;
  const len = stats.round_end_day - stats.round_start_day + 1;
  const day = circleToday() - stats.round_start_day + 1;
  return day >= 1 && day <= len ? { day, len } : null;
}

/**
 * The one action for whoever is looking: a member goes to the circle, someone
 * outside it gets the open circle or the waiting list. A visitor always goes
 * through /join — there the sign-up also takes the place in the circle.
 */
function useNextStep() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const { state: wait, join, joinRound } = useWaitlist();
  const navigate = useNavigate();

  return useMemo(() => {
    const month = wait ? t(`month.${wait.month}`) : '';
    if (wait?.in_current_round || (isAuthenticated && wait?.in_open_round) || (isAuthenticated && !wait)) {
      return { label: t('home.cta.round'), action: 'round', run: () => navigate('/round') };
    }
    if (!wait || wait.phase === 'registration') {
      if (isAuthenticated) {
        return {
          label: t('wl.heroJoin', { month }),
          action: 'join',
          run: async () => navigate((await joinRound()) ? '/join' : '/round'),
        };
      }
      return { label: wait ? t('wl.heroJoin', { month }) : t('hero.joinBtn'), action: 'join', run: () => navigate('/join') };
    }
    if (wait.on_waitlist) return { label: t('wl.heroOnList'), action: 'waitlist', run: () => navigate('/join') };
    return {
      label: t('wl.heroWait', { month }),
      action: 'waitlist',
      run: async () => {
        if (isAuthenticated) await join();
        navigate('/join');
      },
    };
  }, [wait, isAuthenticated, t, join, joinRound, navigate]);
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
  const month = t(`month.${stats.round_month}`);
  const left = Math.max(0, day.len - day.day);
  const dayWord = (n: number) => plural(locale, n, { one: t('home.day.one'), few: t('home.day.few'), many: t('home.day.many') });
  const people = stats.current_round_participants;
  const inCircle = !!wait && (wait.in_current_round || wait.in_open_round);
  const right = (() => {
    if (wait && !inCircle && wait.phase === 'registration' && wait.open_round) {
      const d = dayMonth(t, wait.open_round.registration_until);
      return t('home.panel.regUntil', { day: d.day, month: d.month });
    }
    if (wait && !inCircle && wait.phase === 'waitlist' && wait.starts_on) {
      const d = dayMonth(t, wait.starts_on);
      return t('home.panel.next', { day: d.day, month: d.month });
    }
    return t('home.panel.left', { days: `${left} ${dayWord(left)}` });
  })();
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span className={styles.panelTitle}>
          {t('home.panel.title', { month })}
          {stats.round_number ? <span className={styles.panelNo}> · {circleOrdinal(locale, stats.round_number, false)}</span> : null}
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
        <div><dd>30</dd><dt>{t('home.panel.perDay')}</dt></div>
        <div><dd>{day.len}</dd><dt>{t('home.panel.days')}</dt></div>
        <div><dd>{people}</dd><dt>{plural(locale, people, { one: t('home.part.one'), few: t('home.part.few'), many: t('home.part.many') })}</dt></div>
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
  const live = stats?.today_logged && stats.today_logged >= 5 && stats.current_round_participants
    ? t('home.live.today', { n: stats.today_logged, total: stats.current_round_participants })
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
      {live && (
        <p className={styles.live}>
          <span className={styles.liveDot} aria-hidden="true" />
          {live}
        </p>
      )}
      <h1 className={styles.heroTitle}>{t('home.title')}</h1>
      {!isAuthenticated && <p className={styles.heroWhat}>{t('home.what')}</p>}
      {stats && day ? (
        <div className={styles.heroPanel}><CirclePanel stats={stats} /></div>
      ) : (
        <p className={styles.heroState}>{state}</p>
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
 * The reading room, once on the page, right under the shared total: the library hall — the one «Начать читать»
 * opens — live, with whoever reads in it now (a quiet hour says so). Mounted only when the reader scrolls near it:
 * the textures are heavy and most visitors never come this far.
 */
export function RoomSection() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const ref = useSectionView<HTMLElement>('room');
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [count, setCount] = useState<number | null>(null);

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

  const words = (
    <div className={styles.roomWords}>
      <p className={styles.roomKicker}>{t('home.room.kicker')}</p>
      <h2 className={styles.roomTitle}>
        {count === null ? t('home.room.title') : count > 0 ? t('home.room.now', { n: count }) : t('home.room.quiet')}
      </h2>
      <p className={styles.roomText}>{t('home.room.text')}</p>
      <Button
        variant="primary"
        size="lg"
        onClick={() => {
          track('home_cta', { place: 'room', action: 'read' });
          navigate('/library/hall');
        }}
      >
        {isAuthenticated ? t('home.cta.room') : t('home.cta.read')}
      </Button>
    </div>
  );

  return (
    <section ref={ref} className={styles.roomSection} aria-label={t('home.room.kicker')}>
      <div ref={box} className={styles.roomBox}>
        {near ? (
          <LiveRoom
            hall="library"
            keepChairsClear
            reads
            className={styles.roomLive}
            onRoom={(r) => setCount(r.readers.length)}
            poster={
              <picture>
                <source media="(max-width: 759px)" srcSet="/reading-room/m-night-empty-m.jpg" />
                <img src="/reading-room/b-night-empty-m.jpg" alt="" loading="lazy" decoding="async" />
              </picture>
            }
          >
            {words}
          </LiveRoom>
        ) : (
          <div className={styles.roomWait}>{words}</div>
        )}
      </div>
    </section>
  );
}

type PublicBook = { title: string; author: string | null; cover_url: string; minutes: number; readers: number };

/** The shared total: everything read together, this month's part, and the books it went into. */
export function SharedTotal({ stats }: { stats: PublicStats | null }) {
  const { t, locale } = useI18n();
  const ref = useSectionView<HTMLElement>('treasury');
  const [books, setBooks] = useState<PublicBook[]>([]);
  const [shown, setShown] = useState(0);
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

  // The big number counts up once, when it comes into view.
  const total = stats?.total_minutes_read ?? 0;
  useEffect(() => {
    const el = numRef.current;
    if (!el || !total) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setShown(total);
      return;
    }
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / 1800);
        setShown(Math.round(total * (1 - Math.pow(1 - p, 4))));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.5 });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [total]);

  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ru-RU');
  const minWord = (n: number) => plural(locale, n, { one: t('home.min.one'), few: t('home.min.few'), many: t('home.min.many') });
  const since = stats?.yearly?.[0]?.year ?? 2021;
  const month = stats?.round_month ? t(`month.${stats.round_month}`) : '';
  const active = stats?.is_round_active && (stats.round_minutes ?? 0) > 0;

  return (
    <section ref={ref} className={styles.total} aria-labelledby="total-title">
      <Container className={styles.totalIn}>
        <p className={styles.kicker}>{t('home.tr.kicker')}</p>
        <h2 id="total-title" className={styles.h2}>{t('home.tr.title')}</h2>

        <div className={styles.totalNumber}>
          <span ref={numRef} className={styles.totalValue}>{nf.format(shown || 0)}</span>
          <span className={styles.totalUnit}>
            {minWord(total)} {t('home.tr.caption', { year: since })}
          </span>
        </div>
        <p className={styles.totalLead}>{t('home.tr.lead')}</p>

        {stats && (
          <p className={styles.totalFacts}>
            {active && (
              <span>
                {t('home.tr.month', { month, minutes: `${nf.format(stats.round_minutes ?? 0)} ${minWord(stats.round_minutes ?? 0)}` })}
                {(stats.today_logged ?? 0) >= 5 && <> · {t('home.tr.today', { n: stats.today_logged ?? 0, total: stats.current_round_participants })}</>}
              </span>
            )}
            <span>
              {nf.format(stats.total_participants)}{' '}
              {plural(locale, stats.total_participants, { one: t('home.reader.one'), few: t('home.reader.few'), many: t('home.reader.many') })}
              {' · '}
              {nf.format(stats.total_rounds)}{' '}
              {plural(locale, stats.total_rounds, { one: t('home.round.one'), few: t('home.round.few'), many: t('home.round.many') })}
              {' · '}
              <Link to="/about" className={styles.storyLink} onClick={() => track('home_cta', { place: 'treasury', action: 'about' })}>
                {t('home.tr.story')} →
              </Link>
            </span>
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
                  <span className={styles.bookMeta}>{t('home.tr.bookMeta', { minutes: nf.format(b.minutes), readers: b.readers })}</span>
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
  const ref = useSectionView<HTMLElement>('gets');
  return (
    <section ref={ref} className={styles.gets} aria-labelledby="gets-title">
      <Container>
        <h2 id="gets-title" className={styles.h2}>{t('home.get.title')}</h2>
        <ul className={styles.getGrid}>
          {GETS.map((n) => (
            <li key={n} className={styles.get}>
              <span className={styles.getBig}>{t(`home.get.${n}.b`)}</span>
              <span className={styles.getText}>{t(`home.get.${n}.t`)}</span>
            </li>
          ))}
        </ul>
        <p className={styles.need}>{t('home.need')}</p>
      </Container>
    </section>
  );
}

const FAQ = [1, 2, 3, 4, 5];

/** How a circle goes: the four steps, the film, and the questions people ask. */
export function HowItWorks() {
  const { t } = useI18n();
  const ref = useSectionView<HTMLElement>('how');
  const faqRef = useSectionView<HTMLDivElement>('faq');

  return (
    <section ref={ref} id="powerbook" className={styles.how} aria-labelledby="how-title">
      <Container>
        <div className={styles.howGrid}>
          <div>
            <p className={styles.kicker}>{t('home.how')}</p>
            <h2 id="how-title" className={styles.h2}>{t('home.steps')}</h2>
            <ol className={styles.steps}>
              {[1, 2, 3, 4].map((n) => (
                <li key={n} className={styles.step}>
                  <span className={styles.stepNum}>{n}</span>
                  <div>
                    <h3 className={styles.stepTitle}>{t(`ex.step${n}.t`)}</h3>
                    <p className={styles.stepText}>{t(`ex.step${n}.d`)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className={styles.reel}>
            <MotionReel />
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
              <summary>{t(`ex.q${n}`)}</summary>
              <p>{t(`ex.a${n}`)}</p>
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
  const ref = useSectionView<HTMLElement>('perks');
  return (
    <section ref={ref} className={styles.perks} aria-labelledby="perks-title">
      <Container>
        <h2 id="perks-title" className={styles.h2}>{t('ex.perksTitle')}</h2>
        <div className={styles.perkGrid}>
          {PERKS.map((p) => {
            const body = (
              <>
                <span className={styles.perkIcon} aria-hidden="true"><Icon name={p.icon} size="md" /></span>
                <strong className={styles.perkTitle}>{t(`ex.perk.${p.key}.t`)}</strong>
                <span className={styles.perkText}>{t(`ex.perk.${p.key}.d`)}</span>
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

/** The last word, on the night: start now, or take the circle's next step. */
export function HomeFinal() {
  const { t } = useI18n();
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const next = useNextStep();
  const ref = useSectionView<HTMLElement>('final');

  return (
    <section ref={ref} className={styles.final}>
      <Container>
        <div className={styles.finalInner}>
          <h2 className={styles.finalTitle}>{t('home.final.title')}</h2>
          <p className={styles.finalSub}>{t('home.final.sub')}</p>
          {!isLoading && (
            <div className={styles.finalActions}>
              <Button
                variant="primary"
                size="lg"
                onClick={() => {
                  track('home_cta', { place: 'final', action: 'read' });
                  navigate('/library/hall');
                }}
              >
                {isAuthenticated ? t('home.cta.room') : t('home.cta.read')}
              </Button>
              <button
                type="button"
                className={styles.finalSecond}
                onClick={() => {
                  track('home_cta', { place: 'final', action: next.action });
                  next.run();
                }}
              >
                {next.label}
              </button>
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
