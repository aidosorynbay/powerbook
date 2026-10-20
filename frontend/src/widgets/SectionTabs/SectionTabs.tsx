import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '@/shared/lib';
import styles from './SectionTabs.module.css';

type Tab = { to: string; label: string; also?: string[]; except?: string[] };

/**
 * The parts of one tab-bar place, side by side as pills — the same pills as «Мой | Круг» on the circle page,
 * so a reader meets one control everywhere. Each part keeps its own address; this only shows where you are.
 */
export function SectionTabs({ tabs, aside, label }: { tabs: Tab[]; aside?: ReactNode; label: string }) {
  const { pathname } = useLocation();
  const under = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  const on = (tab: Tab) => [tab.to, ...(tab.also ?? [])].some(under) && !(tab.except ?? []).some(under);
  return (
    <div className={styles.row}>
      <nav className={styles.tabs} aria-label={label}>
        {tabs.map((tab) => (
          <Link key={tab.to} to={tab.to} className={styles.tab} aria-current={on(tab) ? 'page' : undefined}>
            {tab.label}
          </Link>
        ))}
      </nav>
      {aside && <div className={styles.aside}>{aside}</div>}
    </div>
  );
}

/** «Итоги»: the last circle, every circle by month, the community's records. */
export function HistoryTabs() {
  const { t } = useI18n();
  return (
    <SectionTabs
      label={t('nav2.results')}
      tabs={[
        { to: '/results', label: t('nav2.lastCircle') },
        { to: '/archive', label: t('nav2.history') },
        { to: '/hall-of-fame', label: t('nav2.records') },
      ]}
    />
  );
}

/** «Библиотека»: your shelf and every book PowerBook reads (the bazaar lives with the books); the reading room one tap away
 * (the shelf already shows its own live «Читальный зал» chip, so it passes room={false}). */
export function LibraryTabs({ room = true }: { room?: boolean } = {}) {
  const { t } = useI18n();
  return (
    <SectionTabs
      label={t('nav.library')}
      tabs={[
        { to: '/library', label: t('nav2.myShelf'), except: ['/library/want'] },
        // the second shelf: books to read later, counted nowhere (the founder, 2026-10-21)
        { to: '/library/want', label: t('nav2.want') },
        { to: '/books', label: t('nav2.allBooks'), also: ['/market'] },
      ]}
      aside={
        room ? (
          <Link to="/library/hall" className={styles.asideLink}>
            {t('nav2.readingRoom')} <span aria-hidden="true">›</span>
          </Link>
        ) : undefined
      }
    />
  );
}
