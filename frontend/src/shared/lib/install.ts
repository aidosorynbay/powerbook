import { track } from './analytics';

/**
 * The installed app («PowerBook на экране „Домой“»).
 *
 * One place knows who can install in one tap (Android Chromium fires
 * beforeinstallprompt), who needs the picture guide (iPhone: Apple gives
 * sites no install API), who is stuck in an in-app browser (Telegram,
 * Instagram: no «На экран „Домой“» there), and who is already inside.
 *
 * The browser fires beforeinstallprompt early, before React mounts, so
 * initInstall() runs from main.tsx and keeps the event; the hook and the
 * widgets only read this module's state.
 */

export type DisplayMode = 'browser' | 'standalone' | 'ios_standalone';
export type InstallState = 'installed' | 'prompt' | 'android' | 'ios' | 'inapp' | 'desktop';
export type InstallEnv = {
  os: 'ios' | 'android' | 'other';
  mobile: boolean;
  inApp: boolean;
  browser: 'safari' | 'chrome' | 'samsung' | 'firefox' | 'other';
};

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribeInstall(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function detectEnv(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): InstallEnv {
  const iPadOS = typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const ios = /iPhone|iPad|iPod/.test(ua) || iPadOS;
  const android = /Android/.test(ua);
  // Apps that name themselves in the user agent, plus Android's own WebView.
  const inAppNamed = /Telegram|Instagram|FBAN|FBAV|FB_IAB|Line\/|VKClient|TikTok|Snapchat|; wv\)/.test(ua);
  // An iOS in-app browser is a bare WKWebView: it carries neither Safari's
  // own token nor a third-party browser's.
  const iosWebView = ios && !/Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPT\//.test(ua);
  const browser: InstallEnv['browser'] = /SamsungBrowser/.test(ua)
    ? 'samsung'
    : /CriOS|Chrome\//.test(ua) && !/Edg|OPR/.test(ua)
      ? 'chrome'
      : /FxiOS|Firefox\//.test(ua)
        ? 'firefox'
        : ios
          ? 'safari'
          : 'other';
  return {
    os: ios ? 'ios' : android ? 'android' : 'other',
    mobile: ios || android,
    inApp: inAppNamed || iosWebView,
    browser,
  };
}

export function getDisplayMode(): DisplayMode {
  if (typeof window === 'undefined') return 'browser';
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    nav.standalone === true ||
    new URLSearchParams(window.location.search).get('source') === 'pwa';
  if (!standalone) return 'browser';
  return detectEnv().os === 'ios' ? 'ios_standalone' : 'standalone';
}

export function isStandalone(): boolean {
  return getDisplayMode() !== 'browser';
}

export function getInstallState(): InstallState {
  if (installedNow || isStandalone()) return 'installed';
  const env = detectEnv();
  if (env.mobile && env.inApp) return 'inapp';
  if (deferred) return 'prompt';
  if (env.os === 'ios') return 'ios';
  if (env.os === 'android') return 'android';
  return 'desktop';
}

/** The one-tap install, where the browser offers it. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (!event) return 'unavailable';
  track('install_click', { via: 'prompt' });
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    track('install_prompt_result', { outcome });
    if (outcome === 'accepted') installedNow = true;
    // prompt() works once per event; the browser fires a new one later if it wants to.
    deferred = null;
    notify();
    return outcome;
  } catch {
    deferred = null;
    notify();
    return 'unavailable';
  }
}

let started = false;

export function initInstall(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    track('install_available');
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installedNow = true;
    deferred = null;
    track('app_installed');
    notify();
  });

  // display_mode itself is set by initAnalytics(); here only the launch is counted.
  const mode = getDisplayMode();
  if (mode !== 'browser') {
    // Once per launch, not per page: the app stays open all day.
    let counted = false;
    try {
      counted = sessionStorage.getItem('pb.appLaunch') === '1';
      sessionStorage.setItem('pb.appLaunch', '1');
    } catch {
      /* storage blocked: count the launch anyway */
    }
    if (!counted) track('app_launch', { display_mode: mode });
  }

  // ?source=pwa has done its job (the launch is counted above and in the
  // page view); the router gets a clean address.
  const url = new URL(window.location.href);
  if (url.searchParams.get('source') === 'pwa') {
    url.searchParams.delete('source');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
}
