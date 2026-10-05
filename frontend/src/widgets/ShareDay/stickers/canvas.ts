/** What every sticker draws with: two inks, the bookcase's type, text that fits,
 * a soft shadow, and the worn edge of a rubber stamp. */

export const SERIF = '"Literata", "Iowan Old Style", Georgia, serif';
export const SANS = '"Inter", "Helvetica Neue", Arial, sans-serif';

/** White for most photos; black for a bright one (a white page, snow, a sunny table). */
export type Ink = 'light' | 'dark';

export const INKS: Record<Ink, { fg: string; soft: string; faint: string; halo: string }> = {
  light: { fg: '#FFFFFF', soft: 'rgba(255, 255, 255, 0.88)', faint: 'rgba(255, 255, 255, 0.4)', halo: 'rgba(14, 9, 4, 0.5)' },
  dark: { fg: '#1B1612', soft: 'rgba(27, 22, 18, 0.86)', faint: 'rgba(27, 22, 18, 0.4)', halo: 'rgba(255, 250, 242, 0.55)' },
};

/** PowerBook orange: today, and only today. */
export const ORANGE = '#F26430';

export type Ctx = CanvasRenderingContext2D;

export function surface(width: number, height: number): { c: HTMLCanvasElement; ctx: Ctx } {
  const c = document.createElement('canvas');
  c.width = Math.ceil(width);
  c.height = Math.ceil(height);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  return { c, ctx };
}

/** Give a canvas's memory back now: Safari on iPhone runs out of canvas memory long before the page does. */
export function release(c: HTMLCanvasElement) {
  c.width = 0;
  c.height = 0;
}

export function font(size: number, weight: number, family: string, italic = false): string {
  return `${italic ? 'italic ' : ''}${weight} ${Math.round(size)}px ${family}`;
}

/** The largest size from `size` down to `min` at which the text fits `width`. */
export function fit(ctx: Ctx, text: string, width: number, size: number, min: number, make: (size: number) => string): number {
  let s = size;
  ctx.font = make(s);
  while (s > min && ctx.measureText(text).width > width) {
    s -= 2;
    ctx.font = make(s);
  }
  return s;
}

/** Word-wrapped lines, at most `max`; the last one ends in an ellipsis when the text runs on. */
export function wrap(ctx: Ctx, text: string, width: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines.map((l) => clip(ctx, l, width));
  const kept = lines.slice(0, max);
  kept[max - 1] = clip(ctx, `${kept[max - 1]}…`, width, true);
  return kept;
}

/** One line cut to the width, with an ellipsis if anything was cut. */
function clip(ctx: Ctx, text: string, width: number, ellipsis = false): string {
  if (ctx.measureText(text).width <= width) return text;
  let t = ellipsis ? text.replace(/…$/, '') : text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Text with extra space between letters, centred on x (the canvas's own letterSpacing is not everywhere yet). */
export function spaced(ctx: Ctx, text: string, x: number, y: number, gap: number, align: 'left' | 'center' | 'right' = 'center') {
  const chars = [...text];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);
  let at = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  chars.forEach((ch, i) => {
    ctx.fillText(ch, at, y);
    at += widths[i] + gap;
  });
  ctx.textAlign = prev;
  return total;
}

export function spacedWidth(ctx: Ctx, text: string, gap: number): number {
  const chars = [...text];
  return chars.reduce((a, ch) => a + ctx.measureText(ch).width, 0) + gap * (chars.length - 1);
}

/** Height of the drawn glyphs above the baseline, for laying text out by its ink, not its box. */
export function ascent(ctx: Ctx, text: string): number {
  const m = ctx.measureText(text);
  return m.actualBoundingBoxAscent || parseFloat(ctx.font.match(/(\d+)px/)?.[1] ?? '16') * 0.72;
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | [number, number, number, number]) {
  const [tl, tr, br, bl] = typeof r === 'number' ? [r, r, r, r] : r;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

/** The same day always gets the same small irregularities. */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The sticker as it goes out: the drawing over a soft shadow of itself, so
 * white type still reads on a bright photo (a light halo under black type).
 */
export function withHalo(src: HTMLCanvasElement, ink: Ink, blur = 34): HTMLCanvasElement {
  const { c, ctx } = surface(src.width, src.height);
  ctx.shadowColor = INKS[ink].halo;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = ink === 'light' ? 3 : 0;
  ctx.drawImage(src, 0, 0);
  release(src);
  return c;
}

/** Wear on a rubber stamp: specks of paper showing through the ink. */
export function wear(c: HTMLCanvasElement, seed: string, amount = 1) {
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const rnd = seeded(`wear:${seed}`);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const specks = Math.round((c.width * c.height) / 900 * amount);
  for (let i = 0; i < specks; i++) {
    ctx.globalAlpha = 0.25 + rnd() * 0.75;
    const r = 0.6 + rnd() * rnd() * 3.2;
    ctx.beginPath();
    ctx.arc(rnd() * c.width, rnd() * c.height, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // A few dry streaks where the stamp met the paper unevenly.
  for (let i = 0; i < 6 * amount; i++) {
    ctx.globalAlpha = 0.18 + rnd() * 0.25;
    ctx.lineWidth = 2 + rnd() * 6;
    ctx.beginPath();
    const y = rnd() * c.height;
    ctx.moveTo(rnd() * c.width * 0.4, y);
    ctx.lineTo(c.width * (0.6 + rnd() * 0.4), y + (rnd() - 0.5) * 24);
    ctx.stroke();
  }
  ctx.restore();
}

export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** An image in one colour, by its shape alone: the PowerBook mark in the sticker's ink. */
export function tinted(img: CanvasImageSource & { width: number; height: number }, color: string, height: number): HTMLCanvasElement {
  const width = (img.width / img.height) * height;
  const { c, ctx } = surface(width, height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/** The part of an image that has anything in it (the logo file has wide empty margins). */
export function trimmed(img: HTMLImageElement): HTMLCanvasElement {
  const { c, ctx } = surface(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width;
  let y0 = height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return c;
  const out = surface(x1 - x0 + 1, y1 - y0 + 1);
  out.ctx.drawImage(c, x0, y0, out.c.width, out.c.height, 0, 0, out.c.width, out.c.height);
  release(c);
  return out.c;
}
