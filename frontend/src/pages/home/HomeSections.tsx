import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { track, trackSectionView, useAuth, useI18n, useWaitlist, type PublicStats } from '@/shared/lib';
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

  const live = [
    stats?.room_now ? t('home.live.room', { n: stats.room_now }) : null,
    stats?.today_logged && stats.current_round_participants
      ? t('home.live.today', { n: stats.today_logged, total: stats.current_round_participants })
      : null,
  ].filter(Boolean);

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
          {!isAuthenticated && <p className={styles.heroFacts}>{t('home.facts')}</p>}
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
              track('home_cta', { place: 'hero', action: 'how' });
              onHow();
            }}
          >
            {t('home.how')} <span aria-hidden="true">↓</span>
          </button>
        </div>
      </Container>
    </section>
  );
}

/** «Общая казна»: the circle's minutes as one total, and every member as one dot. */
export function CircleTreasury({ stats }: { stats: PublicStats | null }) {
  const { t, locale } = useI18n();
  const ref = useSectionView<HTMLElement>('treasury');
  const [lit, setLit] = useState(false);
  const dotsRef = useRef<HTMLDivElement>(null);

  // The dots light up once, when they come into view.
  useEffect(() => {
    const el = dotsRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setLit(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setLit(true);
        io.disconnect();
      }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [stats]);

  if (!stats) return <section className={styles.treasury} aria-busy="true" />;

  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ru-RU');
  const compact = new Intl.NumberFormat(locale === 'en' ? 'en-US' : locale === 'kk' ? 'kk-KZ' : 'ru-RU', {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  const active = stats.is_round_active && stats.current_round_participants > 0;
  const people = Math.min(stats.current_round_participants, 240);
  const today = Math.min(stats.today_logged ?? 0, people);
  const minutes = stats.round_minutes ?? 0;
  const month = stats.round_month ? t(`month.${stats.round_month}`) : '';
  const since = stats.yearly?.[0]?.year;
  const minWord = (n: number) => plural(locale, n, { one: t('home.min.one'), few: t('home.min.few'), many: t('home.min.many') });

  return (
    <section ref={ref} className={styles.treasury} aria-labelledby="treasury-title">
      <Container>
        <p className={styles.kicker}>{t('home.treasury.kicker')}</p>
        <h2 id="treasury-title" className={styles.h2}>{t('home.treasury.title')}</h2>

        {active && (
          <div className={styles.month}>
            <div className={styles.bigNumber}>
              <span className={styles.bigValue}>{nf.format(minutes)}</span>
              <span className={styles.bigUnit}>{minWord(minutes)}</span>
            </div>
            <p className={styles.bigCaption}>{t('home.treasury.caption', { month })}</p>

            <div
              ref={dotsRef}
              className={`${styles.dots} ${lit ? styles.dotsLit : ''}`}
              role="img"
              aria-label={t('home.live.today', { n: today, total: people })}
            >
              {Array.from({ length: people }, (_, i) => (
                <span
                  key={i}
                  className={i < today ? styles.dotOn : styles.dot}
                  style={{ ['--i' as string]: i }}
                />
              ))}
            </div>
            <p className={styles.dotsCaption}>
              <strong>{t('home.live.today', { n: today, total: people })}</strong>
              <span>{t('home.treasury.dots')}</span>
            </p>
          </div>
        )}

        <div className={styles.allTime}>
          {since && <p className={styles.allTimeHead}>{t('home.treasury.since', { year: since })}</p>}
          <dl className={styles.allTimeRow}>
            <div>
              <dt>{minWord(stats.total_minutes_read)}</dt>
              <dd>{compact.format(stats.total_minutes_read)}</dd>
            </div>
            <div>
              <dt>{plural(locale, stats.total_participants, { one: t('home.reader.one'), few: t('home.reader.few'), many: t('home.reader.many') })}</dt>
              <dd>{nf.format(stats.total_participants)}</dd>
            </div>
            <div>
              <dt>{plural(locale, stats.total_rounds, { one: t('home.round.one'), few: t('home.round.few'), many: t('home.round.many') })}</dt>
              <dd>{nf.format(stats.total_rounds)}</dd>
            </div>
          </dl>
        </div>

        <p className={styles.note}>{t('home.treasury.note')}</p>
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
              {[1, 2, 3, 4].map(n => (
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
          {FAQ.map(n => (
            <details
              key={n}
              className={styles.faqItem}
              onToggle={e => {
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

/** The last word for a visitor; members already have the circle one tap away. */
export function HomeFinal() {
  const { t } = useI18n();
  const { isAuthenticated, isLoading } = useAuth();
  const next = useNextStep();
  const ref = useSectionView<HTMLElement>('final');
  if (isAuthenticated || isLoading) return null;

  return (
    <section ref={ref} className={styles.final}>
      <Container>
        <h2 className={styles.finalTitle}>{t('home.final')}</h2>
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
          <Link to="/login" className={styles.finalLogin} onClick={() => track('home_cta', { place: 'final', action: 'login' })}>
            {t('home.login')}
          </Link>
        </div>
      </Container>
    </section>
  );
}
