import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth, useI18n, useTheme, LOCALES, type ThemeChoice } from '@/shared/lib';
import { Logo, Button, Icon, Container } from '@/shared/ui';
import styles from './Header.module.css';

// One button, three states: tap to go dark → light → as the system says.
const THEME_ICON: Record<ThemeChoice, JSX.Element> = {
  dark: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </>
  ),
  system: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" />
    </>
  ),
};

function ThemeButton({ className }: { className: string }) {
  const { t } = useI18n();
  const { choice, cycle } = useTheme();
  const label = `${t('theme.label')}: ${t(`theme.${choice}`)}`;
  return (
    <button type="button" className={className} onClick={cycle} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {THEME_ICON[choice]}
      </svg>
    </button>
  );
}

const HINT_KEY = 'pb.menuHintSeen';

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, user } = useAuth();
  const isAdmin = user?.system_role === 'admin' || user?.system_role === 'superadmin';
  const { t, locale, setLocale } = useI18n();

  const [menuOpen, setMenuOpen] = useState(false);
  // The logo-as-menu is an unusual place to look, so first-time visitors get
  // a one-off nudge. Once they've opened it, the hint never comes back.
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    try {
      setShowHint(localStorage.getItem(HINT_KEY) !== '1');
    } catch {
      // private mode / storage blocked — just skip the hint
    }
  }, []);

  const dismissHint = useCallback(() => {
    setShowHint(false);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  const openMenu = useCallback(() => {
    setMenuOpen(o => !o);
    dismissHint();
  }, [dismissHint]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Route change means the user went somewhere — the panel shouldn't linger
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const navLinks = (
    <>
      {isAuthenticated && (
        <>
          <Link to="/round" className={styles.navLink}>{t('nav.round')}</Link>
          <Link to="/archive" className={styles.navLink}>{t('header.archive')}</Link>
          <Link to="/results" className={styles.navLink}>{t('header.results')}</Link>
          <Link to="/insights" className={styles.navLink}>{t('nav.profile')}</Link>
          <Link to="/library" className={styles.navLink}>{t('nav.library')}</Link>
          <Link to="/readers" className={styles.navLink}>{t('header.directory')}</Link>
        </>
      )}
      <Link to="/hall-of-fame" className={styles.navLink}>{t('nav.hallOfFame')}</Link>
      <a
        href="https://t.me/+ZSmueLtmT8Y1MDBi"
        className={`${styles.navLink} ${styles.navTelegram}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon name="telegram" size="sm" />
        <span>{t('header.telegram')}</span>
      </a>
    </>
  );

  return (
    <header className={styles.header}>
      <Container>
        <div className={styles.inner}>
          <div className={styles.brand}>
            {/* Wide screens: the logo does what a logo is expected to do. */}
            <Logo size="md" className={styles.logoDesktop} />

            {/* Narrow screens: the same mark opens the menu. The chevron is
                there so it reads as a control rather than a plain logo. */}
            <button
              type="button"
              className={styles.logoTrigger}
              onClick={openMenu}
              aria-expanded={menuOpen}
              aria-haspopup="true"
              aria-label={t('header.menuHint')}
            >
              <img src="/logo-icon.png" alt="" className={styles.logoTriggerIcon} />
              <span className={styles.logoTriggerText}>PowerBook</span>
              <span className={`${styles.logoChev} ${menuOpen ? styles.logoChevOpen : ''}`} aria-hidden="true">▾</span>
              {showHint && <span className={styles.hintDot} aria-hidden="true" />}
            </button>

            {showHint && !menuOpen && (
              <span className={styles.hintBubble} aria-hidden="true">
                {t('header.menuHint')}
              </span>
            )}

            {menuOpen && (
              <>
                <div className={styles.menuBackdrop} onClick={closeMenu} />
                <nav className={styles.menuPanel}>
                  <Link to="/" className={styles.navLink}>{t('header.home')}</Link>
                  {navLinks}

                  {/* Everything that used to sit on the right of the bar lives
                      here on phones — the row simply has no room for it. */}
                  <div className={styles.menuDivider} />

                  <Link
                    to={isAdmin ? '/suggestions/admin' : '/suggestions'}
                    className={styles.navLink}
                  >
                    <Icon name="bulb" size="sm" />{' '}
                    {isAdmin ? t('suggestionsAdmin.navLink') : t('suggestions.navCtaShort')}
                  </Link>

                  {isAuthenticated ? (
                    <Link to="/profile" className={styles.navLink}>{t('nav.settings')}</Link>
                  ) : (
                    <>
                      <Link to="/login" className={styles.navLink}>{t('header.login')}</Link>
                      <Link to="/register" className={styles.menuCta}>{t('header.register')}</Link>
                    </>
                  )}

                  <div className={styles.menuDivider} />

                  <div className={styles.menuLangRow}>
                    {LOCALES.map((loc) => (
                      <button
                        key={loc.code}
                        type="button"
                        className={`${styles.menuLang} ${locale === loc.code ? styles.menuLangActive : ''}`}
                        onClick={() => setLocale(loc.code as typeof locale)}
                      >
                        {loc.label}
                      </button>
                    ))}
                  </div>
                </nav>
              </>
            )}
          </div>

          <nav className={`${styles.nav} ${styles.navHiddenMobile}`}>
            {navLinks}
          </nav>

          {/* Phones: the row holds only the logo, so language and account fit
              here as compact chips instead of hiding inside the menu. */}
          <div className={styles.mobileActions}>
            <ThemeButton className={styles.themeBtn} />
            <select
              className={styles.mobileLang}
              value={locale}
              onChange={(e) => setLocale(e.target.value as typeof locale)}
              aria-label="Language"
            >
              {LOCALES.map((loc) => (
                <option key={loc.code} value={loc.code}>{loc.label}</option>
              ))}
            </select>

            {isAuthenticated ? (
              <Link to="/profile" className={styles.mobileAccount}>
                {t('nav.settings')}
              </Link>
            ) : (
              <Link to="/login" className={styles.mobileAccount}>
                {t('header.login')}
              </Link>
            )}
          </div>

          <div className={`${styles.actions} ${styles.actionsDesktop}`}>
            <Link
              to={isAdmin ? '/suggestions/admin' : '/suggestions'}
              className={styles.suggestionsBtn}
              aria-label={isAdmin ? t('suggestionsAdmin.navLink') : t('suggestions.navCta')}
            >
              <Icon name="bulb" size="sm" />
              <span className={styles.suggestionsBtnText}>
                {isAdmin ? t('suggestionsAdmin.navLink') : t('suggestions.navCtaShort')}
              </span>
            </Link>

            <ThemeButton className={styles.themeBtn} />

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
                {t('nav.settings')}
              </Link>
            ) : (
              <>
                <Link to="/login" className={styles.loginBtn}>
                  {t('header.login')}
                </Link>
                <Button variant="primary" size="sm" onClick={() => navigate('/register')}>
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
