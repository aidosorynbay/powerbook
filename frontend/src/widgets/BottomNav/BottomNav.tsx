import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import styles from './BottomNav.module.css';

// The shared library, the market and the reading recap live under the
// library's tab; the tab stays lit on all of them.
const tabs = [
  { path: '/round', icon: 'clock' as const, label: 'nav.round', also: [] as string[] },
  { path: '/archive', icon: 'refresh' as const, label: 'nav.archive', also: [] },
  { path: '/results', icon: 'check' as const, label: 'nav.results', also: [] },
  { path: '/insights', icon: 'user' as const, label: 'nav.profile', also: [] },
  { path: '/library', icon: 'book' as const, label: 'nav.library', also: ['/books', '/market', '/reading'] },
];

export function BottomNav() {
  const { t } = useI18n();
  const location = useLocation();
  return (
    <nav className={styles.bottomNav} data-bottom-nav>
      {tabs.map(({ path, icon, label, also }) => {
        const isActive = [path, ...also].some(
          (p) => location.pathname === p || location.pathname.startsWith(`${p}/`)
        );
        return (
          <Link
            key={path}
            to={path}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
          >
            <Icon name={icon} size="sm" />
            <span className={styles.tabLabel}>{t(label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
