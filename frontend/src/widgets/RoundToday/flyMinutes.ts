import { chime, thud } from './haptics';

/**
 * «Сохранить» → the day's cell takes the minutes (2026-10-13). The founder found flying pages cheap; the council's
 * spec: one thing moves at a time. The page glides to the calendar (the founder wants it there), then today's cell
 * fills from its centre like ink in its colour (green from 30 minutes, amber below), the minutes count up in it,
 * the cell breathes once, and one quiet wooden tick sounds — with a two-note chime only when the day now counts.
 * Under «reduce motion» the colour and the number simply fade in.
 */
export async function flyMinutes(_from: DOMRect | null, target: () => HTMLElement | null, minutes: number, done: boolean): Promise<HTMLElement | null> {
  const cell = target();
  if (!cell) return null;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const r0 = cell.getBoundingClientRect();
  const visible = r0.top > 60 && r0.bottom < window.innerHeight - 70;
  if (!visible) cell.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
  if (typeof cell.animate !== 'function') return null;

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
  if (!el) return null;
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
  return el;
}

export interface TreasuryDrop {
  /** what this save added to the circle today (minutes) */
  delta: number;
  /** the circle's minutes today before and after this save */
  before: number;
  after: number;
  /** «+45 мин», «Общая казна · сегодня», «14 ч 20 мин» */
  plus: string;
  label: string;
  total: (m: number) => string;
  /** the drop falls only on the day's first save; later saves get the pool line alone */
  fly: boolean;
  onTap: () => void;
}

