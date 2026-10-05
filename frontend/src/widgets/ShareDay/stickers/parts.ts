import { ORANGE, SANS, font, release, surface, tinted, type Ctx } from './canvas';

const MARK_H = 50;

/**
 * The PowerBook mark in orange and the name beside it, the way runners'
 * stickers carry Strava's: whoever sees the story knows where it came from.
 * Returns the y just under it.
 */
export function imprint(ctx: Ctx, x: number, top: number, color: string, mark: HTMLCanvasElement | null, align: 'left' | 'center' | 'right', height = MARK_H): number {
  const prevAlign = ctx.textAlign;
  ctx.font = font(height * 0.8, 600, SANS);
  const name = 'PowerBook';
  const textW = ctx.measureText(name).width;
  const logo = mark ? tinted(mark, ORANGE, height) : null;
  const gap = logo ? height * 0.3 : 0;
  const total = (logo?.width ?? 0) + gap + textW;
  const left = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  if (logo) ctx.drawImage(logo, left, top);
  const logoW = logo?.width ?? 0;
  if (logo) release(logo);
  ctx.textAlign = 'left';
  ctx.fillStyle = color;
  // The name sits on the mark's foot line.
  ctx.fillText(name, left + logoW + gap, top + height * 0.8);
  ctx.textAlign = prevAlign;
  return top + height;
}

/** The top `height` pixels of a canvas drawn taller than it needed; the tall one is let go. */
export function crop(c: HTMLCanvasElement, height: number): HTMLCanvasElement {
  const out = surface(c.width, Math.min(c.height, height));
  out.ctx.drawImage(c, 0, 0);
  release(c);
  return out.c;
}
