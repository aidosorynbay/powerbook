import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet, getApiBaseUrl, track, trackSectionView, useAuth, useI18n, useWaitlist, type PublicStats } from '@/shared/lib';
import { Button, Container, Icon } from '@/shared/ui';
import { MotionReel } from '@/widgets';
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

export function HomeHero({ stats, onHow }: { stats: PublicStats | null; onHow: () => void }) {
  const { t, locale } = useI18n();
  const { isAuthenticated, isLoading } = useAuth();
  const { state: wait } = useWaitlist();
  const next = useNextStep();
  const ref = useSectionView<HTMLElement>('hero');

  const day = roundDay(stats);
  const month = stats?.round_month ? t(`month.${stats.round_month}`) : wait ? t(`month.${wait.month}`) : '';
  const state = (() => {
    if (wait?.in_current_round && day) return t('home.state.member', { month, day: day.day, len: day.len });
    if (wait?.phase === 'registration' && wait.open_round) {
      const m = t(`month.${wait.open_round.month}`);
      const n = wait.open_round.days_left;
      // days_left counts the days after today, so «ещё 2 дня» is today and tomorrow.
      if (n === 0) return t('home.state.regToday', { month: m });
      if (n < 10) {
        const d = n + 1;
        const days = `${d} ${plural(locale, d, { one: t('home.day.one'), few: t('home.day.few'), many: t('home.day.many') })}`;
        return t('home.state.regDays', { month: m, days });
      }
      return t('home.state.reg', { month: m });
    }
    if (day) return t('home.state.running', { month, day: day.day, len: day.len });
    return t('home.state.off');
  })();

  // Live numbers only when they say «people are here»; a quiet hour shows the
  // shared total instead of «0».
  const live = [
    stats?.room_now ? t('home.live.room', { n: stats.room_now }) : null,
    stats?.today_logged && stats.today_logged >= 5 && stats.current_round_participants
      ? t('home.live.today', { n: stats.today_logged, total: stats.current_round_participants })
      : null,
  ].filter(Boolean);
  if (!live.length && stats?.total_minutes_read) {
    live.push(t('home.live.total', { n: new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ru-RU').format(stats.total_minutes_read) }));
  }

  return (
    <section ref={ref} className={styles.hero}>
      <picture className={styles.heroArt} aria-hidden="true">
        <source
          media="(min-width: 900px)"
          type="image/webp"
          srcSet="/home/room-night-wide-1600.webp 1600w, /home/room-night-wide-2560.webp 2560w"
          sizes="100vw"
        />
        <source
          media="(min-width: 900px)"
          srcSet="/home/room-night-wide-1600.jpg 1600w, /home/room-night-wide-2560.jpg 2560w"
          sizes="100vw"
        />
        <source
          type="image/webp"
          srcSet="/home/room-night-tall-750.webp 750w, /home/room-night-tall-1080.webp 1080w"
          sizes="100vw"
        />
        <img
          src="/home/room-night-tall-750.jpg"
          srcSet="/home/room-night-tall-750.jpg 750w, /home/room-night-tall-1080.jpg 1080w"
          sizes="100vw"
          alt=""
          {...{ fetchpriority: 'high' }}
        />
      </picture>
      <div className={styles.heroShade} aria-hidden="true" />

      <Container>
        <div className={styles.heroInner}>
          {live.length > 0 && (
            <p className={styles.live}>
              <span className={styles.liveDot} aria-hidden="true" />
              {live.join(' · ')}
            </p>
          )}
          <h1 className={styles.heroTitle}>{t('home.title')}</h1>
          {!isAuthenticated && <p className={styles.heroWhat}>{t('home.what')}</p>}
          <p className={styles.heroState}>{state}</p>

          <div className={styles.heroActions} aria-busy={isLoading}>
            {isLoading ? (
              <span className={styles.ctaSkeleton} aria-hidden="true" />
            ) : (
            <Button
              variant="primary"
              size="lg"
              icon={<Icon name="arrow-right" size="sm" />}
              className={styles.heroCta}
              onClick={() => {
                track('home_cta', { place: 'hero', action: next.action });
                next.run();
              }}
            >
              {next.label}
            </Button>
            )}
            {!isAuthenticated && !isLoading && (
              <Link
                to="/login"
                className={styles.heroLogin}
                onClick={() => track('home_cta', { place: 'hero', action: 'login' })}
              >
                {t('home.login')}
              </Link>
            )}
          </div>

          <button
            type="button"
            className={styles.heroHow}
            onClick={() => {
              track('home_cta', { place: 'hero', action: 'peek' });
              onHow();
            }}
          >
            {t('home.peek')} <span aria-hidden="true">↓</span>
          </button>
        </div>
      </Container>
    </section>
  );
}

/** The way into the live room, shown once the hall is whole. */
export function RoomWayIn() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const ref = useSectionView<HTMLDivElement>('room');
  return (
    <div ref={ref} className={styles.wayIn}>
      <h2 className={styles.wayInTitle}>{t('home.room.title')}</h2>
      <p className={styles.wayInText}>{t('home.room.text')}</p>
      <Button
        variant="primary"
        size="lg"
        onClick={() => {
          track('home_cta', { place: 'room', action: isAuthenticated ? 'room' : 'room_signup' });
          navigate(isAuthenticated ? '/library/hall' : `/register?redirect=${encodeURIComponent('/library/hall')}`);
        }}
      >
        {isAuthenticated ? t('home.room.member') : t('home.room.guest')}
      </Button>
    </div>
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
      <Container>
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
            <ul className={styles.bookRow}>
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

/** The last word: the empty hall, one armchair for you. */
export function HomeFinal() {
  const { t } = useI18n();
  const { isAuthenticated, isLoading } = useAuth();
  const next = useNextStep();
  const ref = useSectionView<HTMLElement>('final');

  return (
    <section ref={ref} className={styles.final}>
      <picture className={styles.finalArt} aria-hidden="true">
        <source media="(min-width: 760px)" type="image/webp" srcSet="/home/room-empty-wide.webp" />
        <source media="(min-width: 760px)" srcSet="/home/room-empty-wide.jpg" />
        <source type="image/webp" srcSet="/home/room-empty-tall.webp" />
        <img src="/home/room-empty-tall.jpg" alt="" loading="lazy" decoding="async" />
      </picture>
      <div className={styles.finalShade} aria-hidden="true" />
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
