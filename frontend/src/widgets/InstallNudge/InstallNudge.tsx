import { useEffect, useState } from 'react';
import { track, useI18n } from '@/shared/lib';
import { useInstall } from '@/shared/hooks';
import { Button } from '@/shared/ui';
import { InstallSheet } from '@/widgets/InstallGuide';
import styles from './InstallNudge.module.css';

const SNOOZE_KEY = 'pb.install.nudge.until';
const SNOOZE_DAYS = 14;

function snoozed(): boolean {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
}

/**
 * On the round page, for a member on a phone who still opens PowerBook in
 * a browser: put it on the home screen. «Позже» hides it for two weeks;
 * once the app is installed it is gone for good.
 */
export function InstallNudge() {
  const { t } = useI18n();
  const { state, env } = useInstall();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(snoozed);

  const show = !hidden && env.mobile && state !== 'installed';

  useEffect(() => {
    if (show) track('install_nudge_shown', { state });
    // Once per page, for the state it appeared in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (!show) return null;

  const later = () => {
    track('install_nudge_dismiss');
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86_400_000));
    } catch {
      /* storage blocked: it comes back next time, which is fine */
    }
    setHidden(true);
  };

  return (
    <>
      <div className={styles.card}>
        <span className={styles.icon} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
            <path d="M12 8v6M9 11h6" />
          </svg>
        </span>
        <div className={styles.text}>
          <strong className={styles.title}>{t('install.nudge.title')}</strong>
          <p className={styles.lead}>{t('install.nudge.text')}</p>
          <div className={styles.actions}>
            <Button
              size="sm"
              onClick={() => {
                track('install_nudge_click', { state });
                setOpen(true);
              }}
            >
              {t('install.button')}
            </Button>
            <button type="button" className={styles.later} onClick={later}>
              {t('install.nudge.later')}
            </button>
          </div>
        </div>
      </div>
      <InstallSheet open={open} onClose={() => setOpen(false)} source="nudge" />
    </>
  );
}
