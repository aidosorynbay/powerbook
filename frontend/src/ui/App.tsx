import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ExchangePage } from "./pages/ExchangePage";
import { CreateGroupPage } from "./pages/CreateGroupPage";

function Shell() {
  const { user, logout } = useAuth();

  return (
    <div className="container">
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          <span>PowerBook</span>
        </div>

        <nav className="nav">
          <NavLink to="/app" end>
            App
          </NavLink>
          <NavLink to="/groups/new">Create group</NavLink>
          <NavLink to="/exchange">Exchange</NavLink>
        </nav>

        <div className="row">
          {user ? (
            <>
              <span className="pill">
                <strong>{user.display_name}</strong>
                <span>({user.system_role})</span>
              </span>
              <button className="btn" onClick={logout}>
                Logout
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login">Login</NavLink>
              <NavLink to="/register">Register</NavLink>
            </>
          )}
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="/groups/new"
          element={
            <RequireAuth>
              <CreateGroupPage />
            </RequireAuth>
          }
        />
        <Route
          path="/exchange"
          element={
            <RequireAuth>
              <ExchangePage />
            </RequireAuth>
          }
        />
      </Routes>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="toast">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

