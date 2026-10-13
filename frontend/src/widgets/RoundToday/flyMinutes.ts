import { chime, thud } from './haptics';

/**
 * «Сохранить» → the day's cell takes the minutes (2026-10-13). The founder found flying pages cheap; the council's
 * spec: one thing moves at a time. The page glides to the calendar (the founder wants it there), then today's cell
 * fills from its centre like ink in its colour (green from 30 minutes, amber below), the minutes count up in it,
 * the cell breathes once, and one quiet wooden tick sounds — with a two-note chime only when the day now counts.
 * Under «reduce motion» the colour and the number simply fade in.
 */
export async function flyMinutes(_from: DOMRect | null, target: () => HTMLElement | null, minutes: number, done: boolean) {
  const cell = target();
  if (!cell) return;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const r0 = cell.getBoundingClientRect();
  const visible = r0.top > 60 && r0.bottom < window.innerHeight - 70;
  if (!visible) cell.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
  if (typeof cell.animate !== 'function') return;

  // wait for the glide to bring the cell to rest on the screen
  await new Promise<void>((resolve) => {
    let last = -1;
    let calm = 0;
    const t0 = performance.now();
    const check = () => {
      const top = target()?.getBoundingClientRect().top ?? 0;
      calm = Math.abs(top - last) < 0.5 ? calm + 1 : 0;
      last = top;
      if (calm >= 4 || performance.now() - t0 > 1200) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });

  const el = target();
  if (!el) return;
  const day = Number((el.dataset.day ?? '').slice(8, 10)) || '';
  const fill = done ? 'var(--color-success-fill)' : 'var(--color-warning-fill)';
  const ink = document.createElement('div');
  ink.setAttribute('aria-hidden', 'true');
  ink.style.cssText = [
    'position:absolute',
    'inset:0',
    'border-radius:inherit',
    `background:${fill}`,
    'color:var(--color-on-status)',
    'display:grid',
    'place-content:center',
    'text-align:center',
    'line-height:1.05',
    'z-index:2',
    'pointer-events:none',
    still ? 'opacity:0' : 'clip-path:circle(0% at 50% 50%)',
  ].join(';');
  const n = document.createElement('b');
  n.textContent = String(day);
  n.style.cssText = 'font-size:var(--font-size-sm);font-weight:700';
  const m = document.createElement('small');
  m.style.cssText = 'font-size:10px;opacity:.75;font-variant-numeric:tabular-nums';
  ink.append(n, m);
  el.appendChild(ink);

  if (still) {
    m.textContent = String(minutes);
    await ink.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: 'forwards' }).finished.catch(() => {});
  } else {
    const t0 = performance.now();
    ink.animate([{ clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(75% at 50% 50%)' }], {
      duration: 420,
      easing: 'cubic-bezier(.3,0,0,1)',
      fill: 'forwards',
    });
    // made easier to see (the founder: «не прям заметно»): the other days dim for a moment, the day jumps, two
    // rings spread from it and «+N мин» rises over it
    el.style.zIndex = '3';
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.24)' }, { transform: 'scale(1)' }], {
      duration: 640,
      easing: 'cubic-bezier(.34,1.56,.64,1)',
    });
    const others = [...(el.parentElement?.children ?? [])].filter((c) => c !== el) as HTMLElement[];
    others.forEach((c) =>
      c.animate([{ opacity: 1 }, { opacity: 0.32, offset: 0.2 }, { opacity: 0.32, offset: 0.75 }, { opacity: 1 }], {
        duration: 1300,
        easing: 'ease-in-out',
      }),
    );
    const box = el.getBoundingClientRect();
    const tint = done ? 'var(--color-success)' : 'var(--color-warning)';
    for (const [delay, size] of [[0, 2.3], [140, 3]] as const) {
      const ring = document.createElement('div');
      ring.style.cssText = `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;border-radius:12px;border:2px solid ${tint};pointer-events:none;z-index:1500`;
      document.body.appendChild(ring);
      ring
        .animate([{ transform: 'scale(1)', opacity: 0.9 }, { transform: `scale(${size})`, opacity: 0 }], { duration: 760, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' })
        .finished.then(() => ring.remove(), () => ring.remove());
    }
    const chip = document.createElement('div');
    chip.textContent = `+${minutes} мин`;
    chip.style.cssText = `position:fixed;left:${box.left + box.width / 2}px;top:${box.top - 10}px;transform:translate(-50%,0);padding:5px 11px;border-radius:999px;background:${fill};color:var(--color-on-status);font:800 14px/1 Onest,system-ui,sans-serif;font-variant-numeric:tabular-nums;box-shadow:0 8px 20px -8px rgba(0,0,0,.6);pointer-events:none;z-index:1600;white-space:nowrap`;
    document.body.appendChild(chip);
    chip
      .animate(
        [
          { transform: 'translate(-50%, 8px) scale(.8)', opacity: 0 },
          { transform: 'translate(-50%, -26px) scale(1)', opacity: 1, offset: 0.25 },
          { transform: 'translate(-50%, -30px) scale(1)', opacity: 1, offset: 0.8 },
          { transform: 'translate(-50%, -40px) scale(.96)', opacity: 0 },
        ],
        { duration: 1500, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' },
      )
      .finished.then(() => chip.remove(), () => chip.remove());
    window.setTimeout(() => { el.style.zIndex = ''; }, 700);
    await new Promise<void>((resolve) => {
      const count = (now: number) => {
        const k = Math.min(1, (now - t0) / 400);
        m.textContent = String(Math.round(minutes * (1 - (1 - k) ** 3)));
        if (k < 1) requestAnimationFrame(count);
        else resolve();
      };
      requestAnimationFrame(count);
    });
  }
  thud(false);
  if (done) window.setTimeout(chime, 90);
  // the calendar's own cell has the new minutes by now: the ink fades off it
  window.setTimeout(() => {
    ink.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).finished.then(() => ink.remove(), () => ink.remove());
  }, 900);
}
