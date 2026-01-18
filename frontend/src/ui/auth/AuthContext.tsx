import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError, UserOut } from "../../lib/api";

type AuthState = {
  token: string | null;
  user: UserOut | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, display_name: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = "powerbook.token";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<UserOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refreshMe() {
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const me = await api.auth.me(token);
      setUser(me);
      setError(null);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Failed to load user";
      setError(msg);
      setUser(null);
    }
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      await refreshMe();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }, [token]);

  async function login(email: string, password: string) {
    setError(null);
    const t = await api.auth.login(email, password);
    setToken(t.access_token);
    const me = await api.auth.me(t.access_token);
    setUser(me);
  }

  async function register(email: string, password: string, display_name: string) {
    setError(null);
    const t = await api.auth.register(email, password, display_name);
    setToken(t.access_token);
    const me = await api.auth.me(t.access_token);
    setUser(me);
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  const value = useMemo<AuthState>(
    () => ({ token, user, loading, error, login, register, logout, refreshMe }),
    [token, user, loading, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

