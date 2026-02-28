/**
 * Shared API utilities for consistent backend communication.
 */

import { STORAGE_KEY_TOKEN } from './constants';

/**
 * Get the API base URL from environment or default.
 */
export function getApiBaseUrl(): string {
  const fromEnv = (import.meta.env as { VITE_API_BASE_URL?: string }).VITE_API_BASE_URL;
  return fromEnv ?? 'http://localhost:8000/api';
}

/**
 * Get the stored auth token.
 */
export function getAuthToken(): string | null {
  return localStorage.getItem(STORAGE_KEY_TOKEN);
}

/**
 * Common request headers for authenticated requests.
 */
export function getAuthHeaders(): HeadersInit {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Common request headers for JSON requests.
 */
export function getJsonHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json' };
}

/**
 * Combined headers for authenticated JSON requests.
 */
export function getAuthJsonHeaders(): HeadersInit {
  return {
    ...getAuthHeaders(),
    ...getJsonHeaders(),
  };
}

/**
 * Parse error message from API response.
 */
export async function parseErrorMessage(res: Response, fallbackKey?: string): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === 'string') return data.detail;
    if (Array.isArray(data?.detail)) return fallbackKey ?? 'error.validation';
    if (typeof data?.message === 'string') return data.message;
  } catch {
    // ignore parsing errors
  }
  return `Request failed (${res.status})`;
}

/**
 * Generic API fetcher with error handling.
 */
export async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit & { requireAuth?: boolean }
): Promise<{ data: T | null; error: string | null }> {
  const { requireAuth = false, ...fetchOptions } = options ?? {};
  const url = `${getApiBaseUrl()}${endpoint}`;

  const headers: HeadersInit = {
    ...(fetchOptions.headers ?? {}),
  };

  if (requireAuth) {
    const token = getAuthToken();
    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }
  }

  try {
    const res = await fetch(url, { ...fetchOptions, headers });
    if (!res.ok) {
      const error = await parseErrorMessage(res);
      return { data: null, error };
    }
    const data = await res.json();
    return { data, error: null };
  } catch {
    return { data: null, error: 'error.network' };
  }
}

/**
 * POST request with JSON body.
 */
export async function apiPost<T, B = unknown>(
  endpoint: string,
  body: B,
  options?: { requireAuth?: boolean }
): Promise<{ data: T | null; error: string | null }> {
  return apiFetch<T>(endpoint, {
    method: 'POST',
    headers: getJsonHeaders(),
    body: JSON.stringify(body),
    requireAuth: options?.requireAuth,
  });
}

/**
 * GET request.
 */
export async function apiGet<T>(
  endpoint: string,
  options?: { requireAuth?: boolean }
): Promise<{ data: T | null; error: string | null }> {
  return apiFetch<T>(endpoint, {
    method: 'GET',
    requireAuth: options?.requireAuth,
  });
}

/**
 * PUT request with JSON body.
 */
export async function apiPut<T, B = unknown>(
  endpoint: string,
  body: B,
  options?: { requireAuth?: boolean }
): Promise<{ data: T | null; error: string | null }> {
  return apiFetch<T>(endpoint, {
    method: 'PUT',
    headers: getJsonHeaders(),
    body: JSON.stringify(body),
    requireAuth: options?.requireAuth,
  });
}
