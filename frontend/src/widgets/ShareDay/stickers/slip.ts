import { ORANGE, SANS, SERIF, ascent, fit, font, release, roundRect, seeded, spaced, surface, tinted, wear, wrap, type Ctx } from './canvas';
import { crop } from './parts';
import type { StickerData } from './types';

const W = 1000;
const CARD_X = 50;
const CARD_W = 900;
const PAD = 62;
const PAPER = '#F4EBD9';
const PRINT = '#2C2520';
const PRINT_SOFT = 'rgba(44, 37, 32, 0.64)';
const RULE = 'rgba(120, 98, 62, 0.42)';
const VIOLET = '#4644A6';
const RED = '#CF451C';
const PENCIL = 'rgba(70, 66, 62, 0.78)';
const GOAL = 30;

/**
 * «Формуляр»: the slip glued inside a library book, where every return was
 * stamped. Each day of 30 minutes gets a violet date stamp, a shorter day a
 * pencilled number, and today a red «Зачтено» across the slip. The card is
 * paper, not ink, so it reads on any photo.
 */
export function drawSlip(data: StickerData, mark: HTMLCanvasElement | null): HTMLCanvasElement {
  const { words } = data;
  const { c, ctx } = surface(W, 1700);
  const x0 = CARD_X + PAD;
  const x1 = CARD_X + CARD_W - PAD;
  const inner = x1 - x0;
  const top = 44;
  ctx.textBaseline = 'alphabetic';

  // Everything is laid out on a scratch canvas first: the card's height depends on it.
  const { c: print, ctx: p } = surface(W, 1700);
  p.textBaseline = 'alphabetic';
  let y = top + 58;

  // Header: the library, and its mark.
  p.font = font(62, 700, SERIF);
  p.fillStyle = PRINT;
  y += ascent(p, 'PowerBook');
  p.textAlign = 'left';
  p.fillText('PowerBook', x0, y);
  imprintMark(p, x1, y, mark);

  p.font = font(30, 600, SANS);
  p.fillStyle = PRINT_SOFT;
  y += 54;
  spaced(p, words.slip.title, x0, y, 2.4, 'left');
  p.font = font(36, 400, SERIF, true);
  p.fillStyle = PRINT;
  p.textAlign = 'right';
  p.fillText(words.monthYear, x1, y);
  p.textAlign = 'left';

  y += 30;
  p.fillStyle = PRINT;
  p.fillRect(x0, y, inner, 3);
  p.fillRect(x0, y + 9, inner, 1.5);
  y += 9;

  // Filled-in fields, as if in ink by the librarian.
  y += 78;
  field(p, words.slip.reader, data.name, x0, x1, y, 52);
  if (words.quoted) {
    y += 82;
    field(p, words.slip.book, words.quoted, x0, x1, y, 44);
  }

  // The grid of days, a column at a time like a real slip.
  y += 76;
  p.font = font(28, 600, SANS);
  p.fillStyle = PRINT_SOFT;
  spaced(p, words.slip.days, x0, y, 2, 'left');
  y += 22;
  const cols = 4;
  const n = data.days.length;
  const rows = Math.ceil(n / cols);
  const rowH = 62;
  const colW = inner / cols;
  const gridTop = y;
  p.fillStyle = RULE;
  for (let r = 0; r <= rows; r++) p.fillRect(x0, gridTop + r * rowH, inner, r === 0 || r === rows ? 2.5 : 1.5);
  for (let k = 1; k < cols; k++) p.fillRect(x0 + k * colW, gridTop, 1.5, rows * rowH);
  const gridBottom = gridTop + rows * rowH;

  const stamps = surface(W, 1700);
  data.days.forEach((d, i) => {
    if (d.date > data.day || d.minutes < 2) return;
    const col = Math.floor(i / rows);
    const row = i % rows;
    const cx = x0 + col * colW + colW / 2;
    const cy = gridTop + row * rowH + rowH / 2;
    const rnd = seeded(`slip:${d.date}`);
    if (d.minutes >= GOAL) {
      const dd = d.date.slice(8, 10);
      const s = stamp([{ text: `${dd} ${words.monthShort}`, size: 32, weight: 700 }], VIOLET, d.date, 0.9, false);
      placeOnce(stamps.ctx, s, cx + (rnd() - 0.5) * 14, cy + (rnd() - 0.5) * 8, (rnd() - 0.5) * 0.16, 0.9);
    } else {
      // A short day: the minutes pencilled in, no stamp.
      const pc = stamps.ctx;
      pc.save();
      pc.translate(cx, cy + 11);
      pc.rotate((rnd() - 0.5) * 0.08);
      pc.font = font(34, 400, SERIF, true);
      pc.fillStyle = PENCIL;
      pc.textAlign = 'center';
      pc.fillText(`${d.minutes} ${words.slip.min}`, 0, 0);
      pc.restore();
    }
  });

  // Today, across the slip in red.
  const done = data.minutes >= GOAL;
  const big = stamp(
    [
      { text: done ? words.slip.done : `${data.minutes} ${words.slip.min}`, size: 68, weight: 800 },
      { text: done ? `${data.minutes} ${words.slip.min} · ${words.date}` : words.date, size: 30, weight: 700 },
    ],
    RED,
    `today:${data.day}`,
    1.1,
    true,
    inner * 0.48
  );
  // It goes below the grid, over its bottom rule, so no day's stamp is covered.
  const bigW = big.width;
  const bigH = big.height;
  const bigX = x1 - bigW / 2 + 10;
  const bigY = gridBottom + bigH / 2 + 8;
  placeOnce(stamps.ctx, big, bigX, bigY, -0.12, 0.92);

  // Footer: the run of days, and where to find the library.
  let foot = gridBottom + 64;
  p.textAlign = 'left';
  const room = bigX - bigW / 2 - x0 - 12;
  if (words.streak) {
    p.font = font(fit(p, words.streak, room, 42, 28, (z) => font(z, 400, SERIF, true)), 400, SERIF, true);
    p.fillStyle = PRINT;
    p.fillText(words.streak, x0, foot);
    foot += 46;
  }
  p.font = font(28, 600, SANS);
  p.fillStyle = PRINT_SOFT;
  p.fillText(words.site, x0, foot);
  foot = Math.max(foot + 50, bigY + bigH / 2 + 40);
  const cardH = foot - top;

  // The card: paper with a shadow under it, then its grain, then the print and the stamps.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
  ctx.shadowBlur = 44;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = PAPER;
  roundRect(ctx, CARD_X, top, CARD_W, cardH, 14);
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, CARD_X, top, CARD_W, cardH, 14);
  ctx.clip();
  paper(ctx, CARD_X, top, CARD_W, cardH, data.day);
  ctx.drawImage(print, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(stamps.c, 0, 0);
  ctx.restore();
  release(print);
  release(stamps.c);
  return crop(c, top + cardH + 70);
}

