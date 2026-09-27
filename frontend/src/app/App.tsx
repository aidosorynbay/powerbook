import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { AuthProvider, useAuth, I18nProvider, useI18n } from '@/shared/lib';
import { HomePage, LoginPage, RegisterPage, DashboardPage, ArchivePage, ResultsPage, ProfilePage, InsightsPage, HallOfFamePage, DirectoryPage, PublicProfilePage, ForgotPasswordPage, SuggestionsPage, AdminSuggestionsPage, ClaimPage, PrivacyPage, TermsPage, LibraryPage, ReaderShelfPage, LibraryHallPage, CatalogPage, MarketPage, ReadingPage, JoinPage } from '@/pages';
import { BottomNav, JoinPrompt, LastCallNotice } from '@/widgets';
import '@/app/styles/theme.css';

// Lets Sentry name traces by route pattern (/readers/:userId).
const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes);

// Loaded only when a book is actually opened.
const ReaderPage = lazy(() =>
  import('@/pages/library/ReaderPage').then((m) => ({ default: m.ReaderPage }))
);

function AppRoutes() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { t } = useI18n();

  // Tag errors with the reader's id only (no name or email), so Sentry can
  // count how many readers an error hits.
  useEffect(() => {
    Sentry.setUser(user ? { id: user.id } : null);
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
        <Route path="/" element={<HomePage />} />
        <Route
          path="/round"
          element={isAuthenticated ? <DashboardPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/archive"
          element={isAuthenticated ? <ArchivePage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/results"
          element={isAuthenticated ? <ResultsPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/insights"
          element={isAuthenticated ? <InsightsPage /> : <Navigate to="/login" replace />}
        />
        <Route path="/claim" element={<ClaimPage />} />
        {/* Open to anyone: it is the page members send to friends. */}
        <Route path="/join" element={<JoinPage />} />
        <Route path="/hall-of-fame" element={<HallOfFamePage />} />
        {/* Public and unauthenticated on purpose: both app stores need a
            policy URL reachable without an account. */}
        <Route
          path="/library"
          element={isAuthenticated ? <LibraryPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/library/hall"
          element={isAuthenticated ? <LibraryHallPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/books"
          element={isAuthenticated ? <CatalogPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/market"
          element={isAuthenticated ? <MarketPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/reading"
          element={isAuthenticated ? <ReadingPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/library/:bookId"
          element={
            isAuthenticated ? (
              <Suspense fallback={<div className="readerBoot">{t('library.opening')}</div>}>
                <ReaderPage />
              </Suspense>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/suggestions" element={<SuggestionsPage />} />
        <Route
          path="/suggestions/admin"
          element={isAuthenticated ? <AdminSuggestionsPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/readers"
          element={isAuthenticated ? <DirectoryPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/readers/:userId"
          element={isAuthenticated ? <PublicProfilePage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/readers/:userId/shelf"
          element={isAuthenticated ? <ReaderShelfPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/profile"
          element={isAuthenticated ? <ProfilePage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
        />
        <Route
          path="/forgot-password"
          element={isAuthenticated ? <Navigate to="/" replace /> : <ForgotPasswordPage />}
        />
        <Route
          path="/register"
          element={isAuthenticated ? <Navigate to="/" replace /> : <RegisterPage />}
        />
      </SentryRoutes>
      <BottomNav />
      {/* Mounted at the root, not per page: the reader should see it on the
          last day whichever page they happen to open. */}
      {isAuthenticated && <LastCallNotice />}
      {/* For whoever is not reading in this month's circle: the way into the next one. */}
      <JoinPrompt />
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


