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

// Microsoft Clarity project id (public, like GA's). Empty = Clarity off.
const CLARITY_ID = '';

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

/**
 * A homepage block that stayed on screen for at least two seconds — the
 * stand-in for «what do people actually read», which GA can't see by itself.
 * Sent once per block per page view, with the seconds it stayed in view
 * (rounded; capped at 10 minutes) when the block leaves the screen.
 */
export function trackSectionView(el: Element, section: string): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  let since = 0;
  let seen = 0;
  let sent = false;
  const flush = () => {
    if (since) seen += Date.now() - since;
    since = 0;
    if (!sent && seen >= 2000) {
      sent = true;
      track('section_view', { section, seconds: Math.min(600, Math.round(seen / 1000)) });
    }
  };
  const io = new IntersectionObserver(
    ([e]) => {
      if (e.isIntersecting) since = since || Date.now();
      else flush();
    },
    { threshold: 0.4 },
  );
  io.observe(el);
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', onHide);
  return () => {
    flush();
    io.disconnect();
    document.removeEventListener('visibilitychange', onHide);
  };
}

/**
 * Microsoft Clarity: heatmaps and session replays, to see where people
 * click and how far they read. Free; only in the production build and only
 * once VITE_CLARITY_ID is set. Clarity masks what people type by default.
 */
export function initClarity(): void {
  const id = import.meta.env.VITE_CLARITY_ID || CLARITY_ID;
  if (!id || !import.meta.env.PROD || typeof window === 'undefined') return;
  const w = window as unknown as { clarity?: ((...a: unknown[]) => void) & { q?: unknown[] } };
  if (w.clarity) return;
  const c = function clarity(...args: unknown[]) { (c.q = c.q || []).push(args); } as ((...a: unknown[]) => void) & { q?: unknown[] };
  w.clarity = c;
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}
