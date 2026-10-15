import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { AuthProvider, useAuth, I18nProvider, useI18n, isReaderPath, setAnalyticsUser } from '@/shared/lib';
import { HomePage, LoginPage, RegisterPage, DashboardPage, ArchivePage, ResultsPage, ProfilePage, InsightsPage, HallOfFamePage, DirectoryPage, PublicProfilePage, ForgotPasswordPage, SuggestionsPage, AdminSuggestionsPage, ClaimPage, PrivacyPage, TermsPage, LibraryPage, ReaderShelfPage, LibraryHallPage, CatalogPage, MarketPage, ReadingPage, JoinPage, ReaderDayPage, GetPage, AboutPage } from '@/pages';
import { ArchivePrompt, BottomNav, GuestKept, JoinPrompt, LastCallNotice, WhatsNew } from '@/widgets';
import '@/app/styles/theme.css';

// Lets Sentry name traces by route pattern (/readers/:userId).
const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes);

// Loaded only when a book is actually opened. Right after a deploy the import
// comes back empty while main.tsx reloads the page into the new build; the
// loader stays up until then, not an error (Sentry POWERBOOK-FRONTEND-6).
const ReaderPage = lazy(() =>
  import('@/pages/library/ReaderPage').then((m) => (m ? { default: m.ReaderPage } : new Promise<never>(() => {})))
);

/** A page that needs an account: sign in, then come back to it. */
function ToLogin() {
  const { pathname, search } = useLocation();
  return <Navigate to={`/login?redirect=${encodeURIComponent(pathname + search)}`} replace />;
}

/** The round, opened by someone without an account (it is shared around):
 * the invitation page, which says what a circle is and how to get in. */
function ToJoin() {
  const { pathname, search } = useLocation();
  // A member whose session ran out is not a newcomer: straight to «Войти» and back to the circle,
  // not past «Следующий круг — Ноябрь» on the invitation page (GA4: /join → /login 57 times in 14 days).
  let member = false;
  try {
    member = localStorage.getItem('pb.wasMember') === '1';
  } catch {
    // storage blocked: treat as a visitor
  }
  if (member) return <Navigate to={`/login?redirect=${encodeURIComponent(pathname + search)}`} replace />;
  return <Navigate to={`/join${search}`} replace />;
}

