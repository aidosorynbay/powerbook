// Sentry error monitoring. Imported first in main.tsx so it is running
// before any app code that could throw.
//
// The DSN comes from VITE_SENTRY_DSN at build time. On the server it lives in
// frontend/.env.production.local, which the CI deploy does not overwrite
// (it rewrites .env.production). Without a DSN, Sentry stays off.
import { useEffect } from 'react';
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from 'react-router-dom';
import * as Sentry from '@sentry/react';

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.PROD ? 'production' : 'development',
    // Git commit of this build, injected by vite.config.ts. The backend reports
    // the same value, so both sides of one deploy share a release.
    release: __SENTRY_RELEASE__ || undefined,

    // Request bodies carry passwords and reading notes; never send them.
    dataCollection: { httpBodies: [] },

    integrations: [
      // Names page-load and navigation traces by route pattern
      // (/readers/:userId), not by the concrete URL.
      Sentry.reactRouterV6BrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
    ],

    // A tenth of page views is plenty for a site this size and keeps the
    // free quota for errors.
    tracesSampleRate: 0.1,
    // Continue the trace into the API so a slow page links to its backend spans.
    tracePropagationTargets: [/^\//, /^https:\/\/powerbook\.kz\/api/],
  });
}
