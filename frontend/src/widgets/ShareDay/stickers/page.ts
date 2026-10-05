import { INKS, SANS, SERIF, ascent, fit, font, spaced, surface, withHalo, wrap, type Ctx, type Ink } from './canvas';
import { calendarWidth, drawCalendar, type CalendarSize } from './calendar';
import { imprint, crop } from './parts';
import type { StickerData } from './types';

const W = 1080;
const CX = W / 2;

/**
 * «Страница»: the day set like a book's title page. The minutes are the
 * title, the book is the subtitle, and PowerBook sits at the foot where a
 * publisher's imprint would.
 */
export function drawPage(data: StickerData, ink: Ink, mark: HTMLCanvasElement | null): HTMLCanvasElement {
  const { words } = data;
  const colors = INKS[ink];
  const { c, ctx } = surface(W, 2000);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let y = 76;

  // The series line over the title.
  ctx.font = font(46, 500, SANS);
  ctx.fillStyle = colors.soft;
  y += ascent(ctx, words.dayOf);
  spaced(ctx, words.dayOf, CX, y, 2);

  y = title(ctx, data, ink, y + 36, 440);

  if (words.streak) {
    y += 64;
    ctx.fillStyle = colors.soft;
    ctx.fillRect(CX - 70, y, 140, 3);
    ctx.font = font(46, 600, SANS);
    ctx.fillStyle = colors.fg;
    y += 52 + ascent(ctx, words.streak);
    ctx.fillText(words.streak, CX, y);
  }

  y += 72;
  y = imprint(ctx, CX, y, colors.soft, mark, 'center');
  return withHalo(crop(c, y + 72), ink);
}

const CALENDAR: CalendarSize = { cell: 96, gap: 14, head: 58, numbers: 34 };

/**
 * «Календарь»: the title page's minutes and book, and under them the month
 * as a calendar with the days read filled orange.
 */
export function drawCalendarPage(data: StickerData, ink: Ink, mark: HTMLCanvasElement | null): HTMLCanvasElement {
  const { words } = data;
  const colors = INKS[ink];
  const { c, ctx } = surface(W, 2400);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let y = title(ctx, data, ink, 76, 400);

  // The month over the calendar, and the run of days at its right edge.
  const width = calendarWidth(CALENDAR);
  const left = CX - width / 2;
  ctx.font = font(58, 400, SERIF, true);
  y += 84 + ascent(ctx, words.month);
  ctx.textAlign = 'left';
  ctx.fillStyle = colors.fg;
  ctx.fillText(words.month, left, y);
  if (words.streak) {
    ctx.textAlign = 'right';
    ctx.font = font(fit(ctx, words.streak, width * 0.55, 42, 30, (s) => font(s, 600, SANS)), 600, SANS);
    ctx.fillStyle = colors.soft;
    ctx.fillText(words.streak, left + width, y);
  }
  y = drawCalendar(ctx, data, ink, left, y + 34, CALENDAR);

  y += 76;
  y = imprint(ctx, CX, y, colors.soft, mark, 'center');
  return withHalo(crop(c, y + 72), ink);
}

/**
 * The minutes as large as the page allows, the unit under them in italic, and
 * the book (two lines at most). `top` is where the numerals' tops go; returns
 * the y under the last line.
 */
function title(ctx: Ctx, data: StickerData, ink: Ink, top: number, maxSize: number): number {
  const { words } = data;
  const colors = INKS[ink];
  ctx.textAlign = 'center';
  const digits = String(data.minutes);
  const size = fit(ctx, digits, 900, maxSize, 220, (s) => font(s, 380, SERIF));
  ctx.font = font(size, 380, SERIF);
  ctx.fillStyle = colors.fg;
  let y = top + ascent(ctx, digits);
  ctx.fillText(digits, CX, y);

  const unitSize = fit(ctx, words.unit, 900, 84, 52, (s) => font(s, 400, SERIF, true));
  ctx.font = font(unitSize, 400, SERIF, true);
  y += 26 + ascent(ctx, words.unit);
  ctx.fillText(words.unit, CX, y);

  if (words.quoted) {
    ctx.font = font(58, 600, SERIF);
    const lines = wrap(ctx, words.quoted, 900, 2);
    y += 34;
    for (const line of lines) {
      y += 70;
      ctx.fillText(line, CX, y);
    }
  }
  return y;
}
