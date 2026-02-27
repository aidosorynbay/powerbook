import { Link, useLocation } from 'react-router-dom';
import { useAuth, useI18n } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import styles from './BottomNav.module.css';

const tabs = [
  { path: '/round', icon: 'clock' as const, label: 'nav.round' },
  { path: '/archive', icon: 'refresh' as const, label: 'nav.archive' },
  { path: '/results', icon: 'check' as const, label: 'nav.results' },
];

export function BottomNav() {
  const { isAuthenticated } = useAuth();
  const { t } = useI18n();
  const location = useLocation();

  if (!isAuthenticated) return null;

  return (
    <nav className={styles.bottomNav}>
      {tabs.map(({ path, icon, label }) => {
        const isActive = location.pathname === path;
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
