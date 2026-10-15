import { ORANGE, release, roundRect, surface, type Ctx, type Ink } from './canvas';
import type { StickerData } from './types';

/**
 * The three stickers, one family (the design pass of 2026-10-15/16: marketing/2026-10-sticker-design):
 * «Число» — the day's minutes, the book, the month's days; «Месяц» — the minutes, the book, the month as a
 * calendar; «Полка» — the minutes, the month's books on a shelf, the book. All of them left-aligned on the
 * same 72 px margin, the same two-pass shadow and the same foot: the mark and powerbook.kz. No name: the
 * story already says whose it is. Orange is today, the book of the day and the mark, nothing else.
 */

const W = 1080;
const PAD_TOP = 60;
const PAD_X = 72;
const PAD_BOTTOM = 64;
const MEASURE = W - 2 * PAD_X;

const ONEST = '"Onest", "Helvetica Neue", Arial, sans-serif';
const LITERATA = '"Literata", "Iowan Old Style", Georgia, serif';

/** The type and the paper under it: white on most photos, navy on a bright one. */
const COLORS: Record<Ink, { ink: string; paper: string; tight: string; wide: string }> = {
  light: { ink: '#FFFFFF', paper: '#0B1C26', tight: 'rgba(0, 0, 0, 0.40)', wide: 'rgba(0, 0, 0, 0.30)' },
  dark: { ink: '#0B1C26', paper: '#FFFFFF', tight: 'rgba(255, 255, 255, 0.55)', wide: 'rgba(255, 255, 255, 0.42)' },
};

type Page = { ctx: Ctx; ink: string; paper: string; y: number };

function face(size: number, weight: number, family: string) {
  return `${weight} ${Math.round(size)}px ${family}`;
}

/** Where the baseline of a line sits in a CSS line box of `size` × `lineHeight` that starts at `top`. */
function baseline(ctx: Ctx, top: number, size: number, lineHeight: number): number {
  const m = ctx.measureText('Hgд');
  const asc = m.fontBoundingBoxAscent || size * 0.95;
  const desc = m.fontBoundingBoxDescent || size * 0.25;
  return top + (size * lineHeight - (asc + desc)) / 2 + asc;
}

/** Text with tight tracking, letter by letter (the canvas's own letterSpacing is not everywhere yet). */
function tracked(ctx: Ctx, text: string, x: number, y: number, track: number, draw = true): number {
  let at = x;
  for (const ch of text) {
    if (draw) ctx.fillText(ch, at, y);
    at += ctx.measureText(ch).width + track;
  }
  return at - x - track;
}

/** The minutes, as big as they go: 560 px, smaller only when three figures would run past the measure. */
function hero(p: Page, minutes: number, size: number) {
  const { ctx } = p;
  const text = String(minutes);
  let s = size;
  ctx.font = face(s, 800, ONEST);
  const width = tracked(ctx, text, 0, 0, -0.055 * s, false);
  if (width > MEASURE) {
    s = (s * MEASURE) / width;
    ctx.font = face(s, 800, ONEST);
  }
  const top = p.y + 0.06 * s;
  ctx.fillStyle = p.ink;
  tracked(ctx, text, PAD_X - 0.05 * s, baseline(ctx, top, s, 0.74), -0.055 * s);
  p.y = top + 0.74 * s;
}

/** One line of Onest that shrinks rather than wraps («минуты чтения сегодня» in Kazakh or English). */
function line(p: Page, text: string, gap: number, size: number, weight: number, lineHeight: number) {
  const { ctx } = p;
  let s = size;
  ctx.font = face(s, weight, ONEST);
  const width = ctx.measureText(text).width;
  if (width > MEASURE) {
    s = Math.floor((s * MEASURE) / width);
    ctx.font = face(s, weight, ONEST);
  }
  const top = p.y + gap;
  ctx.fillStyle = p.ink;
  ctx.fillText(text, PAD_X, baseline(ctx, top, s, lineHeight));
  p.y = top + s * lineHeight;
}

/** The title on one line, or two of about the same length. */
function balanced(ctx: Ctx, text: string): string[] {
  if (ctx.measureText(text).width <= MEASURE) return [text];
  const words = text.split(/\s+/);
  let best: string[] | null = null;
  let bestWidth = Infinity;
  for (let i = 1; i < words.length; i++) {
    const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const widest = Math.max(...pair.map((l) => ctx.measureText(l).width));
    if (widest <= MEASURE && widest < bestWidth) {
      best = pair;
      bestWidth = widest;
    }
  }
  return best ?? [text];
}

/** The book of the day in upright Literata, the second thing read after the minutes. */
function title(p: Page, text: string, gap: number) {
  const { ctx } = p;
  let s = 90;
  ctx.font = face(s, 650, LITERATA);
  let lines = balanced(ctx, text);
  // A single word too long for the measure: smaller, never cut.
  while (lines.some((l) => ctx.measureText(l).width > MEASURE) && s > 56) {
    s -= 4;
    ctx.font = face(s, 650, LITERATA);
    lines = balanced(ctx, text);
  }
  ctx.fillStyle = p.ink;
  let top = p.y + gap;
  for (const l of lines) {
    ctx.fillText(l, PAD_X, baseline(ctx, top, s, 1.06));
    top += s * 1.06;
  }
  p.y = top;
}

