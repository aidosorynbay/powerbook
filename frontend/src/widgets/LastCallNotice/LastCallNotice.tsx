import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useI18n, apiGet, DEFAULT_GROUP_SLUG, type CurrentRoundStatusResponse } from '@/shared/lib';
import styles from './LastCallNotice.module.css';

/**
 * Last-day catch-up prompt, shown on arrival.
 *
 * Driven by the round's own state rather than a date, so it appears on the
 * final day of every circle and takes itself down once results publish —
 * nobody has to remember to remove it.
 *
 * Shown once per round: a dialog that returns on every navigation stops being
 * a reminder and becomes an obstacle.
 */
export function LastCallNotice() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [roundId, setRoundId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

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
      const stillOpen = r.status !== 'closed' && r.status !== 'results_published';
      if (!isThisMonth || !stillOpen || now.getDate() !== lastDay) return;

      setRoundId(r.id);
      setOpen(localStorage.getItem(`pb.lastCall.${r.id}`) !== '1');
    });
    return () => { cancelled = true; };
  }, []);

  const close = () => {
    if (roundId) localStorage.setItem(`pb.lastCall.${roundId}`, '1');
    setOpen(false);
  };

  // Escape closes it, like any other dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, roundId]);

  if (!open) return null;

  return createPortal(
    <div className={styles.overlay} onClick={close} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.icon} aria-hidden="true">⏳</div>
        <div className={styles.title}>{t('notice.lastCallTitle')}</div>
        <p className={styles.text}>{t('notice.lastCallBody')}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cta}
            onClick={() => { close(); navigate('/round'); }}
          >
            {t('notice.lastCallCta')}
          </button>
          <button type="button" className={styles.dismiss} onClick={close}>
            {t('notice.dismiss')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
