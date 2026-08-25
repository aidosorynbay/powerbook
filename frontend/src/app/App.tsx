import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth, I18nProvider, useI18n } from '@/shared/lib';
import { HomePage, LoginPage, RegisterPage, DashboardPage, ArchivePage, ResultsPage, ProfilePage, InsightsPage, HallOfFamePage, DirectoryPage, PublicProfilePage, ForgotPasswordPage, SuggestionsPage, AdminSuggestionsPage, ClaimPage, PrivacyPage, TermsPage } from '@/pages';
import { BottomNav } from '@/widgets';
import '@/app/styles/theme.css';

function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useI18n();

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
      <Routes>
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
        <Route path="/hall-of-fame" element={<HallOfFamePage />} />
        {/* Public and unauthenticated on purpose: both app stores need a
            policy URL reachable without an account. */}
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
      </Routes>
      <BottomNav />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}


