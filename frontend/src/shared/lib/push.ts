import { apiGet, apiPost } from './api';
import { detectEnv, getDisplayMode, isStandalone } from './install';

/**
 * Web push for the reading reminder.
 *
 * Android and desktop browsers can subscribe from the site itself; an
 * iPhone only from the app on the home screen, and only inside a tap.
 */

export type PushSupport = 'ok' | 'needs_install' | 'unsupported';
export type EnableResult = 'granted' | 'denied' | 'error';

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  const has = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (has) return 'ok';
  // Safari on an iPhone has none of it until the site is on the home screen.
  if (detectEnv().os === 'ios' && !isStandalone()) return 'needs_install';
  return 'unsupported';
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

function toKey(base64url: string): ArrayBuffer {
  const padded = base64url + '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buffer;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // The worker is registered by main.tsx in production; here it may still be installing.
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

/** Whether this browser already holds a subscription. */
export async function hasSubscription(): Promise<boolean> {
  if (pushSupport() !== 'ok') return false;
  const reg = await registration();
  if (!reg) return false;
  return (await reg.pushManager.getSubscription()) !== null;
}

/** Ask, subscribe, tell the server. Must run inside a click. */
export async function enablePush(): Promise<EnableResult> {
  if (pushSupport() !== 'ok') return 'error';
  let permission = Notification.permission;
  if (permission !== 'granted') permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  try {
    const reg = await registration();
    if (!reg) return 'error';
    const { data } = await apiGet<{ key: string }>('/push/vapid-public-key');
    if (!data?.key) return 'error';
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(data.key) });
    }
    const json = sub.toJSON();
    const { error } = await apiPost(
      '/push/subscribe',
      { subscription: { endpoint: json.endpoint, keys: json.keys }, user_agent: navigator.userAgent, display_mode: getDisplayMode() },
      { requireAuth: true },
    );
    return error ? 'error' : 'granted';
  } catch {
    return 'error';
  }
}

/** Forget this browser on both sides. */
export async function disablePush(): Promise<void> {
  try {
    const reg = await registration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await apiPost('/push/unsubscribe', { endpoint: sub.endpoint }, { requireAuth: true });
    await sub.unsubscribe();
  } catch {
    /* nothing to undo */
  }
}

/** The phone's own zone, for the server to fire the reminder at local time. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Almaty';
  } catch {
    return 'Asia/Almaty';
  }
}
