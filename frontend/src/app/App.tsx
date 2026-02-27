import { BrowserRouter, Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth, I18nProvider, useI18n } from '@/shared/lib';
import { HomePage, LoginPage, RegisterPage, DashboardPage, ArchivePage, ResultsPage } from '@/pages';
import { BottomNav } from '@/widgets';
import '@/app/styles/theme.css';

function AppRoutes() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useI18n();

  const handleRegister = () => {
    navigate('/register');
  };

  const handleLogin = () => {
    navigate('/login');
  };

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
        <Route
          path="/"
          element={
            <HomePage
              onRegisterClick={handleRegister}
              onLoginClick={handleLogin}
            />
          }
        />
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
          path="/login"
          element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
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
