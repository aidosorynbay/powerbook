import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPut, enablePush, hasSubscription, localTimeZone, pushPermission, pushSupport, track, useI18n } from '@/shared/lib';
import { Button } from '@/shared/ui';
import { InstallSheet } from '@/widgets/InstallGuide';
import { Sheet } from './parts';
import styles from './RoundToday.module.css';

const KEY = 'pb.remindOffer';
const LATER_DAYS = 14;

type Mark = { done?: boolean; until?: number };

function remember(mark: Mark) {
  try {
    localStorage.setItem(KEY, JSON.stringify(mark));
  } catch {
    // storage blocked: it may ask again next visit, and that is all
  }
}

/** The moment the reader saved, to the quarter hour: the reminder comes when today's reading came. */
function sameTimeTomorrow(): { h: number; m: number; label: string } {
  const now = new Date();
  const q = (Math.round((now.getHours() * 60 + now.getMinutes()) / 15) * 15) % (24 * 60);
  const h = Math.floor(q / 60);
  const m = q % 60;
  return { h, m, label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
}

/**
 * Whether to offer the reminder after a saved day: only where a push can arrive (or the app can be put on an
 * iPhone's home screen), never after a «no», never while one is on, and after «Не сейчас» not for two weeks.
 */
export async function reminderOfferDue(): Promise<boolean> {
  const support = pushSupport();
  if (support === 'unsupported') return false;
  if (support === 'ok' && pushPermission() === 'denied') return false;
  try {
    const mark = JSON.parse(localStorage.getItem(KEY) || '{}') as Mark;
    if (mark.done || (mark.until && Date.now() < mark.until)) return false;
  } catch {
    return false;
  }
  if (support === 'ok') {
    const [{ data }, subscribed] = await Promise.all([
      apiGet<{ enabled: boolean }>('/push/reminder', { requireAuth: true }),
      hasSubscription(),
    ]);
    if (data?.enabled && subscribed) {
      remember({ done: true });
      return false;
    }
  }
  return true;
}

/**
 * «Напомнить завтра в 21:45?» — offered once the day is saved, at the time the reader just read: the cue that makes a
 * habit stick is the same moment tomorrow (2026-10-15; 4 of 69 members had found the reminder chip on their own).
 * In Safari on an iPhone a push can only come from the app on the home screen, so there the offer is that.
 */
export function ReminderOffer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const support = pushSupport();
  const [state, setState] = useState<'ask' | 'busy' | 'done' | 'denied' | 'error'>('ask');
  const [install, setInstall] = useState(false);
  const [{ h, m, label }] = useState(sameTimeTomorrow);

  const later = () => {
    remember({ until: Date.now() + LATER_DAYS * 864e5 });
    track('reminder_offer', { action: 'later', support });
    onClose();
  };

  const accept = async () => {
    setState('busy');
    const result = await enablePush();
    track('reminder_enable', { result, source: 'offer' });
    if (result === 'granted') {
      const { error } = await apiPut('/push/reminder', { enabled: true, hour: h, minute: m, tz: localTimeZone(), locale, note: null }, { requireAuth: true });
      if (error) {
        setState('error');
        return;
      }
      track('reminder_enabled', { source: 'offer' });
      remember({ done: true });
      setState('done');
      window.setTimeout(onClose, 1800);
    } else if (result === 'denied') {
      remember({ done: true });
      setState('denied');
    } else {
      setState('error');
    }
  };

  if (support === 'needs_install') {
    return (
      <Sheet open={open} onClose={later} label={t('offer.installTitle')}>
        <h3 className={styles.sheetTitle}>{t('offer.installTitle')}</h3>
        <p className={styles.sheetLead}>{t('reminder.needsInstall')}</p>
        <div className={styles.offerActions}>
          <Button fullWidth onClick={() => { track('reminder_offer', { action: 'install' }); setInstall(true); }}>{t('reminder.install')}</Button>
          <button type="button" className={styles.offerLater} onClick={later}>{t('offer.later')}</button>
        </div>
        <InstallSheet open={install} onClose={() => { setInstall(false); later(); }} source="reminder_offer" />
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={state === 'done' ? onClose : later} label={t('offer.title', { time: label })}>
      {state === 'done' ? (
        <h3 className={styles.sheetTitle} role="status">{t('offer.done', { time: label })}</h3>
      ) : (
        <>
          <h3 className={styles.sheetTitle}>{t('offer.title', { time: label })}</h3>
          <p className={styles.sheetLead}>{t('offer.lead')}</p>
          {state === 'denied' && <p className={styles.offerNote}>{t('reminder.denied')}</p>}
          {state === 'error' && <p className={styles.offerNote}>{t('reminder.error')}</p>}
          <div className={styles.offerActions}>
            {state !== 'denied' && (
              <Button fullWidth onClick={accept} disabled={state === 'busy'}>{t('offer.yes', { time: label })}</Button>
            )}
            <Link to="/profile" className={styles.offerOther} onClick={() => track('reminder_offer', { action: 'other_time' })}>
              {t('offer.other')}
            </Link>
            <button type="button" className={styles.offerLater} onClick={later}>{t('offer.later')}</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
