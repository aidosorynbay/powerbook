import { Link, useLocation } from 'react-router-dom';
import { isReaderPath, useAuth, useI18n } from '@/shared/lib';
import { Avatar, Icon } from '@/shared/ui';
import { MEMBER_TABS, isTabActive } from './tabs';
import styles from './BottomNav.module.css';

// Four places, in the order thumbs already know: the circle first, the library at the right edge (where it was).
// Архив, Результаты and Топ became one place, «Итоги»; the profile wears the reader's own picture.
export function BottomNav() {
  const { t } = useI18n();
  const location = useLocation();
  const { isAuthenticated, user } = useAuth();
  // A visitor has none of these yet — every tab would only ask to log in.
  if (!isAuthenticated) return null;
  // An open book has its own bar at the bottom: page turns, the timer, the reading mode.
  if (isReaderPath(location.pathname)) return null;
  return (
    <nav className={styles.bottomNav} data-bottom-nav>
      {MEMBER_TABS.map((tab) => {
        const isActive = isTabActive(location.pathname, tab);
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            aria-current={isActive ? 'page' : undefined}
          >
            {tab.path === '/insights' && user ? (
              <span className={`${styles.face} ${isActive ? styles.faceActive : ''}`}>
                <Avatar src={user.avatar_data} name={user.display_name || user.username} size="sm" />
              </span>
            ) : (
              <Icon name={tab.icon} size="sm" />
            )}
            <span className={styles.tabLabel}>{t(tab.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
