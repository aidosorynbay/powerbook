import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, apiGet, DEFAULT_GROUP_SLUG, type CurrentRoundStatusResponse } from '@/shared/lib';
import styles from './LastCallNotice.module.css';

/**
 * The "you can still catch up" banner shown on the final day of a circle.
 *
 * Driven by the round's own state rather than a hard-coded date, so it
 * appears on the last day of every circle and disappears by itself once
 * results are published — nobody has to remember to take it down.
 *
 * Dismissal is remembered per round, so a reader who has read it once is not
 * nagged on every page, but the next circle's notice still gets through.
 */
export function LastCallNotice() {
  const { t } = useI18n();
  const [roundId, setRoundId] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGet<CurrentRoundStatusResponse>(
      `/groups/by-slug/${DEFAULT_GROUP_SLUG}/current-round-status`,
      { requireAuth: true }
    ).then(({ data }) => {
      if (cancelled || !data?.round) return;
      const r = data.round;
      const now = new Date();
      const isThisMonth = now.getFullYear() === r.year && now.getMonth() + 1 === r.month;
      const lastDay = r.end_day ?? new Date(r.year, r.month, 0).getDate();
      // Only while the circle is still accepting corrections.
      const stillOpen = r.status !== 'closed' && r.status !== 'results_published';
      if (!isThisMonth || !stillOpen || now.getDate() !== lastDay) return;

      const seen = localStorage.getItem(`pb.lastCall.${r.id}`) === '1';
      setRoundId(r.id);
      setVisible(!seen);
    });
    return () => { cancelled = true; };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    if (roundId) localStorage.setItem(`pb.lastCall.${roundId}`, '1');
    setVisible(false);
  };

  return (
    <div className={styles.notice} role="status">
      <div className={styles.body}>
        <div className={styles.title}>⏳ {t('notice.lastCallTitle')}</div>
        <p className={styles.text}>{t('notice.lastCallBody')}</p>
        <div className={styles.actions}>
          <Link to="/round" className={styles.cta}>{t('notice.lastCallCta')}</Link>
          <button type="button" className={styles.dismiss} onClick={dismiss}>
            {t('notice.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}
