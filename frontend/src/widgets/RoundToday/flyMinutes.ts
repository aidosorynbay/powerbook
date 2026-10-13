import { rustle, thud } from './haptics';

/**
 * «Сохранить» → the minutes fly into the calendar (the founder's idea, 2026-10-13): a few pages lift off the dial
 * with a rustle, the page scrolls down to the calendar, and the pages swirl into today's cell, which glows as they
 * land with a soft thud. Fixed-position elements on <body>, Web Animations only; nothing at all under «reduce
 * motion» but the scroll.
 */
export async function flyMinutes(from: DOMRect, target: () => HTMLElement | null, minutes: number, done: boolean) {
  const cell = target();
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!cell) return;
  cell.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
  if (still || typeof document.body.animate !== 'function') return;

  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  const N = Math.min(7, 3 + Math.round(minutes / 20));
  const tint = done ? '#6fd18d' : '#e9c94a';
  const pages: HTMLElement[] = [];
  for (let i = 0; i < N; i++) {
    const p = document.createElement('div');
    const w = 22 + Math.random() * 6;
    p.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      `width:${w}px`,
      `height:${w * 1.32}px`,
      'border-radius:2px 5px 5px 2px',
      `background:linear-gradient(105deg,#fffdf6 0%,#f3ead6 62%,${tint} 63%,${tint} 70%,#e8dcc2 71%)`,
      'box-shadow:0 6px 14px -6px rgba(0,0,0,.55)',
      'z-index:2000',
      'pointer-events:none',
      'will-change:transform,opacity',
    ].join(';');
    document.body.appendChild(p);
    pages.push(p);
  }
  // the label rides with the first page
  const label = document.createElement('div');
  label.textContent = `+${minutes}`;
  label.style.cssText = `position:fixed;left:0;top:0;z-index:2001;pointer-events:none;font:800 18px/1 Onest,system-ui,sans-serif;color:${tint};text-shadow:0 2px 10px rgba(0,0,0,.6);will-change:transform,opacity`;
  document.body.appendChild(label);

  rustle();
  // 1) lift off the dial, each page its own way
  const lift = pages.map((_, i) => ({
    x: cx + (Math.random() - 0.5) * 140,
    y: cy - 70 - Math.random() * 90,
    r: (Math.random() - 0.5) * 70,
    i,
  }));
  const up = pages.map((p, i) =>
    p.animate(
      [
        { transform: `translate(${cx - 12}px, ${cy - 16}px) rotate(0deg) scale(.4)`, opacity: 0 },
        { transform: `translate(${lift[i].x - 12}px, ${lift[i].y - 16}px) rotate(${lift[i].r}deg) scale(1)`, opacity: 1 },
      ],
      { duration: 420, delay: i * 45, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'both' },
    ),
  );
  const labelUp = label.animate(
    [
      { transform: `translate(${cx - 20}px, ${cy - 10}px) scale(.6)`, opacity: 0 },
      { transform: `translate(${cx - 20}px, ${cy - 120}px) scale(1.2)`, opacity: 1 },
    ],
    { duration: 520, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'both' },
  );
  await Promise.all(up.map((a) => a.finished.catch(() => {})));
  // the pages keep where they flew to, now moved by hand
  pages.forEach((p, i) => {
    p.style.transform = `translate(${lift[i].x - 12}px, ${lift[i].y - 16}px) rotate(${lift[i].r}deg)`;
    p.style.opacity = '1';
  });
  up.forEach((a) => a.cancel());
  labelUp.cancel();

  // 2) a swirl down into today's cell, aimed anew every frame: the page is still scrolling under the pages
  const D = 760;
  const stagger = 60;
  const t0 = performance.now();
  const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  let landed = false;
  await new Promise<void>((resolve) => {
    const frame = (now: number) => {
      const el = target();
      const to = el?.getBoundingClientRect();
      if (!to) {
        resolve();
        return;
      }
      const tx = to.left + to.width / 2;
      const ty = to.top + to.height / 2;
      let all = true;
      pages.forEach((p, i) => {
        const t = Math.max(0, Math.min(1, (now - t0 - i * stagger) / D));
        if (t < 1) all = false;
        const e = ease(t);
        const sx = lift[i].x;
        const sy = lift[i].y;
        // a quadratic curve through a point off to the side, so the pages swirl rather than fall
        const mx = (sx + tx) / 2 + (i % 2 ? 70 : -70);
        const my = Math.min(sy, ty) - 30;
        const x = (1 - e) ** 2 * sx + 2 * (1 - e) * e * mx + e * e * tx;
        const y = (1 - e) ** 2 * sy + 2 * (1 - e) * e * my + e * e * ty;
        const r = lift[i].r + 320 * e;
        const sc = 1 - 0.75 * e;
        p.style.transform = `translate(${x - 12}px, ${y - 16}px) rotate(${r}deg) scale(${sc})`;
        p.style.opacity = String(t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1);
      });
      const tl = Math.max(0, Math.min(1, (now - t0) / D));
      const el2 = ease(tl);
      label.style.transform = `translate(${cx - 20 + (tx - cx) * el2}px, ${cy - 120 + (ty - 12 - (cy - 120)) * el2}px) scale(${1.2 - 0.5 * el2})`;
      label.style.opacity = String(1 - el2);
      if (!landed && now - t0 > D * 0.92) {
        landed = true;
        thud(done);
        el?.animate(
          [
            { transform: 'scale(1)', boxShadow: `0 0 0 0 ${tint}` },
            { transform: 'scale(1.18)', boxShadow: `0 0 0 6px ${tint}55` },
            { transform: 'scale(1)', boxShadow: `0 0 0 0 ${tint}00` },
          ],
          { duration: 520, easing: 'cubic-bezier(.2,.9,.3,1.3)' },
        );
      }
      if (all) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  pages.forEach((p) => p.remove());
  label.remove();
}
