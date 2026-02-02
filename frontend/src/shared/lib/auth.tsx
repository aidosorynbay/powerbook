import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react';
import { getApiBaseUrl, getAuthToken } from './api';
import { STORAGE_KEY_TOKEN } from './constants';
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

  const fetchUser = useCallback(async (accessToken: string): Promise<User | null> => {
    try {
      const res = await fetch(`${apiBaseUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      return (await res.json()) as User;
    } catch {
      return null;
    }
  }, [apiBaseUrl]);

  const refreshUser = useCallback(async () => {
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const u = await fetchUser(token);
    if (u) {
      setUser(u);
    } else {
      // token invalid
      localStorage.removeItem(STORAGE_KEY_TOKEN);
      setToken(null);
      setUser(null);
    }
    setIsLoading(false);
  }, [token, fetchUser]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback((newToken: string) => {
    localStorage.setItem(STORAGE_KEY_TOKEN, newToken);
    setToken(newToken);
  }, []);

  const logout = useCallback(() => {
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
