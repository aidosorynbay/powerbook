import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiGet, useAuth, useI18n, type MyClaim } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import styles from './ArchivePrompt.module.css';

/** Where the answer is kept: "no" for good; "yes" or "later" with the day, to ask once more if nothing came of it. */
const key = (userId: string) => `pb.archiveAsk.${userId}`;
const DAY = 24 * 60 * 60 * 1000;
const AGAIN_AFTER_YES = 7 * DAY;
const AGAIN_AFTER_LATER = DAY;
// Pages that are already about this, or where a dialog would be in the way.
const QUIET = ['/insights', '/claim', '/login', '/register', '/join', '/forgot-password'];

function read(userId: string): { a: string; at: number } | null {
  try {
    const raw = localStorage.getItem(key(userId));
    return raw ? (JSON.parse(raw) as { a: string; at: number }) : null;
  } catch {
    return null;
  }
}

function write(userId: string, a: 'yes' | 'no' | 'later') {
  try {
    localStorage.setItem(key(userId), JSON.stringify({ a, at: Date.now() }));
  } catch {
    /* storage blocked: the question may come back */
  }
}

/**
 * "Вы раньше участвовали в кругах?" — asked once of a reader whose profile has no archive behind it
 * (no claim approved or waiting). «Да» goes to the profile's archive section to find their old nickname.
 */
export function ArchivePrompt() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user || QUIET.some((p) => pathname.startsWith(p))) return;
    const prev = read(user.id);
    if (prev?.a === 'no') return;
    if (prev && Date.now() - prev.at < (prev.a === 'yes' ? AGAIN_AFTER_YES : AGAIN_AFTER_LATER)) return;
    // Someone who signed up minutes ago has just been through the archive step of sign-up.
    if (Date.now() - Date.parse(user.created_at) < 15 * 60 * 1000) return;

    let cancelled = false;
    let timer = 0;
    apiGet<MyClaim[]>('/claims/mine', { requireAuth: true }).then(({ data }) => {
      if (cancelled || !data) return;
      if (data.some((c) => c.status === 'approved' || c.status === 'pending')) return;
      // Wait for the page's own dialogs (the round notices, the invitation) to be closed first.
      let tries = 0;
      const attempt = () => {
        if (cancelled) return;
        if (document.querySelector('[role="dialog"]') && tries++ < 40) {
          timer = window.setTimeout(attempt, 1500);
          return;
        }
        if (!document.querySelector('[role="dialog"]')) setOpen(true);
      };
      timer = window.setTimeout(attempt, 2200);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [user, pathname]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && later();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  });

  if (!open || !user) return null;

  const yes = () => {
    write(user.id, 'yes');
    setOpen(false);
    navigate('/insights#claim');
  };
  const no = () => {
    write(user.id, 'no');
    setOpen(false);
  };
  const later = () => {
    write(user.id, 'later');
    setOpen(false);
  };

  return (
    <div className={styles.overlay} onClick={later} role="dialog" aria-modal="true" aria-labelledby="archive-ask-title">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.close} onClick={later} aria-label={t('archiveAsk.later')}>
          ×
        </button>
        <span className={styles.mark} aria-hidden="true">
          <Icon name="refresh" size="lg" />
        </span>
        <h2 id="archive-ask-title" className={styles.title}>
          {t('archiveAsk.title')}
        </h2>
        <p className={styles.text}>{t('archiveAsk.text')}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.yes} onClick={yes}>
            {t('archiveAsk.yes')}
          </button>
          <button type="button" className={styles.no} onClick={no}>
            {t('archiveAsk.no')}
          </button>
        </div>
      </div>
    </div>
  );
}
