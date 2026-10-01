import './instrument';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@/app';
import { initAnalytics } from '@/shared/lib';

initAnalytics();

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