/** The mark and the address, the way runners' stickers carry Strava's. */
function imprint(p: Page, mark: CanvasImageSource | null) {
  const { ctx } = p;
  const top = p.y + 72;
  const size = 104;
  let x = PAD_X;
  if (mark) {
    ctx.drawImage(mark, x, top, size, size);
    x += size + 26;
  }
  ctx.font = face(68, 700, ONEST);
  ctx.fillStyle = p.ink;
  ctx.fillText('powerbook.kz', x, baseline(ctx, top + (size - 68) / 2 - 2, 68, 1));
  p.y = top + size;
}

/** The month, Monday first: a filled square for a day of 30 minutes, an outline for a day with some, a faint
 * square for a day missed, a dashed one for a day still ahead, and today in orange. No numbers: they do not
 * survive a sticker pinched to half its size. */
function calendar(p: Page, data: StickerData, gap: number) {
  const { ctx } = p;
  const cell = 104;
  const space = 16;
  let top = p.y + gap;
  ctx.font = face(46, 600, ONEST);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = p.ink;
  ctx.fillText(data.words.month, PAD_X, baseline(ctx, top, 46, 1));
  top += 46 + 22;
  ctx.font = face(40, 600, ONEST);
  ctx.globalAlpha = 0.75;
  ctx.textAlign = 'center';
  data.words.weekdays.forEach((w, i) => ctx.fillText(w.toLocaleUpperCase(), PAD_X + i * (cell + space) + cell / 2, baseline(ctx, top, 40, 1)));
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
  top += 42 + space;

  const first = data.days[0]?.date;
  const offset = first ? (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  data.days.forEach((d, i) => {
    const at = offset + i;
    const x = PAD_X + (at % 7) * (cell + space);
    const y = top + Math.floor(at / 7) * (cell + space);
    ctx.save();
    if (d.date === data.day) {
      ctx.fillStyle = ORANGE;
      roundRect(ctx, x, y, cell, cell, 18);
      ctx.fill();
    } else if (d.date > data.day) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 5;
      ctx.setLineDash([12, 9]);
      roundRect(ctx, x + 2.5, y + 2.5, cell - 5, cell - 5, 16);
      ctx.stroke();
    } else if (d.minutes >= 30) {
      ctx.fillStyle = p.ink;
      roundRect(ctx, x, y, cell, cell, 18);
      ctx.fill();
    } else if (d.minutes > 0) {
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 9;
      roundRect(ctx, x + 4.5, y + 4.5, cell - 9, cell - 9, 14);
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = p.ink;
      roundRect(ctx, x, y, cell, cell, 18);
      ctx.fill();
    }
    ctx.restore();
  });
  const rows = Math.ceil((offset + data.days.length) / 7);
  p.y = top + rows * cell + (rows - 1) * space;
}

/** One book's spine: flat ink, one cloth band near the head, and the orange ribbon if it is the book of the day. */
function spine(p: Page, x: number, bottom: number, w: number, h: number, now: boolean, band = 22) {
  const { ctx } = p;
  ctx.fillStyle = p.ink;
  roundRect(ctx, x, bottom - h, w, h, [4, 4, 0, 0]);
  ctx.fill();
  ctx.fillStyle = p.paper;
  ctx.fillRect(x, bottom - h + band, w, 8);
  if (now) {
    const rx = x + w / 2 - 9;
    const ry = bottom + 6;
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.lineTo(rx + 18, ry);
    ctx.lineTo(rx + 18, ry + 58);
    ctx.lineTo(rx + 9, ry + 58 * 0.78);
    ctx.lineTo(rx, ry + 58);
    ctx.closePath();
    ctx.fill();
  }
}

const HEIGHTS = [320, 272, 336, 304, 260];

/** The month's books, not its days: each spine as thick as the minutes spent in it, the last one leaning on its
 * neighbour, all on a board as wide as the type, so the shelf belongs to the page rather than to an icon. */
