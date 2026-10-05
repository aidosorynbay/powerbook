import { INKS, SANS, SERIF, ascent, fit, font, spaced, surface, withHalo, wrap, type Ink } from './canvas';
import { imprint, crop } from './parts';
import type { StickerData } from './types';

const W = 1080;

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
  const cx = W / 2;
  let y = 76;

  // The series line over the title.
  ctx.font = font(46, 500, SANS);
  ctx.fillStyle = colors.soft;
  y += ascent(ctx, words.dayOf);
  spaced(ctx, words.dayOf, cx, y, 2);

  // The minutes, as large as the page allows.
  const digits = String(data.minutes);
  const size = fit(ctx, digits, 900, 440, 220, (s) => font(s, 380, SERIF));
  ctx.font = font(size, 380, SERIF);
  ctx.fillStyle = colors.fg;
  y += 36 + ascent(ctx, digits);
  ctx.fillText(digits, cx, y);

  const unitSize = fit(ctx, words.unit, 900, 84, 52, (s) => font(s, 400, SERIF, true));
  ctx.font = font(unitSize, 400, SERIF, true);
  y += 26 + ascent(ctx, words.unit);
  ctx.fillText(words.unit, cx, y);

  if (words.quoted) {
    ctx.font = font(58, 600, SERIF);
    const lines = wrap(ctx, words.quoted, 900, 2);
    y += 34;
    for (const line of lines) {
      y += 70;
      ctx.fillText(line, cx, y);
    }
  }

  if (words.streak) {
    y += 64;
    ctx.fillStyle = colors.soft;
    ctx.fillRect(cx - 70, y, 140, 3);
    ctx.font = font(46, 600, SANS);
    ctx.fillStyle = colors.fg;
    y += 52 + ascent(ctx, words.streak);
    ctx.fillText(words.streak, cx, y);
  }

  y += 72;
  y = imprint(ctx, cx, y, colors.soft, mark, 'center');
  return withHalo(crop(c, y + 72), ink);
}