const GOO_ID = 'pb-goo';
function gooFilter() {
  if (document.getElementById(GOO_ID)) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  svg.innerHTML = `<filter id="${GOO_ID}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="5"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"/></filter>`;
  document.body.appendChild(svg);
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/**
 * The second beat of a save (the council + the founder, 2026-10-15): today's cell sheds one drop of its own colour;
 * it gathers under the cell, lets go, falls with gravity and runs into the pool under the calendar — «Общая казна ·
 * сегодня 13 ч 35 мин» — the pool takes it with a ripple, «+45 мин» rises out of it and today's circle total counts up.
 * The drop and the pool are one liquid (a gooey SVG filter), so the joins are real. No other month, no race: my
 * minutes become part of ours. Reduce motion → the pool line with the new total, no drop.
 */
export async function dropToTreasury(cell: HTMLElement, grid: HTMLElement | null, d: TreasuryDrop) {
  if (!grid?.parentElement) return;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof cell.animate !== 'function';
  const cs = getComputedStyle(cell);
  const bg = cs.backgroundColor;
  const liquid = bg && bg !== 'transparent' && !bg.endsWith(', 0)') ? bg : 'var(--color-success-fill)';
  const text = 'var(--color-on-status)';

  // the pool: a line under the calendar that opens, holds the treasury and closes again
  const pool = document.createElement('button');
  pool.type = 'button';
  pool.setAttribute('aria-live', 'polite');
  pool.style.cssText = `position:relative;z-index:4;display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;height:0;margin:0;padding:0 16px;border:0;border-radius:16px;background:${liquid};color:${text};font:500 12px/1.2 system-ui,-apple-system,sans-serif;font-variant-numeric:tabular-nums;text-align:left;overflow:hidden;cursor:pointer;opacity:0`;
  const left = document.createElement('span');
  left.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0';
  const label = document.createElement('span');
  label.textContent = d.label;
  label.style.cssText = 'opacity:.78;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  const total = document.createElement('b');
  total.textContent = d.total(d.before);
  total.style.cssText = 'font-size:17px;font-weight:800;letter-spacing:-.01em;white-space:nowrap';
  left.append(label, total);
  const plus = document.createElement('b');
  plus.textContent = d.plus;
  plus.style.cssText = 'font-size:15px;font-weight:800;white-space:nowrap;opacity:0';
  pool.append(left, plus);
  pool.addEventListener('click', d.onTap);
  grid.insertAdjacentElement('afterend', pool);

  const H = 56;
  const open = pool.animate(
    [{ height: '0px', marginTop: '0px', opacity: 0 }, { height: `${H}px`, marginTop: '12px', opacity: 1 }],
    { duration: still ? 1 : 340, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
  );
  await open.finished.catch(() => {});

  const close = async () => {
    await wait(2600);
    await pool
      .animate([{ height: `${H}px`, marginTop: '12px', opacity: 1 }, { height: '0px', marginTop: '0px', opacity: 0 }], { duration: 380, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' })
      .finished.catch(() => {});
    pool.remove();
  };
  const count = (ms: number) =>
    new Promise<void>((resolve) => {
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / ms);
        total.textContent = d.total(Math.round(d.before + (d.after - d.before) * (1 - (1 - k) ** 3)));
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });

  if (still || !d.fly) {
    plus.style.opacity = '1';
    if (still) total.textContent = d.total(d.after);
    else await count(700);
    void close();
    return;
  }

  // keep the pool on the screen above the tab bar
  const pr0 = pool.getBoundingClientRect();
  const over = pr0.bottom - (window.innerHeight - 84);
  if (over > 0) {
    window.scrollBy({ top: over, behavior: 'smooth' });
    await wait(420);
  }

  // the liquid layer lives inside the calendar's card: under today's cell and the pool's words, over the other days
  gooFilter();
  const host = (grid.closest('[data-cal]') as HTMLElement | null) ?? grid.parentElement!;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const hr = host.getBoundingClientRect();
  const c = cell.getBoundingClientRect();
  const p = pool.getBoundingClientRect();
  const pad = 40;
  const L = Math.min(c.left, p.left) - pad;
  const T = c.top - pad;
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = `position:absolute;left:${L - hr.left}px;top:${T - hr.top}px;width:${Math.max(c.right, p.right) - L + pad}px;height:${p.bottom - T + pad}px;pointer-events:none;z-index:2;filter:url(#${GOO_ID})`;
  const blob = (x: number, y: number, w: number, h: number, r: string) => {
    const b = document.createElement('div');
    b.style.cssText = `position:absolute;left:${x - L}px;top:${y - T}px;width:${w}px;height:${h}px;border-radius:${r};background:${liquid};will-change:transform`;
    layer.appendChild(b);
    return b;
  };
  // the cell's own shape (hidden under the cell) so the drop is born from it; the pool's body; the drop
  const source = blob(c.left + 3, c.top + 3, c.width - 6, c.height - 6, cs.borderRadius || '10px');
  const body = blob(p.left, p.top, p.width, p.height, '16px');
  const R = Math.max(9, Math.min(13, c.width * 0.24));
  const cx = c.left + c.width / 2;
  const drop = blob(cx - R, c.bottom - R * 2.2, R * 2, R * 2, '50%');
  host.appendChild(layer);
  pool.style.background = 'transparent';
  // the pool's colour now comes from the liquid layer, the text stays above it
  const raised = cell.style.zIndex;
  cell.style.zIndex = '3';

  // 1. it gathers: swells out of the cell's bottom edge, a neck of liquid still holding it
  await drop
    .animate(
      [
        { transform: 'translateY(0) scale(.35, .5)' },
        { transform: `translateY(${R * 1.3}px) scale(.85, 1.15)`, offset: 0.6 },
        { transform: `translateY(${R * 1.9}px) scale(1, 1.05)` },
      ],
      { duration: 640, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' },
    )
    .finished.catch(() => {});

  // 2. it lets go and falls: gravity (ease-in), stretched by the speed; the cell's shape sinks back under the cell
  source.animate([{ transform: 'scale(1)' }, { transform: 'scale(.8)' }], { duration: 260, fill: 'forwards' });
  const y0 = R * 1.9;
  const yHit = p.top - (c.bottom - R * 2.2) - R * 1.2;
  const fall = Math.max(340, Math.min(620, Math.sqrt(Math.max(0, yHit - y0)) * 34));
  await drop
    .animate(
      [
        { transform: `translateY(${y0}px) scale(1, 1.05)` },
        { transform: `translateY(${y0 + (yHit - y0) * 0.35}px) scale(.82, 1.3)`, offset: 0.55 },
        { transform: `translateY(${yHit}px) scale(.74, 1.42)` },
      ],
      { duration: fall, easing: 'cubic-bezier(.55,0,1,.45)', fill: 'forwards' },
    )
    .finished.catch(() => {});

  // 3. it joins the pool: sinks in and spreads; the pool dips and swells back, a ripple runs both ways
  const hitX = cx - p.left;
  drop.animate(
    [
      { transform: `translateY(${yHit}px) scale(.74, 1.42)` },
      { transform: `translateY(${yHit + R * 1.6}px) scale(1.5, .7)`, offset: 0.45 },
      { transform: `translateY(${yHit + R * 2.4}px) scale(2.2, .3)` },
    ],
    { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
  );
  body.style.transformOrigin = `${hitX}px 0`;
  body.animate(
    [
      { transform: 'scale(1, 1)' },
      { transform: 'scale(1.01, .9)', offset: 0.22 },
      { transform: 'scale(.997, 1.05)', offset: 0.52 },
      { transform: 'scale(1, .99)', offset: 0.78 },
      { transform: 'scale(1, 1)' },
    ],
    { duration: 720, easing: 'ease-out' },
  );
  for (const dir of [-1, 1]) {
    const wave = blob(cx - R, p.top - R * 0.6, R * 2, R * 1.4, '50%');
    wave.animate(
      [
        { transform: 'translateX(0) scale(1, 1)', opacity: 1 },
        { transform: `translateX(${dir * Math.min(110, p.width * 0.32)}px) scale(.5, .4)`, opacity: 1 },
      ],
      { duration: 620, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' },
    );
  }
  pool.animate([{ transform: 'scale(1, 1)' }, { transform: 'scale(1.01, .93)', offset: 0.22 }, { transform: 'scale(1, 1.03)', offset: 0.55 }, { transform: 'scale(1, 1)' }], { duration: 720, easing: 'ease-out' });
  thud(true);

  // 4. «+45 мин» rises out of the pool, the total counts up
  plus.animate(
    [
      { transform: 'translateY(10px) scale(.7)', opacity: 0 },
      { transform: 'translateY(-2px) scale(1.08)', opacity: 1, offset: 0.6 },
      { transform: 'translateY(0) scale(1)', opacity: 1 },
    ],
    { duration: 420, delay: 80, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'forwards' },
  );
  await count(800);
  cell.style.zIndex = raised;

  // the liquid layer hands the colour back to the pool itself, which then closes
  pool.style.background = liquid;
  layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).finished.then(() => layer.remove(), () => layer.remove());
  void close();
}