function shelf(p: Page, books: StickerData['books'], gap: number) {
  const { ctx } = p;
  const tallest = Math.max(...books.map((_, i) => HEIGHTS[i % HEIGHTS.length]));
  const bottom = p.y + gap + tallest;
  const mins = books.map((b) => b.minutes);
  const lo = Math.min(...mins);
  const hi = Math.max(...mins);
  const widths = books.length === 1 ? [112] : mins.map((m) => 72 + 56 * (hi === lo ? 1 : (m - lo) / (hi - lo)));
  const space = 8;
  let x = PAD_X + 4;
  books.forEach((b, i) => {
    const w = widths[i];
    const h = HEIGHTS[i % HEIGHTS.length];
    const last = i === books.length - 1;
    if (books.length === 1) {
      // One book leans on a bookend, so even one reads as a shelf.
      const th = (11 * Math.PI) / 180;
      const endH = Math.round(h * Math.cos(th) * 0.72);
      const d = Math.round(endH * Math.tan(th)) + 2;
      ctx.save();
      ctx.translate(x + w, bottom);
      ctx.rotate(th);
      spine(p, -w, 0, w, h, b.now);
      ctx.restore();
      ctx.fillStyle = p.ink;
      roundRect(ctx, x + w + d, bottom - endH, 22, endH, [3, 3, 0, 0]);
      ctx.fill();
    } else if (last) {
      const th = (16 * Math.PI) / 180;
      const contact = Math.min(HEIGHTS[(i - 1) % HEIGHTS.length], h * Math.cos(th)) * 0.9;
      const lean = contact * Math.tan(th);
      ctx.save();
      ctx.translate(x - space + lean, bottom);
      ctx.rotate(-th);
      spine(p, 0, 0, w, h, b.now, 20);
      ctx.restore();
    } else {
      spine(p, x, bottom, w, h, b.now);
    }
    x += w + space;
  });
  ctx.fillStyle = p.ink;
  roundRect(ctx, PAD_X, bottom, MEASURE, 16, [2, 2, 4, 4]);
  ctx.fill();
  // The ribbons hang over the board: drawn again on top of it.
  let rx = PAD_X + 4;
  books.forEach((b, i) => {
    const w = widths[i];
    if (b.now && books.length > 1 && i < books.length - 1) {
      ctx.fillStyle = ORANGE;
      const left = rx + w / 2 - 9;
      ctx.beginPath();
      ctx.moveTo(left, bottom + 6);
      ctx.lineTo(left + 18, bottom + 6);
      ctx.lineTo(left + 18, bottom + 64);
      ctx.lineTo(left + 9, bottom + 6 + 58 * 0.78);
      ctx.lineTo(left, bottom + 64);
      ctx.closePath();
      ctx.fill();
    }
    rx += w + space;
  });
  p.y = bottom + 16;
}

/** The drawing over two soft shadows of itself, a tight one and a wide one, so it reads on any photo. Only the
 * shadows are cast twice: the faint squares of the calendar stay as faint as they were drawn. */
function halo(src: HTMLCanvasElement, ink: Ink): HTMLCanvasElement {
  const { c, ctx } = surface(src.width, src.height);
  const { tight, wide } = COLORS[ink];
  const away = src.width + 200;
  for (const [color, blur, dy] of [[wide, 56, 0], [tight, 8, 2]] as const) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = away;
    ctx.shadowOffsetY = dy;
    ctx.drawImage(src, -away, 0);
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.drawImage(src, 0, 0);
  release(src);
  return c;
}

function page(ink: Ink): { c: HTMLCanvasElement; p: Page } {
  const { c, ctx } = surface(W, 2600);
  ctx.textBaseline = 'alphabetic';
  return { c, p: { ctx, ink: COLORS[ink].ink, paper: COLORS[ink].paper, y: PAD_TOP } };
}

function finish(c: HTMLCanvasElement, p: Page, ink: Ink): HTMLCanvasElement {
  const { c: out, ctx } = surface(W, Math.ceil(p.y + PAD_BOTTOM));
  ctx.drawImage(c, 0, 0);
  release(c);
  return halo(out, ink);
}

/** «Число»: 34 / минуты сегодня / «Три товарища» / 11 дней в октябре / the mark. */
export function drawNumber(data: StickerData, ink: Ink, mark: CanvasImageSource | null): HTMLCanvasElement {
  const { c, p } = page(ink);
  hero(p, data.minutes, 560);
  line(p, data.words.unit, 28, 88, 700, 1.02);
  let gap = 60;
  if (data.words.quoted) {
    title(p, data.words.quoted, gap);
    gap = 22;
  }
  line(p, data.words.finished ?? data.words.run, gap, 80, 600, 1.1);
  imprint(p, mark);
  return finish(c, p, ink);
}

/** «Месяц»: 34 / минуты сегодня / «Три товарища» / the month as a calendar / the mark. */
export function drawMonth(data: StickerData, ink: Ink, mark: CanvasImageSource | null): HTMLCanvasElement {
  const { c, p } = page(ink);
  hero(p, data.minutes, 440);
  line(p, data.words.unit, 28, 88, 700, 1.02);
  if (data.words.quoted) title(p, data.words.quoted, 44);
  calendar(p, data, 56);
  imprint(p, mark);
  return finish(c, p, ink);
}

/** «Полка»: 34 / минуты сегодня / the month's books / «Три товарища» / the mark. */
export function drawShelf(data: StickerData, ink: Ink, mark: CanvasImageSource | null): HTMLCanvasElement {
  const { c, p } = page(ink);
  hero(p, data.minutes, 560);
  line(p, data.words.unit, 28, 88, 700, 1.02);
  if (data.books.length) shelf(p, data.books, 84);
  if (data.words.quoted) title(p, data.words.quoted, 84);
  imprint(p, mark);
  return finish(c, p, ink);
}
