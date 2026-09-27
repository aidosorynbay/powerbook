import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useI18n, apiGet, DEFAULT_GROUP_SLUG, type CurrentRoundStatusResponse } from '@/shared/lib';
import styles from './LastCallNotice.module.css';

/**
 * The two "today is your last day" prompts, shown on arrival.
 *
 * Both are driven by the round's own state rather than a date, so they appear
 * for every circle and take themselves down once results publish — nobody has
 * to remember to remove them.
 *
 *   lastCall — the final day of the round: log anything you missed.
 *   deadline — the registration day: last chance to join, or to leave.
 *
 * Each is shown once per round: a dialog that returns on every navigation
 * stops being a reminder and becomes an obstacle.
 */

/**
 * Dismissal is stored per round and per wording. The last-call notice first
 * went out saying "until midnight"; the deadline is 20:00, and people who had
 * already closed the old text would never have seen the correction. Bumping
 * the revision shows it once more to exactly those readers.
 */
const LAST_CALL_REVISION = 2;
const DEADLINE_REVISION = 1;

type NoticeKind = 'lastCall' | 'deadlineJoin' | 'deadlineStay';

const dismissKey = (kind: NoticeKind, roundId: string) =>
  kind === 'lastCall'
    ? `pb.lastCall.v${LAST_CALL_REVISION}.${roundId}`
    : `pb.deadline.v${DEADLINE_REVISION}.${roundId}`;

const NOTICES: Record<NoticeKind, { icon: string; title: string; body: string; cta: string }> = {
  lastCall: {
    icon: '⏳',
    title: 'notice.lastCallTitle',
    body: 'notice.lastCallBody',
    cta: 'notice.lastCallCta',
  },
  deadlineJoin: {
    icon: '⏰',
    title: 'notice.deadlineJoinTitle',
    body: 'notice.deadlineJoinBody',
    cta: 'notice.deadlineJoinCta',
  },
  deadlineStay: {
    icon: '⏰',
    title: 'notice.deadlineStayTitle',
    body: 'notice.deadlineStayBody',
    cta: 'notice.deadlineStayCta',
  },
};

export function LastCallNotice() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [roundId, setRoundId] = useState<string | null>(null);
  const [kind, setKind] = useState<NoticeKind | null>(null);

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
      if (!isThisMonth || !stillOpen) return;

      const today = now.getDate();
      const isParticipant =
        data.participation?.is_participant === true && data.participation.status === 'active';

      // The final day wins if a short round ends on its own deadline day:
      // logging the month is the more urgent of the two.
      let next: NoticeKind | null = null;
      if (today === lastDay) {
        next = 'lastCall';
      } else if (today === r.registration_open_until_day && r.status === 'registration_open') {
        next = isParticipant ? 'deadlineStay' : 'deadlineJoin';
      }
      if (!next) return;

      setRoundId(r.id);
      if (localStorage.getItem(dismissKey(next, r.id)) !== '1') setKind(next);
    });
    return () => { cancelled = true; };
  }, []);

  const close = () => {
    if (roundId && kind) localStorage.setItem(dismissKey(kind, roundId), '1');
    setKind(null);
  };

  // Escape closes it, like any other dialog.
  useEffect(() => {
    if (!kind) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, roundId]);

  if (!kind) return null;

  const notice = NOTICES[kind];

  return createPortal(
    <div className={styles.overlay} onClick={close} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.icon} aria-hidden="true">{notice.icon}</div>
        <div className={styles.title}>{t(notice.title)}</div>
        <p className={styles.text}>{t(notice.body)}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cta}
            onClick={() => { close(); navigate('/round'); }}
          >
            {t(notice.cta)}
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
