import { INKS, ORANGE, SANS, SERIF, ascent, fit, font, roundRect, seeded, surface, withHalo, type Ctx, type Ink } from './canvas';
import { calendarHeight, calendarWidth, drawCalendar, type CalendarSize } from './calendar';
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
  const colors = INKS[ink];
  const { c, ctx } = surface(W, 1100);
  const y = stats(ctx, data, colors);

  const area = { x: M, width: W - 2 * M, height: 400 };
  const shelf = layout(data, area);
  // The shelf sits under its tallest book.
  const shelfTop = y + 64 + Math.max(...shelf.map((b) => b.h), 160);
  books(ctx, shelf, colors, shelfTop, area);
  return finish(c, ctx, data, ink, mark, shelfTop);
}

const SMALL_CALENDAR: CalendarSize = { cell: 54, gap: 8, head: 42, numbers: 22 };

/**
 * «Полка с календарём»: the shelf's figures across the top, and under them
 * half a shelf with the month's calendar beside it, the shelf's plank level
 * with the calendar's last row.
 */
export function drawShelfCalendar(data: StickerData, ink: Ink, mark: HTMLCanvasElement | null): HTMLCanvasElement {
  const colors = INKS[ink];
  const { c, ctx } = surface(W, 1200);
  const y = stats(ctx, data, colors);

  const calWidth = calendarWidth(SMALL_CALENDAR);
  const calTop = y + 76;
  const shelfTop = drawCalendar(ctx, data, ink, W - M - calWidth, calTop, SMALL_CALENDAR);
  const area = { x: M + 4, width: W - 2 * M - calWidth - 76, height: calendarHeight(data, SMALL_CALENDAR) - 12 };
  books(ctx, layout(data, area), colors, shelfTop, area);
  return finish(c, ctx, data, ink, mark, shelfTop);
}

/** Three figures across the top, label over value, as Strava sets distance, pace and time. Returns their baseline. */
function stats(ctx: Ctx, data: StickerData, colors: (typeof INKS)[Ink]): number {
  const { words } = data;
  ctx.textBaseline = 'alphabetic';
  const col = (W - 2 * M) / words.stats.length;
  ctx.font = font(40, 500, SANS);
  const labelTop = 70 + ascent(ctx, 'Ая');
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
  return valueBase;
}

/** The month's name under the shelf and PowerBook at the right, then the sticker as it goes out. */
function finish(c: HTMLCanvasElement, ctx: Ctx, data: StickerData, ink: Ink, mark: HTMLCanvasElement | null, shelfTop: number): HTMLCanvasElement {
  const colors = INKS[ink];
  ctx.textAlign = 'left';
  ctx.font = font(54, 400, SERIF, true);
  ctx.fillStyle = colors.fg;
  const foot = shelfTop + 150;
  ctx.fillText(data.words.month, M, foot);
  imprint(ctx, W - M, foot - 42, colors.soft, mark, 'right', 46);
  return withHalo(crop(c, foot + 70), ink);
}

type Area = { x: number; width: number; height: number };
type Book = { x: number; w: number; h: number; tall: boolean; today: boolean };

/** Where each day's book stands and how tall, inside the area: the same day always looks the same. */
function layout(data: StickerData, area: Area): Book[] {
  const sofar = data.days.filter((d) => d.date <= data.day);
  // At least nine places, so the first days of a month are books, not slivers.
  const slot = area.width / Math.max(sofar.length, 9);
  const rnd = seeded(`shelf:${data.days[0]?.date ?? ''}`);
  const out: Book[] = [];
  sofar.forEach((d, i) => {
    const jitterW = 0.9 + rnd() * 0.2;
    const jitterH = 0.89 + rnd() * 0.11;
    if (d.minutes < 2) return; // a missed day: a gap on the shelf
    const bw = Math.min(96, Math.max(8, slot * 0.76 * jitterW));
    const left = area.x + i * slot + (slot - bw) / 2;
    const tall = d.minutes >= GOAL;
    const share = tall ? 0.62 + (Math.min(d.minutes - GOAL, 60) / 60) * 0.38 : 0.3 + (d.minutes / GOAL) * 0.24;
    const h = area.height * share * jitterH;
    const w = tall ? bw : bw * 0.7;
    out.push({ x: tall ? left : left + (bw - w) / 2, w, h, tall, today: d.date === data.day });
  });
  return out;
}

function books(ctx: Ctx, shelf: Book[], colors: (typeof INKS)[Ink], shelfTop: number, area: Area) {
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
  roundRect(ctx, area.x - 22, shelfTop, area.width + 44, 20, 4);
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
