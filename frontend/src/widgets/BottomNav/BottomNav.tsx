import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import styles from './BottomNav.module.css';

const tabs = [
  { path: '/round', icon: 'clock' as const, label: 'nav.round' },
  { path: '/archive', icon: 'refresh' as const, label: 'nav.archive' },
  { path: '/results', icon: 'check' as const, label: 'nav.results' },
  { path: '/insights', icon: 'user' as const, label: 'nav.profile' },
  { path: '/library', icon: 'book' as const, label: 'nav.library' },
];

export function BottomNav() {
  const { t } = useI18n();
  const location = useLocation();
  // The bookcase is a light room; a dark bar under it would cut it in half.
  const onShelf = location.pathname === '/library' || /^\/readers\/[^/]+\/shelf$/.test(location.pathname);

  return (
    <nav className={`${styles.bottomNav} ${onShelf ? styles.paper : ''}`}>
      {tabs.map(({ path, icon, label }) => {
        const isActive =
          location.pathname === path || location.pathname.startsWith(`${path}/`);
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
