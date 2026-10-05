import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { markJoinIntent, useAuth, useI18n, useWaitlist } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import { ShareInvite } from './ShareInvite';
import { dayOf, monthOf } from './words';
import styles from './JoinPrompt.module.css';

type Kind = 'open' | 'reg' | 'wait';

// Pages where a prompt would be in the way: signing in, the invitation page
// itself, a shared day (it has its own way in), and a book open in the reader.
const QUIET = [/^\/login/, /^\/register/, /^\/forgot-password/, /^\/join/, /^\/r\//, /^\/claim/, /^\/library\/(?!hall)[^/]+$/];

function dismissKey(kind: Kind, year: number, month: number) {
  return `pb.joinPrompt.${kind}.${year}-${month}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * On arrival, for someone not reading in this month's circle: while sign-up is
 * open, the circle itself; in the month's last days, the waiting list for the
 * next one; and for someone who waited, their place once sign-up opens.
 * Once a day at most, whichever it is.
 */
export function JoinPrompt() {
  const { t, locale } = useI18n();
  const { isAuthenticated } = useAuth();
  const { state, join, joinRound } = useWaitlist();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [kind, setKind] = useState<Kind | null>(null);
  const [done, setDone] = useState<'joined' | 'listed' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!state || kind || done) return;
    if (QUIET.some((re) => re.test(pathname))) return;
    // A visitor sees it on the front page only.
    if (!isAuthenticated && pathname !== '/') return;
    let next: Kind | null = null;
    if (isAuthenticated && state.waited_for_open) next = 'open';
    else if (state.phase === 'registration' && !state.in_open_round && !state.in_current_round) next = 'reg';
    else if (state.phase === 'waitlist' && !state.in_current_round && !state.on_waitlist && state.days_left_in_month <= 4) next = 'wait';
    if (!next) return;
    try {
      if (localStorage.getItem(dismissKey(next, state.year, state.month)) === today()) return;
    } catch {
      // storage blocked: show it; closing it works for this visit
    }
    setKind(next);
  }, [state, pathname, isAuthenticated, kind, done]);

  const close = () => {
    if (kind && state) {
      try {
        localStorage.setItem(dismissKey(kind, state.year, state.month), today());
      } catch {
        // asked again next visit
      }
    }
    setKind(null);
    setDone(null);
  };

  useEffect(() => {
    if (!kind) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  if (!kind || !state) return null;
  const month = monthOf(t, state.month);

  const act = async () => {
    setError(false);
    if (!isAuthenticated) {
      close();
      if (kind === 'wait') {
        markJoinIntent();
        navigate('/join');
      } else {
        navigate('/register');
      }
      return;
    }
    setBusy(true);
    const failed = kind === 'wait' ? await join() : await joinRound();
    setBusy(false);
    if (failed) return setError(true);
    setDone(kind === 'wait' ? 'listed' : 'joined');
  };

  const title =
    done === 'joined'
      ? t('wl.joined', { month })
      : done === 'listed'
        ? t('wl.onList')
        : kind === 'open'
          ? t('wl.promptOpenTitle', { month })
          : kind === 'reg'
            ? t('wl.promptRegTitle', { month })
            : t('wl.promptWaitTitle', { month });

  let text = '';
  if (!done) {
    if (kind === 'open') text = t('wl.promptOpenText');
    else if (kind === 'reg' && state.open_round)
      text = state.open_round.days_left > 0
        ? t('wl.promptRegText', { date: dayOf(state.open_round.registration_until, locale, t), n: state.open_round.days_left })
        : t('wl.promptRegToday');
    else text = t('wl.promptWaitText', { date: dayOf(state.starts_on, locale, t) });
  }

  return createPortal(
    <div className={styles.overlay} onClick={close} role="dialog" aria-modal="true" aria-label={title}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.icon} aria-hidden="true">
          <Icon name={done ? 'party' : kind === 'wait' ? 'hourglass' : 'book'} size="em" />
        </div>
        <div className={styles.title}>{title}</div>
        {text && <p className={styles.text}>{text}</p>}
        {kind === 'wait' && !done && state.count > 0 && <p className={styles.count}>{t('wl.count', { n: state.count })}</p>}

        {done === 'listed' && <ShareInvite refName={state.ref} month={state.month} invited={state.invited} />}

        <div className={styles.actions}>
          {!done && (
            <button type="button" className={styles.cta} onClick={act} disabled={busy}>
              {!isAuthenticated && kind !== 'wait' ? t('wl.register') : kind === 'wait' ? t('wl.joinList') : kind === 'open' ? t('wl.confirm') : t('wl.join')}
            </button>
          )}
          {done === 'joined' && (
            <button type="button" className={styles.cta} onClick={() => { close(); navigate('/round'); }}>
              {t('hero.goToRound')}
            </button>
          )}
          {error && <p className={styles.error}>{t('wl.error')}</p>}
          <button type="button" className={styles.dismiss} onClick={close}>
            {done ? t('work.close') : t('wl.later')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
