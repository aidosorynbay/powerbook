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
  /** «+45 мин», «в общую казну · круг сегодня», «14 ч 20 мин» */
  plus: string;
  words: string;
  total: (m: number) => string;
  /** the drop flies only on the day's first save; later saves get the line alone */
  fly: boolean;
  onTap: () => void;
}

/**
 * The second beat of a save (the council, 2026-10-15): one drop leaves today's cell for «Круг», the tab glows, and
 * a line takes the weekday row for a few seconds — «+45 мин в общую казну · круг сегодня 14 ч 20 мин», today's
 * circle total counting up. No other month, no race: my minutes become part of ours. Reduce motion → the line alone.
 */
export async function dropToTreasury(cell: HTMLElement, seg: HTMLElement | null, row: HTMLElement | null, d: TreasuryDrop) {
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (d.fly && !still && seg && typeof cell.animate === 'function') {
    const a = cell.getBoundingClientRect();
    const b = seg.getBoundingClientRect();
    const x0 = a.left + a.width / 2;
    const y0 = a.top + a.height / 2;
    const dx = b.left + b.width / 2 - x0;
    const dy = b.top + b.height / 2 - y0;
    const lift = Math.min(70, Math.abs(dx) * 0.35 + 30);
    const drop = document.createElement('div');
    drop.setAttribute('aria-hidden', 'true');
    drop.style.cssText = `position:fixed;left:${x0 - 7}px;top:${y0 - 7}px;width:14px;height:14px;border-radius:50%;background:var(--color-success-fill);box-shadow:0 0 0 3px color-mix(in srgb, var(--color-success) 25%, transparent),0 6px 16px -4px rgba(0,0,0,.5);pointer-events:none;z-index:1700`;
    document.body.appendChild(drop);
    // a short arc: up and over, then down into the tab
    await drop
      .animate(
        [
          { transform: 'translate(0,0) scale(.4)', opacity: 0 },
          { transform: 'translate(0,-6px) scale(1.1)', opacity: 1, offset: 0.12 },
          { transform: `translate(${dx * 0.5}px, ${Math.min(0, dy) * 0.5 - lift}px) scale(1)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${dx}px, ${dy}px) scale(.55)`, opacity: 1 },
        ],
        { duration: 720, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' },
      )
      .finished.catch(() => {});
    drop.remove();
    seg.animate(
      [
        { transform: 'scale(1)', boxShadow: '0 0 0 0 var(--color-success)' },
        { transform: 'scale(1.12)', boxShadow: '0 0 0 4px color-mix(in srgb, var(--color-success) 45%, transparent)', offset: 0.35 },
        { transform: 'scale(1)', boxShadow: '0 0 0 10px transparent' },
      ],
      { duration: 620, easing: 'cubic-bezier(.34,1.56,.64,1)' },
    );
    thud(true);
  }
  if (!row) return;
  // the line sits over the weekday row, so nothing below moves
  const host = row.parentElement;
  if (!host) return;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const r = row.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  const line = document.createElement('button');
  line.type = 'button';
  line.style.cssText = `position:absolute;left:0;right:0;top:${r.top - h.top - 4}px;height:${r.height + 8}px;display:flex;align-items:center;justify-content:center;gap:5px;padding:0 6px;border:0;border-radius:999px;background:var(--color-bg-card);color:var(--color-text-secondary);font:500 12.5px/1 system-ui,-apple-system,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;cursor:pointer;z-index:4`;
  const plus = document.createElement('b');
  plus.textContent = d.plus;
  plus.style.cssText = 'color:var(--color-success);font-weight:800';
  const words = document.createElement('span');
  words.textContent = d.words;
  const total = document.createElement('b');
  total.style.cssText = 'color:var(--color-text-primary);font-weight:700';
  total.textContent = d.total(d.before);
  line.append(plus, words, total);
  line.addEventListener('click', d.onTap);
  host.appendChild(line);
  const show = line.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: still ? 150 : 260, easing: 'ease-out', fill: 'forwards' });
  await show.finished.catch(() => {});
  if (!still) {
    await new Promise<void>((resolve) => {
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 700);
        total.textContent = d.total(Math.round(d.before + (d.after - d.before) * (1 - (1 - k) ** 3)));
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  } else total.textContent = d.total(d.after);
  window.setTimeout(() => {
    line.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' }).finished.then(() => line.remove(), () => line.remove());
  }, 3200);
}
