import { useState } from 'react';
import { Link } from 'react-router-dom';
import { track, useAuth, useI18n } from '@/shared/lib';
import { Sheet } from '@/widgets/RoundToday/parts';
import rt from '@/widgets/RoundToday/RoundToday.module.css';
import styles from './Help.module.css';

const TELEGRAM = 'https://t.me/+ZSmueLtmT8Y1MDBi';

// Until it goes out to everyone, the team tries the sheet on their own accounts (the council, 2026-10-15).
const FOR_EVERYONE = false;

export function useHelpOn(): boolean {
  const { user } = useAuth();
  return FOR_EVERYONE || user?.system_role === 'admin' || user?.system_role === 'superadmin';
}

type Question = { key: string; q: string; a: string[]; link?: { to: string; label: string } };

/**
 * «?»: the questions a member has after the rules they skimmed before signing up, answered right here in the words of
 * the front page, then the rules and «О нас» themselves, and people to ask. No AI yet: a list works even when a
 * model is down, and the questions asked here tell what the pages don't (the council, 2026-10-15).
 */
export function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [shown, setShown] = useState<string | null>(null);

  // the places by the names their tabs carry, whatever those become
  const at = { round: t('nav.round'), results: t('nav2.results'), settings: t('nav.settings') };
  const questions: Question[] = [
    { key: 'day', q: t('help.q.day'), a: [t('help.a.day', at)] },
    { key: 'missed', q: t('help.q.missed'), a: [t('ex.a2'), t('help.a.forgot', at)] },
    { key: 'reminder', q: t('help.q.reminder'), a: [t('help.a.reminder', at), t('reminder.needsInstall')], link: { to: '/profile', label: at.settings } },
    { key: 'end', q: t('help.q.end'), a: [t('help.a.end', at)], link: { to: '/results', label: at.results } },
    { key: 'cost', q: t('ex.q1'), a: [t('ex.a1')] },
  ];

  const toggle = (key: string) => {
    setShown((k) => (k === key ? null : key));
    if (shown !== key) track('help_question', { key });
  };
  const went = (key: string) => {
    track('help_link', { key });
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} label={t('help.title')}>
      <h3 className={rt.sheetTitle}>{t('help.title')}</h3>
      <div className={styles.rows}>
        {questions.map((x) => (
          <div key={x.key} className={styles.item}>
            <button type="button" className={styles.row} aria-expanded={shown === x.key} onClick={() => toggle(x.key)}>
              <b>{x.q}</b>
              <span className={`${styles.chev} ${shown === x.key ? styles.chevOpen : ''}`} aria-hidden="true">›</span>
            </button>
            {shown === x.key && (
              <div className={styles.answer}>
                {x.a.map((p) => <p key={p}>{p}</p>)}
                {x.link && (
                  <Link to={x.link.to} className={styles.answerLink} onClick={() => went(`${x.key}_link`)}>
                    {x.link.label} ›
                  </Link>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <nav className={styles.rows} aria-label={t('help.more')}>
        <Link to="/welcome#powerbook" className={styles.row} onClick={() => went('rules')}>
          <b>{t('help.rules')}</b>
          <span className={styles.chev} aria-hidden="true">›</span>
        </Link>
        <Link to="/about" className={styles.row} onClick={() => went('about')}>
          <b>{t('nav.about')}</b>
          <span className={styles.chev} aria-hidden="true">›</span>
        </Link>
        <a href={TELEGRAM} target="_blank" rel="noopener noreferrer" className={styles.row} onClick={() => went('chat')}>
          <b>{t('help.chat')}</b>
          <span className={styles.chev} aria-hidden="true">↗</span>
        </a>
      </nav>
      <button type="button" className={`${rt.sheetClose} ${rt.closeBtn}`} onClick={onClose}>{t('dial.coachOk')}</button>
    </Sheet>
  );
}

/** The «?» beside the bell. */
export function HelpButton() {
  const { t } = useI18n();
  const on = useHelpOn();
  const [open, setOpen] = useState(false);
  if (!on) return null;
  return (
    <>
      <button
        type="button"
        className={styles.button}
        onClick={() => {
          setOpen(true);
          track('help_open', { from: 'header' });
        }}
        aria-label={t('help.title')}
        title={t('help.title')}
      >
        ?
      </button>
      <HelpSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
