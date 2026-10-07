import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

// The release Sentry files errors under: SENTRY_RELEASE if the deploy sets
// it, otherwise the checked-out commit. The backend uses the same value.
function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

// The reading room's photos and masks keep their names when they change, and
// the server sends them with no cache rule, so a browser could go on showing
// the old ones for hours after a deploy (2026-10-07: the founder saw readers
// with cut legs that had been fixed that morning). The engine asks for each
// file with a hash of its bytes in the URL, so a changed file is a new URL.
function readingRoomVersions(): Record<string, string> {
  const dir = path.resolve(__dirname, 'public/reading-room');
  const out: Record<string, string> = {};
  try {
    for (const name of fs.readdirSync(dir)) {
      out[name] = createHash('md5').update(fs.readFileSync(path.join(dir, name))).digest('hex').slice(0, 10);
    }
  } catch {
    /* no folder: plain URLs */
  }
  return out;
}

export default defineConfig(({ mode }) => {
  // Sentry settings may sit in the shell or in frontend/.env.production.local
  // on the server (the CI deploy leaves that file alone). Only VITE_* values
  // reach the browser; the auth token stays in this config.
  const env = { ...loadEnv(mode, process.cwd(), 'SENTRY_'), ...process.env };
  const release = env.SENTRY_RELEASE || gitCommit();
  // Source maps are built and uploaded only when a Sentry auth token is
  // present, then deleted from dist so nginx never serves them.
  const uploadSourceMaps = Boolean(env.SENTRY_AUTH_TOKEN);

  return {
    plugins: [
      react(),
      uploadSourceMaps &&
        sentryVitePlugin({
          org: env.SENTRY_ORG || 'powerbook',
          project: env.SENTRY_PROJECT || 'powerbook-frontend',
          authToken: env.SENTRY_AUTH_TOKEN,
          release: { name: release || undefined },
          sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
          telemetry: false,
        }),
    ],
    define: {
      __SENTRY_RELEASE__: JSON.stringify(release),
      __RR_V__: JSON.stringify(readingRoomVersions()),
    },
    build: {
      sourcemap: uploadSourceMaps ? 'hidden' : false,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
    },
  };
});
