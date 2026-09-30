import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, useWaitlist } from '@/shared/lib';
import { ShareInvite } from './ShareInvite';
import { dayOf, monthOf } from './words';
import styles from './JoinPrompt.module.css';

/** For someone outside this month's circle, on the round page: the next one,
 * its waiting list, and a link to bring friends along. */
export function WaitlistCard() {
  const { t, locale } = useI18n();
  const { state, join, leave } = useWaitlist();
  const [busy, setBusy] = useState(false);
  if (!state || state.phase !== 'waitlist' || state.in_current_round) return null;
  const month = monthOf(t, state.month);
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <span aria-hidden="true">⏳</span>
        <h3>{t('wl.cardTitle', { month })}</h3>
      </div>
      <p className={styles.text}>{t('wl.cardText', { date: dayOf(state.starts_on, locale, t) })}</p>
      {state.count > 0 && <p className={styles.count}>{t('wl.count', { n: state.count })}</p>}
      {state.on_waitlist ? (
        <>
          <p className={styles.onList}>✓ {t('wl.onList')}</p>
          <ShareInvite refName={state.ref} month={state.month} invited={state.invited} />
          <div className={styles.cardLinks}>
            <Link to="/join">{t('wl.openPage')} →</Link>
            <button type="button" onClick={() => leave()}>{t('wl.leave')}</button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className={styles.cta}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await join();
            setBusy(false);
          }}
        >
          {t('wl.joinList')}
        </button>
      )}
    </section>
  );
}
