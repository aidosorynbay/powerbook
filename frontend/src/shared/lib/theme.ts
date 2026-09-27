import { useCallback, useEffect, useState } from 'react';

/**
 * Light or dark: the reader's choice, or the system's. The choice lives in
 * localStorage under THEME_KEY; index.html reads it before the first paint so
 * the page never flashes the wrong colours. Dark stays the default.
 */
export type ThemeChoice = 'dark' | 'light' | 'system';

export const THEME_KEY = 'pb.theme';
const BAR = { dark: '#0D1117', light: '#F5F6F8' } as const;
const ORDER: ThemeChoice[] = ['dark', 'light', 'system'];

export function readThemeChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // storage blocked: fall through to the default
  }
  return 'dark';
}

function systemIsLight(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ?? false;
}

export function resolveTheme(choice: ThemeChoice): 'dark' | 'light' {
  if (choice === 'system') return systemIsLight() ? 'light' : 'dark';
  return choice;
}

export function applyTheme(choice: ThemeChoice): void {
  const theme = resolveTheme(choice);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[theme]);
  window.dispatchEvent(new CustomEvent('pb:theme', { detail: theme }));
}

export function useTheme(): { choice: ThemeChoice; theme: 'dark' | 'light'; cycle: () => void } {
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice);

  useEffect(() => {
    applyTheme(choice);
    if (choice !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const follow = () => applyTheme('system');
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, [choice]);

  const cycle = useCallback(() => {
    setChoice((current) => {
      const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // storage blocked: the choice lasts for this visit
      }
      return next;
    });
  }, []);

  return { choice, theme: resolveTheme(choice), cycle };
}
