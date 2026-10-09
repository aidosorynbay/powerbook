import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiGet, apiPost, track, useAuth, useI18n, type ClaimCandidate, type ClaimSuggestions, type MyClaim } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import { circlesLine } from '@/widgets/ClaimPicker/circles';
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
 *
 * When the archive holds names like the reader's own (Сайра / Saira, @saira_k), the question is
 * «Это вы?» with those names, and one tap sends the request. A reader whose circles already came
 * with the import, and who looks like no other archive name, is not asked at all.
 */
export function ArchivePrompt() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [suggested, setSuggested] = useState<ClaimCandidate[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || QUIET.some((p) => pathname.startsWith(p))) return;
    const prev = read(user.id);
    if (prev?.a === 'no') return;
    if (prev && Date.now() - prev.at < (prev.a === 'yes' ? AGAIN_AFTER_YES : AGAIN_AFTER_LATER)) return;
    // Someone who signed up this week has just been through the archive step
    // of sign-up. Fifteen minutes was too short: a newcomer was asked the same
    // question again later in their very first session.
    if (Date.now() - Date.parse(user.created_at) < 7 * DAY) return;

    let cancelled = false;
    let timer = 0;
    Promise.all([
      apiGet<MyClaim[]>('/claims/mine', { requireAuth: true }),
      apiGet<ClaimSuggestions>('/claims/suggestions', { requireAuth: true }),
    ]).then(([{ data }, { data: hints }]) => {
      if (cancelled || !data) return;
      if (data.some((c) => c.status === 'approved' || c.status === 'pending')) return;
      const names = hints?.suggestions ?? [];
      // Their circles came with the import, and no other archive name looks like them.
      if (hints?.has_archive && names.length === 0) return;
      setSuggested(names.slice(0, 3));
      // Wait for the page's own dialogs (the round notices, the invitation) to be closed first.
      let tries = 0;
      const attempt = () => {
        if (cancelled) return;
        if (document.querySelector('[role="dialog"]') && tries++ < 40) {
          timer = window.setTimeout(attempt, 1500);
          return;
        }
        if (!document.querySelector('[role="dialog"]')) {
          setOpen(true);
          track('archive_prompt', { answer: 'shown', suggested: names.length });
        }
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
    track('archive_prompt', { answer: 'yes' });
    setOpen(false);
    navigate('/insights#claim');
  };
  const no = () => {
    write(user.id, 'no');
    track('archive_prompt', { answer: 'no' });
    setOpen(false);
  };
  const later = () => {
    if (!sent) {
      write(user.id, 'later');
      track('archive_prompt', { answer: 'later' });
    }
    setOpen(false);
  };
  const itsMe = async (c: ClaimCandidate) => {
    setSending(c.user_id);
    setError(null);
    const { error: err } = await apiPost('/claims', { ghost_user_id: c.user_id }, { requireAuth: true });
    setSending(null);
    if (err) {
      setError(err);
      return;
    }
    write(user.id, 'yes');
    track('archive_prompt', { answer: 'its_me' });
    track('claim_submit', { from: 'prompt' });
    setSent(true);
  };

  if (sent) {
    return (
      <div className={styles.overlay} onClick={later} role="dialog" aria-modal="true" aria-labelledby="archive-ask-title">
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <span className={styles.mark} aria-hidden="true">
            <Icon name="check" size="lg" />
          </span>
          <h2 id="archive-ask-title" className={styles.title}>
            {t('archiveAsk.sentTitle')}
          </h2>
          <p className={styles.text}>{t('archiveAsk.sentText')}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.yes} onClick={later}>
              {t('archiveAsk.ok')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (suggested.length > 0) {
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
            {t('archiveAsk.suggestTitle')}
          </h2>
          <p className={styles.text}>{t('archiveAsk.suggestText')}</p>
          <ul className={styles.names}>
            {suggested.map((c) => (
              <li key={c.user_id} className={styles.name}>
                <div className={styles.nameInfo}>
                  <strong>@{c.username}</strong>
                  {c.display_name && c.display_name !== c.username && <span>{c.display_name}</span>}
                  <small>{circlesLine(c.rounds, locale, t)}</small>
                </div>
                <button type="button" className={styles.itsMe} onClick={() => itsMe(c)} disabled={sending !== null}>
                  {sending === c.user_id ? t('claims.claiming') : t('archiveAsk.itsMe')}
                </button>
              </li>
            ))}
          </ul>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button type="button" className={styles.no} onClick={yes}>
              {t('archiveAsk.otherName')}
            </button>
            <button type="button" className={styles.quiet} onClick={no}>
              {t('archiveAsk.no')}
            </button>
          </div>
        </div>
      </div>
    );
  }

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
