import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { markJoinIntent, rememberInvite, useAuth, useI18n, useWaitlist } from '@/shared/lib';
import { Avatar, Container } from '@/shared/ui';
import { Footer, Header } from '@/widgets';
import { RoundRules, ShareInvite, dayOf, monthOf } from '@/widgets/JoinPrompt';
import styles from './JoinPage.module.css';

/**
 * The invitation page, open to anyone: the next circle, who is already
 * waiting, and the one button that matters — join the circle while sign-up is
 * open, or the waiting list while it is not. Members share it with their own
 * link, and whoever comes by it is counted as their guest.
 */
export function JoinPage() {
  const { t, locale } = useI18n();
  const { isAuthenticated, user } = useAuth();
  const { state, join, leave, joinRound } = useWaitlist();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const ref = params.get('ref');

  useEffect(() => {
    rememberInvite(ref);
  }, [ref]);

  const act = async (what: 'list' | 'round') => {
    setBusy(true);
    setError(false);
    const failed = what === 'list' ? await join() : await joinRound();
    setBusy(false);
    if (failed) setError(true);
    else if (what === 'round') navigate('/round');
  };

  const signUp = (to: '/register' | '/login') => {
    markJoinIntent();
    navigate(`${to}?redirect=%2Fjoin`);
  };

  const month = state ? monthOf(t, state.month) : '';
  const registration = state?.phase === 'registration';
  const invitedBy = ref && ref.replace(/^@/, '') !== user?.username ? ref.replace(/^@/, '') : null;

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <Container size="sm">
          {!state ? (
            <p className={styles.muted}>{t('dashboard.loading')}</p>
          ) : (
            <article className={styles.card}>
              {invitedBy && <p className={styles.invitedBy}>{t('wl.invitedBy', { name: invitedBy })}</p>}
              <span className={`${styles.badge} ${registration ? styles.badgeOpen : ''}`}>
                {registration && <i className={styles.dot} aria-hidden="true" />}
                {registration && state.open_round
                  ? t('wl.regUntil', { date: dayOf(state.open_round.registration_until, locale, t) })
                  : t('wl.starts', { date: dayOf(state.starts_on, locale, t) })}
              </span>
              <h1 className={styles.title}>
                {registration ? t('wl.pageTitleReg', { month }) : t('wl.pageTitleWait', { month })}
              </h1>
              <RoundRules />

              {registration && state.joined > 0 && (
                <p className={styles.count}>👥 {t('wl.joinedN', { month, n: state.joined })}</p>
              )}

              {!registration && (
                <div className={styles.people}>
                  <span className={styles.count}>{t('wl.count', { n: state.count })}</span>
                  {state.people.length > 0 && (
                    <span className={styles.faces} aria-label={t('wl.people')}>
                      {state.people.slice(0, 8).map((p) => (
                        <span key={p.user_id} title={p.display_name}>
                          <Avatar src={p.avatar_data} name={p.display_name} size="sm" />
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              )}

              <div className={styles.actions}>
                {!isAuthenticated ? (
                  <>
                    <button type="button" className={styles.cta} onClick={() => signUp('/register')}>
                      {registration ? t('wl.registerToRound') : t('wl.registerToJoin')}
                    </button>
                    <button type="button" className={styles.secondary} onClick={() => signUp('/login')}>
                      {t('wl.haveAccount')}
                    </button>
                  </>
                ) : registration ? (
                  state.in_open_round ? (
                    <>
                      <p className={styles.ok}>✓ {t('wl.alreadyIn')}</p>
                      <Link className={styles.cta} to="/round">{t('hero.goToRound')}</Link>
                    </>
                  ) : (
                    <button type="button" className={styles.cta} onClick={() => act('round')} disabled={busy}>
                      {state.waited_for_open ? t('wl.confirm') : t('wl.join')}
                    </button>
                  )
                ) : state.on_waitlist ? (
                  <>
                    <p className={styles.ok}>✓ {t('wl.onList')}</p>
                    <button type="button" className={styles.secondary} onClick={() => leave()}>
                      {t('wl.leave')}
                    </button>
                  </>
                ) : state.in_current_round ? null : (
                  <button type="button" className={styles.cta} onClick={() => act('list')} disabled={busy}>
                    {t('wl.joinList')}
                  </button>
                )}
                {error && <p className={styles.error}>{t('wl.error')}</p>}
              </div>

              {isAuthenticated && <ShareInvite refName={state.ref} month={state.month} invited={state.invited} />}
            </article>
          )}
        </Container>
      </main>
      <Footer />
    </div>
  );
}
