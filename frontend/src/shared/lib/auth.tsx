import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo, useRef } from 'react';
import { getApiBaseUrl, getAuthToken } from './api';
import { getDisplayMode } from './install';
import { STORAGE_KEY_TOKEN } from './constants';
import { readToken, rememberToken } from './api';
import type { User } from './types';

type AuthContextValue = {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (token: string) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  /** The account as the server just returned it (a profile change made elsewhere), with no loading screen. */
  setUserQuietly: (user: User) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** The token's own claims (issued at, the password mark), read without checking: the server checks. */
function claimsOf(token: string): { iat?: number; pv?: string } | null {
  try {
    const part = token.split('.')[1];
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

/** Tells the server once per visit how PowerBook is opened (browser, or the app on the home screen). */
async function reportDisplayMode(apiBaseUrl: string, token: string): Promise<void> {
  try {
    if (sessionStorage.getItem('pb.dmSent') === '1') return;
    sessionStorage.setItem('pb.dmSent', '1');
  } catch {
    /* storage blocked: report anyway */
  }
  try {
    await fetch(`${apiBaseUrl}/auth/display-mode`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: getDisplayMode() }),
    });
  } catch {
    /* offline: the next visit */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getAuthToken());
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // a token swapped in by renew(): the same reader, already loaded, so it does not reload the user
  const renewed = useRef<string | null>(null);

  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  // A session lasts while PowerBook is used: once a day the token is exchanged for a fresh one (400 days ahead), so
  // nobody is sent to «Вход» again unless they press «Выйти» or change the password (2026-10-15).
  const renew = useCallback(async (current: string) => {
    const c = claimsOf(current);
    if (!c) return;
    const ageHours = (Date.now() / 1000 - (c.iat ?? 0)) / 3600;
    if (ageHours < 20 && c.pv) return;
    try {
      const res = await fetch(`${apiBaseUrl}/auth/refresh`, { method: 'POST', headers: { Authorization: `Bearer ${current}` } });
      if (!res.ok) return;
      const { access_token: fresh } = (await res.json()) as { access_token?: string };
      if (!fresh || readToken() !== current) return; // a sign-in or a sign-out happened meanwhile
      renewed.current = fresh;
      rememberToken(fresh);
      try {
        localStorage.setItem(STORAGE_KEY_TOKEN, fresh);
      } catch {
        /* storage refused: the fresh token lives in memory for this visit */
      }
      setToken(fresh);
    } catch {
      /* offline: tomorrow, or the next visit */
    }
  }, [apiBaseUrl]);

  // 'invalid' only when the server says so (401/403). A phone back from the background is often offline for a
  // moment, and that used to sign the reader out (the founder's iPhone, 2026-10-13): now it is 'offline' and kept.
  const fetchUser = useCallback(async (accessToken: string): Promise<User | 'invalid' | 'offline'> => {
    try {
      const res = await fetch(`${apiBaseUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.status === 401 || res.status === 403) return 'invalid';
      if (!res.ok) return 'offline';
      return (await res.json()) as User;
    } catch {
      return 'offline';
    }
  }, [apiBaseUrl]);

  const refreshUser = useCallback(async () => {
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    let u = await fetchUser(token);
    for (let i = 0; u === 'offline' && i < 3; i++) {
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      u = await fetchUser(token);
    }
    // a newer sign-in may have happened meanwhile: an answer about an old token never touches it
    if (readToken() !== token) {
      setIsLoading(false);
      return;
    }
    if (u === 'invalid') {
      localStorage.removeItem(STORAGE_KEY_TOKEN);
      rememberToken(null);
      setToken(null);
      setUser(null);
    } else if (u !== 'offline') {
      setUser(u);
      void renew(token);
      void reportDisplayMode(apiBaseUrl, token);
    }
    setIsLoading(false);
  }, [token, fetchUser, renew]);

  useEffect(() => {
    if (token && token === renewed.current) return;
    refreshUser();
  }, [refreshUser, token]);

  const login = useCallback((newToken: string) => {
    rememberToken(newToken);
    try {
      localStorage.setItem(STORAGE_KEY_TOKEN, newToken);
    } catch {
      /* storage refused: the token lives in memory for this visit */
    }
    setToken(newToken);
  }, []);

  const logout = useCallback(() => {
    rememberToken(null);
    localStorage.removeItem(STORAGE_KEY_TOKEN);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticated: !!user,
      login,
      logout,
      refreshUser,
      setUserQuietly: setUser,
    }),
    [user, token, isLoading, login, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
