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
  options?: { requireAuth?: boolean; keepalive?: boolean }
): Promise<{ data: T | null; error: string | null }> {
  return apiFetch<T>(endpoint, {
    method: 'POST',
    headers: getJsonHeaders(),
    body: JSON.stringify(body),
    requireAuth: options?.requireAuth,
    // Sent even if the page is left right after (a reader off to Instagram).
    keepalive: options?.keepalive,
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

/**
 * DELETE request.
 */
export async function apiDelete<T>(
  endpoint: string,
  options?: { requireAuth?: boolean }
): Promise<{ data: T | null; error: string | null }> {
  return apiFetch<T>(endpoint, {
    method: 'DELETE',
    requireAuth: options?.requireAuth,
  });
}

/**
 * POST a multipart form (file upload).
 *
 * Content-Type is deliberately not set: the browser has to generate the
 * multipart boundary itself, and setting the header by hand strips it.
 */
export async function apiUpload<T>(
  endpoint: string,
  form: FormData,
  options?: { requireAuth?: boolean }
): Promise<{ data: T | null; error: string | null }> {
  return apiFetch<T>(endpoint, {
    method: 'POST',
    body: form,
    requireAuth: options?.requireAuth,
  });
}

/**
 * PATCH request with JSON body.
 */
export async function apiPatch<T, B = unknown>(
  endpoint: string,
  body: B,
  options?: { requireAuth?: boolean }
): Promise<{ data: T | null; error: string | null }> {
  return apiFetch<T>(endpoint, {
    method: 'PATCH',
    headers: getJsonHeaders(),
    body: JSON.stringify(body),
    requireAuth: options?.requireAuth,
  });
}

/**
 * GET a binary response as a Blob.
 *
 * Book files sit behind an authenticated route, so they cannot be handed to
 * a reader as a plain URL — the token has to travel with the request and the
 * bytes come back in memory.
 */
export async function apiGetBlob(
  endpoint: string,
  options?: { requireAuth?: boolean }
): Promise<{ data: Blob | null; error: string | null }> {
  const url = `${getApiBaseUrl()}${endpoint}`;
  const headers: Record<string, string> = {};
  if (options?.requireAuth) {
    const token = getAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  try {
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) return { data: null, error: await parseErrorMessage(res) };
    return { data: await res.blob(), error: null };
  } catch {
    return { data: null, error: 'error.network' };
  }
}

/**
 * Upload a file, reporting progress.
 *
 * fetch() cannot report upload progress at all, so a large book on a phone
 * connection looks identical to a frozen app. XMLHttpRequest is the only way
 * to get real byte counts, which is worth the older API here.
 */
export function apiUploadWithProgress<T>(
  endpoint: string,
  form: FormData,
  onProgress?: (percent: number) => void
): Promise<{ data: T | null; error: string | null }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${getApiBaseUrl()}${endpoint}`);

    const token = getAuthToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // Content-Type is left alone on purpose: the browser must set the
    // multipart boundary itself.

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve({ data: JSON.parse(xhr.responseText) as T, error: null });
        } catch {
          resolve({ data: null, error: 'error.validation' });
        }
        return;
      }
      let message = `Request failed (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText);
        if (typeof body?.detail === 'string') message = body.detail;
      } catch {
        /* keep the status-code message */
      }
      resolve({ data: null, error: message });
    };

    xhr.onerror = () => resolve({ data: null, error: 'error.network' });
    xhr.ontimeout = () => resolve({ data: null, error: 'error.network' });

    xhr.send(form);
  });
}
