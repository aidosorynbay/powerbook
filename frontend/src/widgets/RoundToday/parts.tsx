import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getApiBaseUrl, track, useI18n } from '@/shared/lib';
import type { CalendarDay, LeaderboardEntry, RosterEntry } from '@/shared/lib';
import { ReadingReminder, type ReminderState } from '@/widgets/ReadingReminder';
import { usePulse, type PulsePhase } from './pulse';
import styles from './RoundToday.module.css';

export const pulseClass = (p: PulsePhase) =>
  p === 'fast' ? `${styles.pulse} ${styles.pulseFast}` : p === 'slow' ? `${styles.pulse} ${styles.pulseSlow}` : p === 'dot' ? `${styles.pulse} ${styles.pulseDot}` : '';

/** A sheet from the bottom of the screen; a tap beside it or Escape closes it. */
export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className={styles.sheetBack} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={label}>
        <div className={styles.grip} />
        {children}
      </div>
    </div>,
    document.body,
  );
}

const AlarmIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2 2" />
    <path d="M5 3 2 6" />
    <path d="m22 6-3-3" />
  </svg>
);

/**
 * The reminder beside the book: its time, or «Напомнить?» while there is
 * none. It pulses for the first visits of a circle until it is found
 * (never for readers whose reminder is on, nor where pushes cannot work).
 */
export function ReminderChip({ roundKey, userId, compact = false }: { roundKey: string; userId?: string; compact?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ReminderState | null>(null);
  const eligible = !!state && state.loaded && !state.on && state.support !== 'unsupported' && !state.denied;
  const { phase, found } = usePulse({ el: 'reminder_chip', storeKey: `pb.pulse2.rem.${roundKey}`, eligible, userId, visits: 3 });
  if (state?.support === 'unsupported') return null;
  const on = !!state?.on;
  return (
    <>
      <button
        type="button"
        className={`${styles.chip} ${compact ? styles.chipCompact : ''} ${on ? '' : styles.chipOff} ${pulseClass(phase)}`}
        title={t('reminder.title')}
        onClick={() => {
          found(false);
          setOpen(true);
          track('reminder_sheet_open', { on });
        }}
        aria-label={t('reminder.title')}
      >
        <AlarmIcon />
        {on && state?.time ? state.time : compact ? null : t('today.remindAsk')}
      </button>
      {open ? (
        <Sheet open onClose={() => setOpen(false)} label={t('reminder.title')}>
          <ReadingReminder bare source="chip" onState={setState} />
          <button type="button" className={`${styles.sheetClose} ${styles.closeBtn}`} onClick={() => setOpen(false)}>
            {t('today.done')}
          </button>
        </Sheet>
      ) : (
        /* out of sight, it reads the reminder for the chip */
        <div hidden>
          <ReadingReminder onState={setState} />
        </div>
      )}
    </>
  );
}

/** A reader's colour, the same every time: warm hues that sit well on both themes. */
function hue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return [14, 28, 40, 160, 190, 210, 260, 330][h % 8];
}

/** «Читатели круга»: everyone of the circle, the most days first, without places; a tap shows their calendar. */
export function ReadersSheet({
  open,
  onClose,
  leaderboard,
  today,
  userId,
  dayOfRound,
  onPick,
  leave,
}: {
  open: boolean;
  onClose: () => void;
  leaderboard: LeaderboardEntry[];
  today: RosterEntry[];
  userId?: string;
  dayOfRound: number;
  onPick: (id: string, name: string) => void;
  /** While leaving is allowed: the link at the foot of the list. */
  leave?: { until: number | null; onLeave: () => void };
}) {
  const { t } = useI18n();
  const todayBy = useMemo(() => new Map(today.map((e) => [e.user_id, e.minutes])), [today]);
  const readToday = today.filter((e) => e.minutes > 0).length;
  const doneToday = today.filter((e) => e.minutes >= 30).length;
  const days = Math.max(1, dayOfRound);
  return (
    <Sheet open={open} onClose={onClose} label={t('readers.title')}>
      <h3 className={styles.sheetTitle}>{t('readers.title')}</h3>
      <div className={styles.readersStats}>
        <span><b>{leaderboard.length}</b>{t('readers.inCircle')}</span>
        <span><b>{readToday}</b>{t('readers.todayRead')}</span>
        <span className={styles.rsDone}><b>{doneToday}</b>{t('readers.todayCounted')}</span>
      </div>
      <ul className={styles.readers}>
        {leaderboard.map((e) => {
          const m = todayBy.get(e.user_id) ?? 0;
          const me = e.user_id === userId;
          const h = hue(e.user_id);
          return (
            <li
              key={e.user_id}
              className={me ? styles.me : ''}
              onClick={() => {
                onPick(e.user_id, e.display_name);
                onClose();
              }}
            >
              <span className={styles.av} style={{ background: `hsl(${h} 70% 55% / .18)`, color: `hsl(${h} 75% 62%)` }}>
                {e.avatar ? (
                  <img src={`${getApiBaseUrl()}/social/avatar/${e.user_id}?v=${e.avatar}`} alt="" loading="lazy" />
                ) : (
                  (e.display_name || '?').trim().charAt(0).toUpperCase()
                )}
              </span>
              <span className={styles.rn}>
                <span className={styles.tg}>
                  {e.display_name}
                  {me ? ` ${t('readers.you')}` : ''}
                </span>
                <span className={`${styles.st} ${m >= 30 ? styles.stDone : m > 0 ? styles.stSome : ''}`}>
                  {m >= 30 ? t('readers.todayDone', { n: m }) : m > 0 ? t('readers.todaySome', { n: m }) : t('readers.todayNone')}
                </span>
              </span>
              <span className={styles.rd}>
                <b>{e.total_score}</b>
                <small>{t('readers.ofDays', { n: days })}</small>
                <i className={styles.rdBar}><i style={{ width: `${Math.min(100, (e.total_score / days) * 100)}%` }} /></i>
              </span>
            </li>
          );
        })}
      </ul>
      <button type="button" className={`${styles.sheetClose} ${styles.closeBtn}`} onClick={onClose}>
        {t('today.close')}
      </button>
      {leave && (
        <button type="button" className={styles.leaveLink} onClick={leave.onLeave}>
          {leave.until ? t('member.leaveUntil', { d: leave.until }) : t('member.leave')}
        </button>
      )}
    </Sheet>
  );
}

/** Back after a break: a kind word instead of a row of red (the council, 2026-10-13). */
export function WelcomeBack({ days, todayStr, todayMinutes }: { days: CalendarDay[]; todayStr: string; todayMinutes: number }) {
  const { t } = useI18n();
  const key = `pb.welcome.${todayStr}`;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const past = days.filter((d) => d.date < todayStr && d.in_round !== false).sort((a, b) => a.date.localeCompare(b.date));
  const gap = past.slice(-3);
  const show = !hidden && todayMinutes === 0 && gap.length === 3 && gap.every((d) => d.minutes < 2) && past.some((d) => d.minutes >= 2);
  useEffect(() => {
    if (show) track('welcome_back_shown', { missed: gap.length });
    // once per day shown
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!show) return null;
  return (
    <div className={styles.welcome}>
      <b>{t('today.welcomeTitle')}</b>
      <p>{t('today.welcomeText')}</p>
      <button
        type="button"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(key, '1');
          } catch {
            /* fine */
          }
        }}
      >
        {t('today.close')}
      </button>
    </div>
  );
}
