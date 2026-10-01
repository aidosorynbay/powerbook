/// <reference types="vite/client" />

// Git commit of the build, set in vite.config.ts.
declare const __SENTRY_RELEASE__: string;

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_GA_ID?: string;
}

declare module '*.module.css' {
  const classes: { [key: string]: string };
  export default classes;
}
