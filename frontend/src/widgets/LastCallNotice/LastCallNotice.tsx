import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useI18n, apiGet, apiPost, track, DEFAULT_GROUP_SLUG, type CurrentRoundStatusResponse } from '@/shared/lib';
import { Icon, type IconName } from '@/shared/ui';
import styles from './LastCallNotice.module.css';

/**
 * The two "today is your last day" prompts, shown on arrival.
 *
 * Both are driven by the round's own state rather than a date, so they appear
 * for every circle and take themselves down once results publish — nobody has
 * to remember to remove them.
 *
 *   lastReading — the day before the final one, the last day that scores:
 *                 read and log today (or, outside the round, results come tomorrow).
 *   lastCall    — the final day of the round: log anything you missed by 20:00
 *                 (or, outside the round, results and next registration at 20:00).
 *   deadline    — the registration day: last chance to join, or to leave.
 *
 * Each is shown once per round: a dialog that returns on every navigation
 * stops being a reminder and becomes an obstacle. It comes up on the reader's
 * first arrival that day, whether or not they have been here before.
 */

/**
 * Dismissal is stored per round and per wording. The last-call notice first
 * went out saying "until midnight"; the deadline is 20:00, and people who had
 * already closed the old text would never have seen the correction. Bumping
 * the revision shows it once more to exactly those readers.
 */
const LAST_CALL_REVISION = 2;
const LAST_READING_REVISION = 1;
const DEADLINE_REVISION = 1;

type NoticeKind = 'lastReading' | 'lastReadingOut' | 'lastCall' | 'lastCallOut' | 'deadlineJoin' | 'deadlineStay';

const dismissKey = (kind: NoticeKind, roundId: string) => {
  if (kind === 'lastCall' || kind === 'lastCallOut') return `pb.lastCall.v${LAST_CALL_REVISION}.${roundId}`;
  if (kind === 'lastReading' || kind === 'lastReadingOut') return `pb.lastReading.v${LAST_READING_REVISION}.${roundId}`;
  return `pb.deadline.v${DEADLINE_REVISION}.${roundId}`;
};

const NOTICES: Record<NoticeKind, { icon: IconName; title: string; body: string; cta: string }> = {
  lastReading: {
    icon: 'book',
    title: 'notice.lastReadingTitle',
    body: 'notice.lastReadingBody',
    cta: 'notice.lastReadingCta',
  },
  lastReadingOut: {
    icon: 'book',
    title: 'notice.lastReadingTitle',
    body: 'notice.lastReadingOutBody',
    cta: 'notice.openRoundCta',
  },
  lastCall: {
    icon: 'hourglass',
    title: 'notice.lastCallTitle',
    body: 'notice.lastCallBody',
    cta: 'notice.lastCallCta',
  },
  lastCallOut: {
    icon: 'flag',
    title: 'notice.lastCallOutTitle',
    body: 'notice.lastCallOutBody',
    cta: 'notice.openRoundCta',
  },
  deadlineJoin: {
    icon: 'alarm',
    title: 'notice.deadlineJoinTitle',
    body: 'notice.deadlineJoinBody',
    cta: 'notice.deadlineJoinCta',
  },
  deadlineStay: {
    icon: 'alarm',
    title: 'notice.deadlineStayTitle',
    body: 'notice.deadlineStayBody',
    cta: 'notice.deadlineStayCta',
  },
};

// Signing up, signing in, the invitation: someone there is in the middle of
// joining, and «Сегодня последний день записаться» over that form only startled
// them. The notice waits for the first ordinary page.
const QUIET = ['/register', '/login', '/forgot-password', '/join', '/claim', '/r/'];
const DAY = 24 * 60 * 60 * 1000;

export function LastCallNotice() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const quiet = QUIET.some((p) => pathname.startsWith(p));
  const checked = useRef(false);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [kind, setKind] = useState<NoticeKind | null>(null);
  // the circle that registration opens for next: the month after this one
  const [nextMonth, setNextMonth] = useState(1);

  useEffect(() => {
    if (quiet || checked.current) return;
    checked.current = true;
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

      // The final day is for corrections and does not score, so the day before
      // it is the last one to read for. The final day wins if a short round ends
      // on its own deadline day: logging the month is the more urgent of the two.
      const lastReadingDay = lastDay - 1;
      let next: NoticeKind | null = null;
      if (today === lastDay) {
        next = isParticipant ? 'lastCall' : 'lastCallOut';
      } else if (today === lastReadingDay && lastReadingDay >= (r.start_day ?? 1)) {
        next = isParticipant ? 'lastReading' : 'lastReadingOut';
      } else if (today === r.registration_open_until_day && r.status === 'registration_open') {
        // «Last day to leave» is for those who have read with the circle for
        // days, not for someone who took their place a minute ago.
        const at = data.participation?.joined_at;
        const joinedAt = at ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : `${at}Z`) : 0;
        const justJoined = isParticipant && now.getTime() - joinedAt < DAY;
        next = justJoined ? null : isParticipant ? 'deadlineStay' : 'deadlineJoin';
      }
      if (!next) return;
      // After 20:00 on the final day the results are out and the next circle is open: nothing left to warn about.
      const cutoff = data.correction_deadline_utc ? Date.parse(data.correction_deadline_utc) : NaN;
      if ((next === 'lastCall' || next === 'lastCallOut') && now.getTime() >= cutoff) return;

      setRoundId(r.id);
      setNextMonth((r.month % 12) + 1);
      if (localStorage.getItem(dismissKey(next, r.id)) !== '1') setKind(next);
    });
    return () => { cancelled = true; };
  }, [quiet]);

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

  if (!kind || quiet) return null;

  const notice = NOTICES[kind];

  return createPortal(
    <div className={styles.overlay} onClick={close} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.icon} aria-hidden="true"><Icon name={notice.icon} size="em" /></div>
        <div className={styles.title}>{t(notice.title)}</div>
        <p className={styles.text}>{t(notice.body, { month: t(`month.${nextMonth}`) })}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cta}
            onClick={async () => {
              // «Записаться в круг» on the last day of sign-up should do just
              // that, not open a page with a second button to find.
              if (kind === 'deadlineJoin' && roundId) {
                const { error } = await apiPost(`/rounds/${roundId}/join`, {}, { requireAuth: true });
                if (!error) track('round_join', { via: 'deadline_notice' });
              }
              close();
              navigate('/round');
            }}
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
