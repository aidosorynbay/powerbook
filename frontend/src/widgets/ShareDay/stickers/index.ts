import type { BarysMood, BarysStage } from '@/widgets/Mascot';
import { INKS, SANS, font, loadImage, release, surface, trimmed, type Ink } from './canvas';
import { barysPicture, drawBarys, stickerMood } from './barys';
import { drawPage } from './page';
import { drawShelf } from './shelf';
import { drawSlip } from './slip';
import type { StickerData, StickerKind } from './types';

export { STICKERS, type StickerData, type StickerKind, type StickerWords } from './types';
export { loadStickerFonts } from './fonts';
export { loadImage } from './canvas';
export { stickerData } from './words';
export type { Ink } from './canvas';

/** What the drawings need from the network: the mark, Барыс, the room behind the story. */
export type StickerAssets = {
  mark: HTMLCanvasElement | null;
  barys: Partial<Record<BarysMood, HTMLImageElement | null>>;
};

const LOGO = '/logo-icon.png';
/** The reading room at night behind white stickers, by day behind black ones. */
const ROOM: Record<Ink, string> = { light: '/reading-room/m-night-m.jpg', dark: '/reading-room/m-day-m.jpg' };

export async function loadStickerAssets(minutes: number, stage: BarysStage): Promise<StickerAssets> {
  const mood = stickerMood(minutes);
  const [logo, picture] = await Promise.all([loadImage(LOGO), barysPicture(mood, stage).catch(() => null)]);
  return { mark: logo ? trimmed(logo) : null, barys: { [mood]: picture } };
}

/** The sticker alone, on nothing: Instagram lays it over the reader's own photo. */
export function drawSticker(kind: StickerKind, data: StickerData, ink: Ink, assets: StickerAssets): HTMLCanvasElement {
  switch (kind) {
    case 'page':
      return drawPage(data, ink, assets.mark);
    case 'shelf':
      return drawShelf(data, ink, assets.mark);
    case 'slip':
      return drawSlip(data, assets.mark);
    case 'barys':
      return drawBarys(data, ink, assets.mark, assets.barys[stickerMood(data.minutes)] ?? null);
  }
}

/** The ink a sticker is really drawn in: the library slip is paper, the same whatever is chosen. */
export function inkOf(kind: StickerKind, ink: Ink): Ink {
  return kind === 'slip' ? 'light' : ink;
}

/** How wide a sticker sits on a story, as a share of the screen, so all four look the same size. */
export const STORY_WIDTH: Record<StickerKind, number> = { page: 0.74, shelf: 0.9, slip: 0.78, barys: 0.7 };

export function roomFor(ink: Ink): string {
  return ROOM[ink];
}

/** A whole story, 1080×1920, for whoever has no photo of their own: the sticker over the reading room. */
export async function drawStory(kind: StickerKind, sticker: CanvasImageSource & { width: number; height: number }, ink: Ink, link: string): Promise<HTMLCanvasElement> {
  const { c, ctx } = surface(1080, 1920);
  const room = await loadImage(ROOM[ink]);
  ctx.fillStyle = ink === 'light' ? '#120c07' : '#efe6d6';
  ctx.fillRect(0, 0, c.width, c.height);
  if (room) {
    const k = Math.max(c.width / room.naturalWidth, c.height / room.naturalHeight);
    const w = room.naturalWidth * k;
    const h = room.naturalHeight * k;
    ctx.drawImage(room, (c.width - w) / 2, (c.height - h) / 2, w, h);
  }
  // A veil over the room, so the sticker is the first thing seen.
  const veil = ctx.createLinearGradient(0, 0, 0, c.height);
  const tone = ink === 'light' ? { rgb: '12, 8, 4', a: [0.18, 0.42, 0.62] } : { rgb: '252, 247, 238', a: [0.1, 0.3, 0.45] };
  tone.a.forEach((alpha, i) => veil.addColorStop(i / 2, `rgba(${tone.rgb}, ${alpha})`));
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, c.width, c.height);

  let w = c.width * STORY_WIDTH[kind];
  let h = (sticker.height / sticker.width) * w;
  if (h > 1460) {
    h = 1460;
    w = (sticker.width / sticker.height) * h;
  }
  ctx.drawImage(sticker, (c.width - w) / 2, Math.max(150, (c.height - h) / 2 - 20), w, h);

  ctx.font = font(36, 600, SANS);
  ctx.textAlign = 'center';
  ctx.fillStyle = INKS[ink].soft;
  ctx.shadowColor = INKS[ink].halo;
  ctx.shadowBlur = 16;
  ctx.fillText(link, c.width / 2, c.height - 120);
  return c;
}

/** The canvas as a file, and the canvas let go: what stays in memory is the file. */
export function toBlob(c: HTMLCanvasElement, type: 'image/png' | 'image/jpeg'): Promise<Blob | null> {
  return new Promise((resolve) =>
    c.toBlob(
      (blob) => {
        release(c);
        resolve(blob);
      },
      type,
      type === 'image/jpeg' ? 0.9 : undefined
    )
  );
}
