import { useEffect, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { track, useAuth, useI18n } from '@/shared/lib';
import { Button, Icon, type IconName } from '@/shared/ui';
import { Sheet } from '@/widgets/RoundToday';
import rt from '@/widgets/RoundToday/RoundToday.module.css';
import styles from './WhatsNew.module.css';

const KEY = 'pb.nav2.seen';
// the four places came at 2bd0db5 (2026-10-15 13:59 Astana): who joined after never knew the old menu
const CUTOVER = Date.parse('2026-10-15T09:00:00Z');

// The old places, each falling into the tab that holds it now (the film in the sheet).
const TABS: { icon: IconName; label: string; old: string[] }[] = [
  { icon: 'clock', label: 'nav.round', old: [] },
  { icon: 'calendar', label: 'nav2.results', old: ['header.archive', 'header.results', 'nav.hallOfFame'] },
  { icon: 'user', label: 'nav.profile', old: ['nav.settings', 'wn.old.theme'] },
  { icon: 'book', label: 'nav.library', old: ['wn.old.market'] },
];

/** The real bars (top on computers, bottom on phones) light their four tabs one by one, once. */
function flashTabs() {
  const html = document.documentElement;
  html.removeAttribute('data-nav-new');
  void html.offsetWidth; // restart the animation if it is already running
  html.setAttribute('data-nav-new', '');
  window.setTimeout(() => html.removeAttribute('data-nav-new'), 2600);
}

/**
 * Once, for members who knew the old places: the old names fall into the four tabs that hold them now, then four
 * lines on where everything went (2026-10-14). The bell's «Обновление» (site_update) opens it again
 * (?whatsnew=1). «Понятно» closes it for good, and the real tabs light up so the eye finds them.
 */
export function WhatsNew() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { search, pathname } = useLocation();
  const navigate = useNavigate();
  const asked = new URLSearchParams(search).has('whatsnew');
  const [film, setFilm] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (asked) {
      setOpen(true);
      track('whats_new_open', { source: 'bell' });
      return;
    }
    if (!user) return;
    let seen = true;
    try {
      seen = localStorage.getItem(KEY) === '1';
    } catch {
      // storage blocked: say nothing rather than every visit
    }
    if (!seen && Date.parse(user.created_at) < CUTOVER) setOpen(true);
  }, [asked, user]);

  const close = () => {
    setOpen(false);
    track('whats_new_ok', {});
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // storage blocked: it may come back next visit, and that is all
    }
    if (asked) {
      const q = new URLSearchParams(search);
      q.delete('whatsnew');
      navigate({ pathname, search: q.toString() ? `?${q}` : '' }, { replace: true });
    }
    // after the sheet has gone, so the eye goes straight to the bar
    window.setTimeout(flashTabs, 180);
  };

  return (
    <Sheet open={open} onClose={close} label={t('wn.title')}>
      <span className={styles.badge}>
        <Icon name="sparkle" size="em" aria-hidden="true" />
        {t('wn.badge')}
      </span>
      <h3 className={rt.sheetTitle}>{t('wn.title')}</h3>
      <p className={rt.sheetLead}>{t('wn.lead')}</p>

      <div className={styles.film} key={film} aria-hidden="true">
        {TABS.map((tab, i) => (
          <div key={tab.label} className={styles.col} style={{ '--i': i } as CSSProperties}>
            <div className={styles.olds}>
              {tab.old.map((o, j) => (
                <span key={o} className={styles.old} style={{ '--j': j } as CSSProperties}>
                  {t(o)}
                </span>
              ))}
            </div>
            <div className={styles.tab}>
              <Icon name={tab.icon} size="sm" />
              <span>{t(tab.label)}</span>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className={styles.again} onClick={() => { setFilm((f) => f + 1); track('whats_new_again', {}); }}>
        {t('wn.again')}
      </button>

      <ul className={styles.list}>
        {[1, 2, 3, 4].map((n) => (
          <li key={n}>{t(`wn.${n}`)}</li>
        ))}
      </ul>
      <Button fullWidth onClick={close}>{t('wn.ok')}</Button>
    </Sheet>
  );
}
