import { useCallback, useEffect, useRef, useState } from 'react';
import {
  apiGet,
  apiPost,
  apiPut,
  disablePush,
  enablePush,
  hasSubscription,
  localTimeZone,
  pushPermission,
  pushSupport,
  track,
  useI18n,
} from '@/shared/lib';
import { Button } from '@/shared/ui';
import { InstallSheet } from '@/widgets/InstallGuide';
import styles from './ReadingReminder.module.css';

type Reminder = { enabled: boolean; hour: number; minute: number; tz: string; locale: string; note: string | null; subscriptions: number };

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * «Напоминание о чтении» on the round page: one switch and one time.
 *
 * The reader picks the moment that suits their day (the bus at ten, the
 * evening at nine); the server sends one push at that moment, in their
 * zone, only on a day whose minutes are not in yet. On an iPhone this
 * works from the app on the home screen only, so Safari gets the install
 * guide instead of a switch that could not work.
 */
export type ReminderState = { on: boolean; time: string | null; support: 'ok' | 'needs_install' | 'unsupported'; denied: boolean; loaded: boolean };

/** Habit moments to start from: a tap fills the time (the founder's «в автобусе в 10 утра»). */
const PRESETS = [
  { key: 'reminder.presetMorning', h: 8, m: 0 },
  { key: 'reminder.presetRoad', h: 10, m: 0 },
  { key: 'reminder.presetNight', h: 22, m: 30 },
] as const;

export function ReadingReminder({ onState, source = 'card', bare = false }: { onState?: (s: ReminderState) => void; source?: string; bare?: boolean } = {}) {
  const { t, locale } = useI18n();
  const support = pushSupport();
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [install, setInstall] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    void apiGet<Reminder>('/push/reminder', { requireAuth: true }).then(({ data }) => {
      if (alive && data) setReminder(data);
    });
    void hasSubscription().then((has) => {
      if (alive) setSubscribed(has);
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(
    async (next: Partial<Reminder>) => {
      const base = reminder ?? { enabled: false, hour: 21, minute: 0, tz: localTimeZone(), locale, note: null, subscriptions: 0 };
      const body = { ...base, ...next, tz: localTimeZone(), locale };
      const { data, error } = await apiPut<Reminder>('/push/reminder', body, { requireAuth: true });
      if (data) setReminder(data);
      if (error) setNote(t('reminder.error'));
      return !error;
    },
    [reminder, locale, t],
  );

  const on = Boolean(reminder?.enabled && subscribed);
  const deniedNow = support === 'ok' && pushPermission() === 'denied';
  const time = reminder ? `${pad(reminder.hour)}:${pad(reminder.minute)}` : null;
  useEffect(() => {
    onState?.({ on, time, support, denied: deniedNow, loaded: reminder !== null });
  }, [on, time, support, deniedNow, reminder, onState]);

  if (support === 'unsupported') return null;

  const turnOn = async () => {
    setBusy(true);
    setNote(null);
    const result = await enablePush();
    track('reminder_enable', { result });
    if (result === 'granted') {
      track('reminder_enabled', { source });
      setSubscribed(true);
      await save({ enabled: true });
      setNote(t('reminder.saved'));
    } else if (result === 'denied') {
      setNote(t('reminder.denied'));
    } else {
      setNote(t('reminder.error'));
    }
    setBusy(false);
  };

  const turnOff = async () => {
    setBusy(true);
    track('reminder_disable');
    await save({ enabled: false });
    await disablePush();
    setSubscribed(false);
    setNote(null);
    setBusy(false);
  };

  const changeTime = (value: string) => {
    const [h, m] = value.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    setReminder((prev) => (prev ? { ...prev, hour: h, minute: m } : prev));
    // The picker fires on every scroll of the wheel; the server hears the final value.
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      track('reminder_time', { hour: h });
      void save({ hour: h, minute: m, enabled: true }).then((ok) => ok && setNote(t('reminder.saved')));
    }, 600);
  };

  const changeNote = (value: string) => {
    setReminder((prev) => (prev ? { ...prev, note: value } : prev));
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      track('reminder_note', { length: value.trim().length });
      void save({ note: value.trim() || null, enabled: true }).then((ok) => ok && setNote(t('reminder.saved')));
    }, 800);
  };

  const sendTest = async () => {
    setBusy(true);
    const { data } = await apiPost<{ sent: number }>('/push/test', {}, { requireAuth: true });
    track('push_test', { sent: data?.sent ?? 0 });
    setNote(data && data.sent > 0 ? t('reminder.testSent') : t('reminder.error'));
    setBusy(false);
  };

  const denied = support === 'ok' && pushPermission() === 'denied';

  return (
    <section className={bare ? styles.bare : styles.card} aria-labelledby="reading-reminder-title">
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
            <path d="M10 20a2 2 0 0 0 4 0" />
          </svg>
        </span>
        <div className={styles.text}>
          <h3 id="reading-reminder-title" className={styles.title}>
            {t('reminder.title')}
          </h3>
          <p className={styles.lead}>{t('reminder.lead')}</p>
        </div>
        {support === 'ok' && !denied && (
          <input
            type="checkbox"
            role="switch"
            className={styles.switch}
            aria-label={t('reminder.title')}
            checked={on}
            disabled={busy || reminder === null}
            onChange={(e) => (e.target.checked ? void turnOn() : void turnOff())}
          />
        )}
      </div>

      {support === 'needs_install' && (
        <div className={styles.row}>
          <p className={styles.note}>{t('reminder.needsInstall')}</p>
          <Button size="sm" onClick={() => setInstall(true)}>
            {t('reminder.install')}
          </Button>
          <InstallSheet open={install} onClose={() => setInstall(false)} source="reminder" />
        </div>
      )}

      {denied && <p className={styles.note}>{t('reminder.denied')}</p>}

      {support === 'ok' && !denied && on && reminder && (
        <div className={styles.body}>
          <p className={styles.howTo}>{t('reminder.howTo')}</p>
          <div className={styles.row}>
            <label className={styles.time}>
              <span>{t('reminder.timeLabel')}</span>
              <input type="time" value={`${pad(reminder.hour)}:${pad(reminder.minute)}`} onChange={(e) => changeTime(e.target.value)} />
            </label>
            <span className={styles.tz}>{t('reminder.tzNote', { tz: localTimeZone().replace('_', ' ') })}</span>
          </div>
          <div className={styles.presets}>
            {PRESETS.map((p) => {
              const v = `${pad(p.h)}:${pad(p.m)}`;
              return (
                <button key={p.key} type="button" className={`${styles.preset} ${time === v ? styles.presetOn : ''}`} onClick={() => changeTime(v)}>
                  {t(p.key)} · {v}
                </button>
              );
            })}
          </div>
          <label className={styles.noteField}>
            <span>{t('reminder.noteLabel')}</span>
            <textarea
              rows={2}
              maxLength={200}
              value={reminder.note ?? ''}
              placeholder={t('reminder.notePlaceholder')}
              onChange={(e) => changeNote(e.target.value)}
            />
            <small>{t('reminder.noteHint')}</small>
          </label>
          <button type="button" className={styles.link} onClick={sendTest} disabled={busy}>
            {t('reminder.test')}
          </button>
        </div>
      )}

      {note && (
        <p className={styles.note} role="status">
          {note}
        </p>
      )}
    </section>
  );
}
