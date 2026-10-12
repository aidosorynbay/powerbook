/**
 * Google Analytics 4: which parts of the site people actually use, so that
 * the first full launch can keep what matters and drop what nobody opens.
 *
 * Only in the production build, and only once a measurement id is set
 * (VITE_GA_ID, or GA_ID below); until then every call here does nothing.
 * Page views are GA's own: "Enhanced measurement" follows the router's
 * history changes. Readers are counted by their account id only, never a
 * name or an e-mail, the same rule Sentry follows.
 */

// The measurement id is public by nature (it sits in every page's HTML).
const GA_ID = import.meta.env.VITE_GA_ID || 'G-RRHCW0VR2X';

type Params = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let ready = false;

export function initAnalytics(userProperties: Record<string, string | number | boolean> = {}): void {
  if (ready || !GA_ID || !import.meta.env.PROD || typeof window === 'undefined') return;
  ready = true;
  window.dataLayer = window.dataLayer || [];
  // gtag.js reads the Arguments object itself, not an array made from it.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  // Before config, so the first page view already carries them (display_mode:
  // the site in a browser, or the app on the home screen).
  if (Object.keys(userProperties).length) window.gtag('set', 'user_properties', userProperties);
  window.gtag('config', GA_ID);
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(script);
}

/** The signed-in reader's id, so one person on a phone and a laptop counts once. */
export function setAnalyticsUser(id: string | null): void {
  if (!ready) return;
  window.gtag?.('set', { user_id: id ?? undefined });
}

/**
 * A fact about the person that rides along with every later event. Today
 * that is display_mode: "browser", or "standalone" / "ios_standalone" for
 * the app on the home screen. GA needs the same name registered once as a
 * user-scoped custom dimension before it shows up in reports.
 */
export function setUserProperties(props: Record<string, string | number | boolean>): void {
  if (!ready) return;
  try {
    window.gtag?.('set', 'user_properties', props);
  } catch {
    /* analytics must never break the page */
  }
}

/** One thing a reader did: "reader_lock_in", "book_mark", "claim_submit"… */
export function track(event: string, params: Params = {}): void {
  if (!ready) return;
  try {
    window.gtag?.('event', event, params);
  } catch {
    /* analytics must never break the page */
  }
}