function AppRoutes() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { t } = useI18n();
  const { pathname } = useLocation();
  // Inside an open book nothing pops up over the page.
  const reading = isReaderPath(pathname);

  // Tag errors with the reader's id only (no name or email), so Sentry can
  // count how many readers an error hits.
  useEffect(() => {
    Sentry.setUser(user ? { id: user.id } : null);
    setAnalyticsUser(user ? user.id : null);
    if (user) {
      try {
        localStorage.setItem('pb.wasMember', '1');
      } catch {
        // storage blocked: the next logged-out visit just meets the invitation page
      }
    }
  }, [user]);

  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-text-secondary)'
      }}>
        {t('dashboard.loading')}
      </div>
    );
  }

  return (
    <>
      <SentryRoutes>
        {/* A member's home is the circle; the front page is for visitors (members still reach it through «О нас»). */}
        <Route path="/" element={isAuthenticated ? <Navigate to="/round" replace /> : <HomePage />} />
        {/* the front page for anyone — a member who signed up in a hurry reads the rules here (Профиль → «Как устроен PowerBook») */}
        <Route path="/welcome" element={<HomePage />} />
        <Route
          path="/round"
          element={isAuthenticated ? <DashboardPage /> : <ToJoin />}
        />
        <Route
          path="/archive"
          element={isAuthenticated ? <ArchivePage /> : <ToLogin />}
        />
        <Route
          path="/results"
          element={isAuthenticated ? <ResultsPage /> : <ToLogin />}
        />
        <Route
          path="/insights"
          element={isAuthenticated ? <InsightsPage /> : <ToLogin />}
        />
        <Route path="/claim" element={<ClaimPage />} />
        {/* Open to anyone: it is the page members send to friends. */}
        <Route path="/join" element={<JoinPage />} />
        <Route path="/get" element={<GetPage />} />
        {/* A reader's shared day: open to anyone, it is where the link leads. */}
        <Route path="/r/:username" element={<ReaderDayPage />} />
        <Route path="/hall-of-fame" element={<HallOfFamePage />} />
        {/* Public and unauthenticated on purpose: both app stores need a
            policy URL reachable without an account. */}
        <Route
          path="/library"
          element={isAuthenticated ? <LibraryPage /> : <ToLogin />}
        />
        <Route
          path="/library/hall"
          element={<LibraryHallPage />}
        />
        <Route
          path="/books"
          element={isAuthenticated ? <CatalogPage /> : <ToLogin />}
        />
        <Route
          path="/market"
          element={isAuthenticated ? <MarketPage /> : <ToLogin />}
        />
        <Route
          path="/reading"
          element={isAuthenticated ? <ReadingPage /> : <ToLogin />}
        />
        <Route
          path="/library/:bookId"
          element={
            isAuthenticated ? (
              <Suspense fallback={<div className="readerBoot">{t('library.opening')}</div>}>
                <ReaderPage />
              </Suspense>
            ) : (
              <ToLogin />
            )
          }
        />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/suggestions" element={<SuggestionsPage />} />
        <Route
          path="/suggestions/admin"
          element={isAuthenticated ? <AdminSuggestionsPage /> : <ToLogin />}
        />
        <Route
          path="/readers"
          element={isAuthenticated ? <DirectoryPage /> : <ToLogin />}
        />
        <Route
          path="/readers/:userId"
          element={isAuthenticated ? <PublicProfilePage /> : <ToLogin />}
        />
        <Route
          path="/readers/:userId/shelf"
          element={isAuthenticated ? <ReaderShelfPage /> : <ToLogin />}
        />
        <Route
          path="/profile"
          element={isAuthenticated ? <ProfilePage /> : <ToLogin />}
        />
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
        />
        <Route
          path="/forgot-password"
          element={isAuthenticated ? <Navigate to="/" replace /> : <ForgotPasswordPage />}
        />
        {/* The page sends a signed-in visitor away itself: a guard here also
            fired the moment sign-up succeeded, so the new reader was thrown to
            the front page before the archive step, and ?redirect was lost. */}
        <Route path="/register" element={<RegisterPage />} />
      </SentryRoutes>
      <BottomNav />
      {/* Mounted at the root, not per page: the reader should see it on the
          last day whichever page they happen to open. */}
      {isAuthenticated && !reading && <LastCallNotice />}
      {isAuthenticated && !reading && <ArchivePrompt />}
      {/* once, for members who knew the old places: where Архив, Результаты, Топ and the header buttons went */}
      {isAuthenticated && !reading && <WhatsNew />}
      {/* For whoever is not reading in this month's circle: the way into the next one. */}
      {!reading && <JoinPrompt />}
      {/* minutes read as a visitor become the reader's once they have an account, wherever they signed up */}
      <GuestKept />
    </>
  );
}

// Shown when rendering crashes. It sits outside I18nProvider (which may be
// what failed), so the text is fixed in the two main languages.
function CrashFallback() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '12px',
      padding: '24px',
      textAlign: 'center',
      color: 'var(--color-text-secondary)'
    }}>
      <p>Что-то пошло не так. Попробуйте обновить страницу.</p>
      <p>Бірдеңе дұрыс болмады. Бетті жаңартып көріңіз.</p>
      <button type="button" onClick={() => window.location.reload()}>
        Обновить / Жаңарту
      </button>
    </div>
  );
}

export function App() {
  return (
    <Sentry.ErrorBoundary fallback={<CrashFallback />}>
      <BrowserRouter>
        <I18nProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </I18nProvider>
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  );
}


