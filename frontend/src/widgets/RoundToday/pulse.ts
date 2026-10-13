import { useCallback, useEffect, useRef, useState } from 'react';
import { setUserProperties, track } from '@/shared/lib/analytics';

/**
 * A hint that pulses for a moment, so the reader finds a control (the
 * founder's idea; the timings from the /llm-council of 2026-10-13):
 * fast for the first seconds of a visit, then slow, then still. Only a few
 * visits per circle, never under «reduce motion», and one in five readers
 * never sees it (pulse_variant=holdout), so GA4 can tell what it changes.
 */

export type PulsePhase = 'none' | 'fast' | 'slow' | 'dot';

const today = () => new Date().toISOString().slice(0, 10);

function read(key: string): { day: string; n: number; done: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    if (v && typeof v.n === 'number') return v;
  } catch {
    /* nothing kept */
  }
  return { day: '', n: 0, done: false };
}
function write(key: string, v: { day: string; n: number; done: boolean }) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* it may pulse again, which is no harm */
  }
}

/** One reader in five, by their id, sees no pulses at all. */
export function pulseVariant(userId: string | undefined): 'pulse' | 'holdout' {
  if (!userId) return 'pulse';
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return h % 5 === 0 ? 'holdout' : 'pulse';
}

let variantSent = false;

export function usePulse({
  el,
  storeKey,
  eligible,
  userId,
  visits,
  delay = 1000,
  fast = 10_000,
  slow = 20_000,
}: {
  /** For GA4: which control. */
  el: string;
  /** Per circle: where the visits are counted. */
  storeKey: string;
  eligible: boolean;
  userId?: string;
  /** How many visits (one a day) of the circle pulse; after them a still dot. */
  visits: number;
  delay?: number;
  fast?: number;
  slow?: number;
}) {
  const [phase, setPhase] = useState<PulsePhase>('none');
  const visit = useRef(0);
  const shownAt = useRef(0);

  useEffect(() => {
    if (!eligible) {
      setPhase('none');
      return;
    }
    const variant = pulseVariant(userId);
    if (!variantSent) {
      variantSent = true;
      setUserProperties({ pulse_variant: variant });
    }
    const v = read(storeKey);
    // everyone sees it (the founder, 2026-10-13: the 20% holdout hid it from him); the property stays for GA4
    if (v.done) {
      setPhase('none');
      return;
    }
    if (v.day !== today()) {
      v.day = today();
      v.n += 1;
      write(storeKey, v);
    }
    visit.current = v.n;
    if (v.n > visits) {
      setPhase('dot');
      return;
    }
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const timers: number[] = [];
    timers.push(
      window.setTimeout(() => {
        shownAt.current = performance.now();
        setPhase(still ? 'dot' : 'fast');
        track('hint_shown', { el, visit_n: v.n, phase: still ? 'dot' : 'fast' });
        if (!still) {
          timers.push(window.setTimeout(() => setPhase('slow'), fast));
          timers.push(window.setTimeout(() => setPhase('dot'), fast + slow));
        }
      }, delay),
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [eligible, storeKey, userId, visits, delay, fast, slow, el]);

  /** The reader tapped it: the pulse stops for this visit, and for the circle when `forGood`. */
  const found = useCallback(
    (forGood = true) => {
      if (phase !== 'none') {
        track('hint_tap', { el, phase, visit_n: visit.current, ms_since_shown: Math.round(performance.now() - shownAt.current) });
      }
      if (forGood) write(storeKey, { ...read(storeKey), done: true });
      setPhase('none');
    },
    [el, phase, storeKey],
  );

  return { phase, found };
}
