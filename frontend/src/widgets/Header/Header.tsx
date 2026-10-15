import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { track, useAuth, useI18n, useTheme, LOCALES, type ThemeChoice } from '@/shared/lib';
import { Logo, Button, Icon, Container } from '@/shared/ui';
import { Bell, MessagesLink } from '@/widgets/Notifications';
import { HelpButton } from '@/widgets/Help';
import { MEMBER_TABS, isTabActive } from '@/widgets/BottomNav/tabs';
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

/** A globe and the language's short name: the one setting someone who can't read the page still has to find. */
function LangPicker({ className }: { className: string }) {
  const { locale, setLocale } = useI18n();
  return (
    <label className={className}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.6 2.8 3.9 5.8 3.9 9s-1.3 6.2-3.9 9M12 3C9.4 5.8 8.1 8.8 8.1 12s1.3 6.2 3.9 9" />
      </svg>
      <select value={locale} onChange={(e) => setLocale(e.target.value as typeof locale)} aria-label="Language / Язык / Тіл">
        {LOCALES.map((loc) => (
          <option key={loc.code} value={loc.code}>{loc.label}</option>
        ))}
      </select>
    </label>
  );
}

/**
 * A member's bar: the logo goes to the circle (their home), the same four places as the phone's tab bar
 * on computers, and only the language, the bell and «?» (the rules and answers, HelpSheet) beside them. Theme, settings, the ideas box and the app
 * moved into Профиль; nothing here can run out of room and hide a link (2026-10-14 audit: «Читатели»,
 * «Топ» and Telegram sat clipped at every desktop width).
 */
function MemberHeader() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  return (
    <header className={styles.header}>
      <Container>
        <div className={styles.memberInner}>
          <Link to="/round" className={styles.memberLogo} aria-label={`PowerBook — ${t('nav.round')}`}>
            <img src="/logo-icon.png" alt="" className={styles.memberLogoIcon} />
            <span className={styles.memberLogoText}>PowerBook</span>
          </Link>
          <nav className={styles.memberNav} aria-label={t('nav2.main')}>
            {MEMBER_TABS.map((tab) => {
              const on = isTabActive(pathname, tab);
              return (
                <Link key={tab.path} to={tab.path} className={`${styles.memberLink} ${on ? styles.memberLinkOn : ''}`} aria-current={on ? 'page' : undefined}>
                  {t(tab.label)}
                </Link>
              );
            })}
          </nav>
          <div className={styles.memberActions}>
            <LangPicker className={styles.globe} />
            <MessagesLink />
            <Bell />
            <HelpButton />
          </div>
        </div>
      </Container>
    </header>
  );
}

export function Header() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <MemberHeader /> : <GuestHeader />;
}

function GuestHeader() {
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
      // and it gives up by itself after three days of visits (the council, 2026-10-13)
      const day = new Date().toISOString().slice(0, 10);
      const seen = JSON.parse(localStorage.getItem('pb.menuHintDays') || '[]') as string[];
      if (!seen.includes(day)) localStorage.setItem('pb.menuHintDays', JSON.stringify([...seen, day].slice(-3)));
      setShowHint(localStorage.getItem(HINT_KEY) !== '1' && (seen.includes(day) ? seen.length : seen.length + 1) <= 3);
    } catch {
      // private mode / storage blocked — just skip the hint
    }
  }, []);

  // the hint points at the logo, so it lives only at the top of the page: scrolled, it would hang over the text
  const [atTop, setAtTop] = useState(true);
  useEffect(() => {
    if (!showHint) return;
    const onScroll = () => setAtTop(window.scrollY < 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [showHint]);

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
      )}
      {!isAuthenticated && <Link to="/about" className={styles.navLink}>{t('nav.about')}</Link>}
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

            {/* not over the front page's first screen: there it was the first thing a newcomer read */}
            {showHint && !menuOpen && atTop && location.pathname !== '/' && (
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
                  <Link to="/get" className={styles.navLink}>{t('install.menu')}</Link>

                  {/* Everything that used to sit on the right of the bar lives
                      here on phones — the row simply has no room for it. */}
                  <div className={styles.menuDivider} />

                  {isAuthenticated && (
                    <Link
                      to={isAdmin ? '/suggestions/admin' : '/suggestions'}
                      className={styles.navLink}
                    >
                      <Icon name="bulb" size="sm" />{' '}
                      {isAdmin ? t('suggestionsAdmin.navLink') : t('suggestions.navCtaShort')}
                    </Link>
                  )}

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
            <MessagesLink />
            <Bell />
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
              <Link to="/profile" className={styles.mobileAccount} aria-label={t('nav.settings')}>
                {/* A gear on the narrowest phones: the bell needs the room, and «Настр...» says nothing. */}
                <Icon name="gear" size="sm" className={styles.mobileAccountIcon} aria-hidden="true" />
                <span className={styles.mobileAccountText}>{t('nav.settings')}</span>
              </Link>
            ) : (
              <Link to="/login" className={styles.mobileAccount} onClick={() => track('auth_entry', { from: 'header', to: 'login', page: location.pathname })}>
                {t('header.login')}
              </Link>
            )}
          </div>

          <div className={`${styles.actions} ${styles.actionsDesktop}`}>
            <Link to="/get" className={styles.phoneLink}>{t('install.headerLink')}</Link>
            {isAuthenticated && (
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
            )}

            <MessagesLink />
            <Bell />

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
                <Link to="/login" className={styles.loginBtn} onClick={() => track('auth_entry', { from: 'header', to: 'login', page: location.pathname })}>
                  {t('header.login')}
                </Link>
                <Button variant="primary" size="sm" onClick={() => { track('auth_entry', { from: 'header', to: 'register', page: location.pathname }); navigate('/register'); }}>
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
