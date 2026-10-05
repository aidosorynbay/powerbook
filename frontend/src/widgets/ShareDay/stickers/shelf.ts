import { INKS, ORANGE, SANS, SERIF, ascent, fit, font, roundRect, seeded, surface, withHalo, type Ctx, type Ink } from './canvas';
import { crop, imprint } from './parts';
import type { StickerData } from './types';

const W = 1080;
const M = 60;
const GOAL = 30;

/**
 * «Полка»: the month as books on a shelf, one a day, the way Strava draws the
 * route. A day of 30 minutes stands tall, a shorter day is a thin book, a
 * missed day is a gap. Today's book is orange, with a ribbon hanging over
 * the shelf's edge. Early in the month the books are fewer and wider, and the
 * rest of the shelf waits empty.
 */
export function drawShelf(data: StickerData, ink: Ink, mark: HTMLCanvasElement | null): HTMLCanvasElement {
  const { words } = data;
  const colors = INKS[ink];
  const { c, ctx } = surface(W, 1100);
  ctx.textBaseline = 'alphabetic';

  // Three figures across the top, label over value.
  const col = (W - 2 * M) / words.stats.length;
  let y = 70;
  ctx.font = font(40, 500, SANS);
  const labelTop = y + ascent(ctx, 'Ая');
  let valueBase = 0;
  words.stats.forEach((s, i) => {
    const x = M + i * col;
    ctx.textAlign = 'left';
    ctx.font = font(40, 500, SANS);
    ctx.fillStyle = colors.soft;
    ctx.fillText(s.label, x, labelTop, col - 16);
    const size = fit(ctx, s.value, col * 0.6, 124, 70, (z) => font(z, 500, SERIF));
    ctx.font = font(size, 500, SERIF);
    ctx.fillStyle = colors.fg;
    const base = labelTop + 26 + ascent(ctx, '0123456789');
    valueBase = Math.max(valueBase, base);
    ctx.fillText(s.value, x, base);
    const vw = ctx.measureText(s.value).width;
    ctx.font = font(42, 600, SANS);
    ctx.fillText(s.unit, x + vw + 12, base, col - vw - 28);
  });
  y = valueBase;

  // The shelf, under the tallest book.
  const shelf = layout(data);
  const shelfTop = y + 64 + Math.max(...shelf.map((b) => b.h), 160);
  books(ctx, shelf, colors, shelfTop);

  ctx.textAlign = 'left';
  ctx.font = font(54, 400, SERIF, true);
  ctx.fillStyle = colors.fg;
  const foot = shelfTop + 150;
  ctx.fillText(words.month, M, foot);
  imprint(ctx, W - M, foot - 42, colors.soft, mark, 'right', 46);
  return withHalo(crop(c, foot + 70), ink);
}

type Book = { x: number; w: number; h: number; tall: boolean; today: boolean };

/** Where each day's book stands and how tall: the same day always looks the same. */
function layout(data: StickerData): Book[] {
  const sofar = data.days.filter((d) => d.date <= data.day);
  // At least nine places, so the first days of a month are books, not slivers.
  const slot = (W - 2 * M) / Math.max(sofar.length, 9);
  const rnd = seeded(`shelf:${data.days[0]?.date ?? ''}`);
  const out: Book[] = [];
  sofar.forEach((d, i) => {
    const jitterW = 0.9 + rnd() * 0.2;
    const jitterH = 0.94 + rnd() * 0.12;
    if (d.minutes < 2) return; // a missed day: a gap on the shelf
    const bw = Math.min(96, Math.max(10, slot * 0.76 * jitterW));
    const left = M + i * slot + (slot - bw) / 2;
    const tall = d.minutes >= GOAL;
    const h = (tall ? 250 + (Math.min(d.minutes - GOAL, 60) / 60) * 130 : 120 + (d.minutes / GOAL) * 90) * jitterH;
    const w = tall ? bw : bw * 0.7;
    out.push({ x: tall ? left : left + (bw - w) / 2, w, h, tall, today: d.date === data.day });
  });
  return out;
}

function books(ctx: Ctx, shelf: Book[], colors: (typeof INKS)[Ink], shelfTop: number) {
  let marked = null as number | null;
  for (const b of shelf) {
    ctx.fillStyle = b.today ? ORANGE : b.tall ? colors.fg : colors.soft;
    const r = Math.min(6, b.w / 5);
    roundRect(ctx, b.x, shelfTop - b.h, b.w, b.h, [r, r, 0, 0]);
    ctx.fill();
    // Bands across the spine, cut through, so the bars read as books.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const band = Math.max(2.5, b.w * 0.05);
    ctx.fillRect(b.x, shelfTop - b.h * 0.89, b.w, band);
    ctx.fillRect(b.x, shelfTop - b.h * 0.84, b.w, band);
    ctx.fillRect(b.x, shelfTop - b.h * 0.13, b.w, band);
    ctx.restore();
    if (b.today) marked = b.x + b.w * 0.62;
  }

  // The plank, a little wider than the books.
  ctx.fillStyle = colors.fg;
  roundRect(ctx, M - 22, shelfTop, W - 2 * M + 44, 20, 4);
  ctx.fill();
  if (marked !== null) ribbon(ctx, marked, shelfTop);
}

/** A bookmark ribbon from today's book, down over the edge of the shelf. */
function ribbon(ctx: Ctx, x: number, shelfTop: number) {
  const w = 18;
  const top = shelfTop - 14;
  const bottom = shelfTop + 84;
  ctx.fillStyle = ORANGE;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, top);
  ctx.lineTo(x + w / 2, top);
  ctx.lineTo(x + w / 2, bottom);
  ctx.lineTo(x, bottom - 12);
  ctx.lineTo(x - w / 2, bottom);
  ctx.closePath();
  ctx.fill();
}
