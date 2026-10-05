import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Barys, type BarysMood, type BarysStage } from '@/widgets/Mascot';
import { INKS, ORANGE, SANS, SERIF, ascent, fit, font, loadImage, roundRect, surface, withHalo, type Ink } from './canvas';
import { crop, imprint } from './parts';
import type { StickerData } from './types';

const W = 1080;
const GOAL = 30;

/** Барыс as a picture: the same drawing as on the round page, standing still. */
export async function barysPicture(mood: BarysMood, stage: BarysStage): Promise<HTMLImageElement | null> {
  const host = document.createElement('div');
  const root = createRoot(host);
  flushSync(() => root.render(<Barys mood={mood} stage={stage} size={640} />));
  const svg = host.querySelector('svg');
  const markup = svg ? new XMLSerializer().serializeToString(svg) : null;
  root.unmount();
  if (!markup) return null;
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  const img = await loadImage(url);
  URL.revokeObjectURL(url);
  return img;
}

/** The mood the sticker shows: celebrating 30 minutes, or still reading. */
export function stickerMood(minutes: number): BarysMood {
  return minutes >= GOAL ? 'celebrate' : 'reading';
}

/**
 * «Барыс»: the cub the reader feeds with minutes, holding up the day on an
 * orange plate, like Duolingo's owl holds up a streak.
 */
export function drawBarys(data: StickerData, ink: Ink, mark: HTMLCanvasElement | null, picture: HTMLImageElement | null): HTMLCanvasElement {
  const { words } = data;
  const colors = INKS[ink];
  const { c, ctx } = surface(W, 1500);
  const cx = W / 2;
  let y = 40;

  if (picture) {
    const pw = 640;
    const ph = (picture.height / picture.width) * pw;
    ctx.drawImage(picture, cx - pw / 2, y, pw, ph);
    y += ph - 34;
  }

  // The plate: the minutes large, the run of days under them.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const bigSize = fit(ctx, words.plate.big, 760, 104, 60, (s) => font(s, 600, SERIF));
  ctx.font = font(bigSize, 600, SERIF);
  const bigW = ctx.measureText(words.plate.big).width;
  const bigA = ascent(ctx, words.plate.big);
  let smallW = 0;
  if (words.plate.small) {
    ctx.font = font(42, 600, SANS);
    smallW = ctx.measureText(words.plate.small).width;
  }
  const plateW = Math.max(bigW, smallW) + 120;
  const plateH = 56 + bigA + (words.plate.small ? 30 + 32 : 0) + 50;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = ORANGE;
  roundRect(ctx, cx - plateW / 2, y, plateW, plateH, 36);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(bigSize, 600, SERIF);
  let line = y + 56 + bigA;
  ctx.fillText(words.plate.big, cx, line);
  if (words.plate.small) {
    ctx.font = font(42, 600, SANS);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    line += 30 + 32;
    ctx.fillText(words.plate.small, cx, line);
  }
  y += plateH + 44;

  y = imprint(ctx, cx, y, colors.fg, mark, 'center', 48);
  return withHalo(crop(c, y + 60), ink, 26);
}
