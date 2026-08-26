import { useEffect, useRef, useState } from 'react';

/**
 * Counts from 0 up to `target` once `active` turns true.
 *
 * Driven by requestAnimationFrame against wall-clock time rather than a
 * per-frame increment, so the run always takes `duration` regardless of the
 * display's refresh rate. Eases out, so the number decelerates into its
 * final value instead of stopping dead.
 *
 * Respects prefers-reduced-motion: those users get the final number
 * immediately rather than a moving target.
 */
export function useCountUp(target: number, active: boolean, duration = 1600): number {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion || target <= 0) {
      setValue(target);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [target, active, duration]);

  return value;
}
