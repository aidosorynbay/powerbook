import { Link, useNavigate } from 'react-router-dom';
import { useAuth, useI18n, useWaitlist } from '@/shared/lib';
import { Container, Icon } from '@/shared/ui';
import { MotionReel } from './MotionReel';
import styles from './Explainer.module.css';

const PERKS = [
  { key: 'calendar', icon: 'calendar', to: '/round' },
  { key: 'leaders', icon: 'trophy', to: '/round' },
  { key: 'room', icon: 'candle', to: '/library/hall' },
  { key: 'shelf', icon: 'book', to: '/library' },
  { key: 'books', icon: 'star', to: '/books' },
  { key: 'market', icon: 'tag', to: '/market' },
  { key: 'ai', icon: 'sparkle', to: '/reading' },
  { key: 'fame', icon: 'medal', to: '/hall-of-fame' },
  { key: 'people', icon: 'users', to: '/readers' },
  { key: 'tg', icon: 'telegram', href: 'https://t.me/+ZSmueLtmT8Y1MDBi' },
] as const;

/**
 * What PowerBook is, for someone who has never heard of it: the film on the
 * left plays while the page on the right says it all in words — the four
 * steps of a circle, what a month gives and asks, everything else the
 * platform has, the month on one line, and the questions people ask.
 */
export function Explainer() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const { state } = useWaitlist();
  const navigate = useNavigate();

  const month = state ? t(`month.${state.month}`) : '';
  const cta = (() => {
    // A visitor goes through /join, never straight to /register: there the
    // sign-up also takes the place in the circle.
    if (!state) return { label: t('hero.joinBtn'), to: isAuthenticated ? '/round' : '/join' };
    if (state.in_current_round || state.in_open_round) return { label: t('hero.goToRound'), to: '/round' };
    if (state.phase === 'registration') return { label: t('wl.heroJoin', { month }), to: '/join' };
    return { label: state.on_waitlist ? t('wl.heroOnList') : t('wl.heroWait', { month }), to: '/join' };
  })();

  const steps = [1, 2, 3, 4];
  const timeline = [1, 2, 3, 4, 5];

  return (
    <section id="powerbook" className={styles.section} aria-labelledby="powerbook-title">
      <Container>
        <div className={styles.grid}>
          <div className={styles.reelCol}>
            <div className={styles.sticky}>
              <MotionReel />
            </div>
          </div>

          <div className={styles.textCol}>
            <p className={styles.kicker}>{t('ex.kicker')}</p>
            <h2 id="powerbook-title" className={styles.title}>{t('ex.title')}</h2>
            <p className={styles.lead}>{t('ex.lead')}</p>

            <h3 className={styles.h3}>{t('ex.stepsTitle')}</h3>
            <ol className={styles.steps}>
              {steps.map((n) => (
                <li key={n}>
                  <span className={styles.stepNum}>{n}</span>
                  <div>
                    <strong>{t(`ex.step${n}.t`)}</strong>
                    <p>{t(`ex.step${n}.d`)}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className={styles.twoCols}>
              <div className={styles.box}>
                <h3 className={styles.h3}>{t('ex.getTitle')}</h3>
                <ul className={styles.checks}>
                  {[1, 2, 3, 4].map((n) => (
                    <li key={n}>{t(`ex.get${n}`)}</li>
                  ))}
                </ul>
              </div>
              <div className={styles.box}>
                <h3 className={styles.h3}>{t('ex.needTitle')}</h3>
                <ul className={`${styles.checks} ${styles.needs}`}>
                  {[1, 2, 3, 4].map((n) => (
                    <li key={n}>{t(`ex.need${n}`)}</li>
                  ))}
                </ul>
              </div>
            </div>

            <h3 className={styles.h3}>{t('ex.timelineTitle')}</h3>
            <ol className={styles.timeline}>
              {timeline.map((n) => (
                <li key={n}>
                  <span className={styles.when}>{t(`ex.tl${n}.w`)}</span>
                  <span className={styles.what}>{t(`ex.tl${n}.t`)}</span>
                </li>
              ))}
            </ol>

            <h3 className={styles.h3}>{t('ex.perksTitle')}</h3>
            <div className={styles.perks}>
              {PERKS.map((p) => {
                const inner = (
                  <>
                    <span className={styles.perkIcon} aria-hidden="true"><Icon name={p.icon} size="md" /></span>
                    <span>
                      <strong>{t(`ex.perk.${p.key}.t`)}</strong>
                      <span className={styles.perkText}>{t(`ex.perk.${p.key}.d`)}</span>
                    </span>
                  </>
                );
                return 'href' in p ? (
                  <a key={p.key} className={styles.perk} href={p.href} target="_blank" rel="noopener noreferrer">
                    {inner}
                  </a>
                ) : isAuthenticated ? (
                  <Link key={p.key} className={styles.perk} to={p.to}>
                    {inner}
                  </Link>
                ) : (
                  <div key={p.key} className={styles.perk}>
                    {inner}
                  </div>
                );
              })}
            </div>

            <h3 className={styles.h3}>{t('ex.faqTitle')}</h3>
            <div className={styles.faq}>
              {[1, 2, 3, 4, 5].map((n) => (
                <details key={n}>
                  <summary>{t(`ex.q${n}`)}</summary>
                  <p>{t(`ex.a${n}`)}</p>
                </details>
              ))}
            </div>

            <div className={styles.ctaRow}>
              <button type="button" className={styles.cta} onClick={() => navigate(cta.to)}>
                {cta.label} →
              </button>
              <a className={styles.secondary} href="https://t.me/+ZSmueLtmT8Y1MDBi" target="_blank" rel="noopener noreferrer">
                {t('ex.telegram')}
              </a>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
