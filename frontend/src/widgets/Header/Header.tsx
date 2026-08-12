import { Link } from 'react-router-dom';
import { useAuth, useI18n, LOCALES } from '@/shared/lib';
import { Logo, Button, Icon, Container } from '@/shared/ui';
import styles from './Header.module.css';

interface HeaderProps {
  onRegisterClick?: () => void;
  onLoginClick?: () => void;
}

export function Header({ onRegisterClick, onLoginClick }: HeaderProps) {
  const { isAuthenticated, user } = useAuth();
  const isAdmin = user?.system_role === 'admin' || user?.system_role === 'superadmin';
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
                <Link to="/insights" className={styles.navLink}>{t('nav.insights')}</Link>
                <Link to="/readers" className={styles.navLink}>{t('header.directory')}</Link>
              </>
            )}
            <Link to="/hall-of-fame" className={styles.navLink}>{t('header.hallOfFame')}</Link>
            <a href="https://t.me/+ZSmueLtmT8Y1MDBi" className={styles.navLink} target="_blank" rel="noopener noreferrer">
              <Icon name="telegram" size="sm" />
            </a>
          </nav>

          <div className={styles.actions}>
            <Link
              to={isAdmin ? '/suggestions/admin' : '/suggestions'}
              className={styles.suggestionsBtn}
              aria-label={isAdmin ? t('suggestionsAdmin.navLink') : t('suggestions.navCta')}
            >
              <span aria-hidden="true">💡</span>
              <span className={styles.suggestionsBtnText}>
                {isAdmin ? t('suggestionsAdmin.navLink') : t('suggestions.navCtaShort')}
              </span>
            </Link>

            <select
              className={styles.langSelect}
              value={locale}
              onChange={(e) => setLocale(e.target.value as typeof locale)}
              aria-label="Language"
            >
              {LOCALES.map((loc) => (
                <option key={loc.code} value={loc.code}>
                  {loc.label}
                </option>
              ))}
            </select>

            {isAuthenticated ? (
              <Link to="/profile" className={styles.loginBtn}>
                {t('profile.title')}
              </Link>
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
