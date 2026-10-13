import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react';
import { getApiBaseUrl, getAuthToken } from './api';
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
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getAuthToken());
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

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
    }
    setIsLoading(false);
  }, [token, fetchUser]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

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
