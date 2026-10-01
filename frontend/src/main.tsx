import './instrument';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@/app';
import { initAnalytics } from '@/shared/lib';

initAnalytics();

// After a deploy, a page opened before it asks for code files the new build
// has replaced (Sentry: "Failed to fetch dynamically imported module"). Load
// the new build once instead of showing an error; a second failure within a
// minute is a real one and is left to show.
window.addEventListener('vite:preloadError', (event) => {
  const key = 'pb.reloadedForBuild';
  try {
    const last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    /* storage blocked: reload all the same */
  }
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register the service worker that makes the app installable. Failure is
// non-fatal by design: the site works exactly the same without it, and a
// blocked registration (private mode, unsupported browser) must not break
// the page.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline support unavailable — not worth surfacing to the reader */
    });
  });
}