/** "Читатель ___Мадияр___": a printed label, and the value written on its line. */
function field(p: Ctx, label: string, value: string, x0: number, x1: number, y: number, size: number) {
  p.textAlign = 'left';
  p.font = font(28, 500, SANS);
  p.fillStyle = PRINT_SOFT;
  p.fillText(label, x0, y);
  const start = x0 + p.measureText(label).width + 22;
  p.fillStyle = RULE;
  p.fillRect(start, y + 12, x1 - start, 2);
  const s = fit(p, value, x1 - start - 16, size, 30, (z) => font(z, 500, SERIF, true));
  p.font = font(s, 500, SERIF, true);
  p.fillStyle = PRINT;
  p.fillText(wrap(p, value, x1 - start - 16, 1)[0] ?? '', start + 12, y + 2);
}

/** The orange mark at the header's right, sitting on its baseline. */
function imprintMark(p: Ctx, right: number, baseline: number, mark: HTMLCanvasElement | null) {
  if (!mark) return;
  const logo = tinted(mark, ORANGE, 64);
  p.drawImage(logo, right - logo.width, baseline - logo.height + 6);
  release(logo);
}

type Line = { text: string; size: number; weight: number };

/** A rubber stamp: the lines in a frame, in one ink, worn at random. */
function stamp(given: Line[], color: string, seed: string, worn: number, double: boolean, maxWidth = Infinity): HTMLCanvasElement {
  const probe = surface(10, 10).ctx;
  const measure = (ls: Line[]) =>
    ls.map((l) => {
      probe.font = font(l.size, l.weight, SANS);
      return probe.measureText(l.text).width;
    });
  // A long word («Есептелді») makes the whole stamp smaller rather than wider.
  const k = Math.min(1, maxWidth / Math.max(...measure(given)));
  const lines = given.map((l) => ({ ...l, size: l.size * k }));
  const widths = measure(lines);
  const padX = double ? 38 : 16;
  const padY = double ? 26 : 10;
  const gap = 12;
  const heights = lines.map((l) => l.size * 0.74);
  const w = Math.max(...widths) + padX * 2;
  const h = heights.reduce((a, b) => a + b, 0) + gap * (lines.length - 1) + padY * 2;
  const { c, ctx } = surface(w + 8, h + 8);
  ctx.translate(4, 4);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = double ? 5 : 3.2;
  roundRect(ctx, 0, 0, w, h, double ? 10 : 7);
  ctx.stroke();
  if (double) {
    ctx.lineWidth = 2;
    roundRect(ctx, 9, 9, w - 18, h - 18, 6);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let y = padY;
  lines.forEach((l, i) => {
    ctx.font = font(l.size, l.weight, SANS);
    y += heights[i];
    ctx.fillText(l.text, w / 2, y);
    y += gap;
  });
  wear(c, seed, worn);
  return c;
}

function place(ctx: Ctx, img: HTMLCanvasElement, cx: number, cy: number, angle: number, alpha: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();
}

function placeOnce(ctx: Ctx, img: HTMLCanvasElement, cx: number, cy: number, angle: number, alpha: number) {
  place(ctx, img, cx, cy, angle, alpha);
  release(img);
}

/** Old paper: a warm tone darker at the edges, flecks, and a few fibres. */
function paper(ctx: Ctx, x: number, y: number, w: number, h: number, seed: string) {
  const rnd = seeded(`paper:${seed}`);
  const edge = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.35, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
  edge.addColorStop(0, 'rgba(150, 118, 60, 0)');
  edge.addColorStop(1, 'rgba(150, 118, 60, 0.2)');
  ctx.fillStyle = edge;
  ctx.fillRect(x, y, w, h);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(90, 70, 40, ${0.03 + rnd() * 0.06})`;
    const r = 0.5 + rnd() * 1.3;
    ctx.fillRect(x + rnd() * w, y + rnd() * h, r, r);
  }
  ctx.strokeStyle = 'rgba(110, 88, 52, 0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 70; i++) {
    const fx = x + rnd() * w;
    const fy = y + rnd() * h;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.quadraticCurveTo(fx + (rnd() - 0.5) * 30, fy + (rnd() - 0.5) * 30, fx + (rnd() - 0.5) * 50, fy + (rnd() - 0.5) * 50);
    ctx.stroke();
  }
}
