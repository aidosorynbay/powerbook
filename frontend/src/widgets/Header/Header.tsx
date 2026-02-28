import { Link } from 'react-router-dom';
import { useAuth, useI18n, LOCALES } from '@/shared/lib';
import { Logo, Button, Icon, Container } from '@/shared/ui';
import styles from './Header.module.css';

interface HeaderProps {
  onRegisterClick?: () => void;
  onLoginClick?: () => void;
}

export function Header({ onRegisterClick, onLoginClick }: HeaderProps) {
  const { isAuthenticated, logout } = useAuth();
  const { t, locale, setLocale } = useI18n();

  return (
    <header className={styles.header}>
      <Container>
        <div className={styles.inner}>
          <Logo size="md" />

          <nav className={styles.nav}>
            {isAuthenticated && (
              <>
                <Link to="/round" className={styles.navLink}>{t('header.currentRound')}</Link>
                <Link to="/archive" className={styles.navLink}>{t('header.archive')}</Link>
                <Link to="/results" className={styles.navLink}>{t('header.results')}</Link>
              </>
            )}
            <a href="#about" className={styles.navLink}>{t('header.about')}</a>
            <a href="https://t.me/+ZSmueLtmT8Y1MDBi" className={styles.navLink} target="_blank" rel="noopener noreferrer">
              <Icon name="telegram" size="sm" />
            </a>
          </nav>

          <div className={styles.actions}>
            <div className={styles.langSwitcher}>
              {LOCALES.map((loc) => (
                <button
                  key={loc.code}
                  className={`${styles.langBtn} ${locale === loc.code ? styles.langActive : ''}`}
                  onClick={() => setLocale(loc.code)}
                >
                  {loc.label}
                </button>
              ))}
            </div>

            {isAuthenticated ? (
              <>
              <Link to="/profile" className={styles.loginBtn}>
                {t('profile.title')}
              </Link>
              <button className={styles.loginBtn} onClick={logout}>
                {t('header.logout')}
              </button>
              </>
            ) : (
              <>
                <button className={styles.loginBtn} onClick={onLoginClick}>
                  {t('header.login')}
                </button>
                <Button variant="primary" size="sm" onClick={onRegisterClick}>
                  {t('header.register')}
                </Button>
              </>
            )}
          </div>
        </div>
      </Container>
    </header>
  );
}
