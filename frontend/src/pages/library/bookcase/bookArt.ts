/**
 * Everything painted onto a book: spine, covers, and the shelf's wood.
 *
 * Most volumes on a PowerBook shelf have no cover image — they were finished
 * in a circle and exist as a title somebody typed. Each gets a printed-edition
 * look instead: a palette and a pattern chosen from the title itself, so one
 * book looks the same on every shelf it stands on, and two readers of
 * "Абай жолы" can recognise it on each other's shelves at a glance.
 */

export type Palette = { cover: string; accent: string; ink: string };

export type VolumeArt = {
  key: string;
  /** Title-derived, so the same book gets the same design on every shelf. */
  seed: string;
  title: string;
  author: string | null;
  /** Small caps across the top of the front cover. */
  imprint: string;
  /** Printed at the foot of the spine, like a call number. */
  spineMark: string;
  /** The reader's own words about the book, for the back cover. */
  back: string | null;
  backCaption: string;
  tagline: string;
  /** Full-size cover image, when a real one exists. */
  coverImage: string | null;
  /** A small copy of it, for spine colours and a quick first look. */
  coverThumb: string | null;
};

export const SERIF = '"Literata", "Iowan Old Style", Georgia, serif';
export const SANS = '"Inter", "Helvetica Neue", Arial, sans-serif';

// Cloth and paper colours a publisher might actually print on. The accent is
// the foil or second ink; the ink is what the type is set in.
const PALETTES: Palette[] = [
  { cover: '#6b1f2a', accent: '#e0a95b', ink: '#f5ecdc' }, // oxblood
  { cover: '#1c2a44', accent: '#f26430', ink: '#f2eadb' }, // midnight, PowerBook orange
  { cover: '#2c4a3b', accent: '#e3b766', ink: '#f1e9d6' }, // pine
  { cover: '#b8532e', accent: '#2a211c', ink: '#f6ecdd' }, // terracotta
  { cover: '#ebe0c8', accent: '#1f4e8c', ink: '#9c2f24' }, // parchment
  { cover: '#2346a0', accent: '#f2c14e', ink: '#f4efe4' }, // cobalt
  { cover: '#8a9a7b', accent: '#2f2620', ink: '#f7f1e6' }, // sage
  { cover: '#4a2c4f', accent: '#e8a87c', ink: '#f4ebe1' }, // plum
  { cover: '#d49a2a', accent: '#2a2320', ink: '#2a2320' }, // mustard
  { cover: '#2b2a28', accent: '#d9c9a3', ink: '#efe9dc' }, // charcoal
  { cover: '#e6c4b8', accent: '#7a2e2a', ink: '#3b2522' }, // blush
  { cover: '#1f5f63', accent: '#f0b67f', ink: '#f2ede2' }, // teal
  { cover: '#a9bccd', accent: '#1d2b3a', ink: '#1d2b3a' }, // sky
  { cover: '#f26430', accent: '#1a1714', ink: '#fff4e8' }, // PowerBook
  { cover: '#5a4632', accent: '#e9d8b4', ink: '#f3e9d6' }, // tobacco
  { cover: '#c9b99a', accent: '#6b1f2a', ink: '#2b231c' }, // linen
];

const MOTIFS = 9;

// ---------- deterministic randomness ----------

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededRandom(seed: string): () => number {
  let a = hashString(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function paletteFor(seed: string): Palette {
  return PALETTES[hashString(`${seed}#palette`) % PALETTES.length];
}

function motifFor(seed: string): number {
  return hashString(`${seed}#motif`) % MOTIFS;
}

/** Physical proportions in scene units, varied the way a real shelf varies. */
export function dimensionsFor(seed: string) {
  const rnd = seededRandom(`${seed}#size`);
  const pocket = rnd() < 0.16;
  const height = pocket ? 1.56 + rnd() * 0.14 : 1.8 + rnd() * 0.38;
  const width = height * (0.63 + rnd() * 0.07);
  const thickness = 0.13 + Math.pow(rnd(), 1.5) * 0.27;
  return { width, height, thickness };
}

// ---------- canvas helpers ----------

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return [canvas, canvas.getContext('2d')];
}

let grainCanvas: HTMLCanvasElement | null = null;

/** One shared tile of paper grain, laid over every surface. */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, strength = 1) {
  if (!grainCanvas) {
    const [c, g] = makeCanvas(256, 256);
    if (g) {
      const rnd = seededRandom('grain');
      for (let i = 0; i < 2600; i += 1) {
        const a = 0.02 + rnd() * 0.05;
        g.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
        const s = 0.6 + rnd() * 1.6;
        g.fillRect(rnd() * 256, rnd() * 256, s, s);
      }
    }
    grainCanvas = c;
  }
  const pattern = ctx.createPattern(grainCanvas, 'repeat');
  if (!pattern) return;
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Letter-spaced text without relying on ctx.letterSpacing (older Safari). */
function tracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number, align: 'left' | 'center' = 'left') {
  const chars = Array.from(text);
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((s, w) => s + w, 0) + spacing * Math.max(0, chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : x;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, y);
    cx += widths[i] + spacing;
  });
  ctx.textAlign = prev;
  return total;
}

/** Word-wrap into at most `maxLines`, ending in an ellipsis if cut. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    // A single word wider than the column is broken rather than overflowing.
    while (ctx.measureText(line).width > maxWidth && line.length > 4) {
      let cut = line.length - 1;
      while (cut > 1 && ctx.measureText(`${line.slice(0, cut)}-`).width > maxWidth) cut -= 1;
      lines.push(`${line.slice(0, cut)}-`);
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && ctx.measureText(`${last}…`).width > maxWidth) {
    last = last.split(' ').slice(0, -1).join(' ');
  }
  kept[maxLines - 1] = `${(last || kept[maxLines - 1].slice(0, 8)).replace(/[.,;:!?—-]+$/, '')}…`;
  return kept;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text.length;
  while (cut > 1 && ctx.measureText(`${text.slice(0, cut)}…`).width > maxWidth) cut -= 1;
  return `${text.slice(0, cut).trimEnd()}…`;
}

function line(ctx: CanvasRenderingContext2D, pts: [number, number][], width: number) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  ctx.lineWidth = width;
  ctx.stroke();
}

// ---------- motifs ----------

/** A pattern in the lower part of a cover, in the accent colour. */
function drawMotif(ctx: CanvasRenderingContext2D, seed: string, p: Palette, x: number, y: number, w: number, h: number) {
  const rnd = seededRandom(`${seed}#pattern`);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = p.accent;
  ctx.fillStyle = p.accent;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const u = w / 100;

  switch (motifFor(seed)) {
    case 0: {
      // Circles — the thing PowerBook is made of.
      const cx = x + w * (0.3 + rnd() * 0.4);
      const cy = y + h * (0.45 + rnd() * 0.2);
      for (let i = 0; i < 9; i += 1) {
        ctx.globalAlpha = 0.9 - i * 0.07;
        ctx.beginPath();
        ctx.arc(cx, cy, 6 * u + i * 5.2 * u, 0, Math.PI * 2);
        ctx.lineWidth = i % 3 === 0 ? 1.4 * u : 0.5 * u;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 3 * u, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 1: {
      // A sun on the horizon.
      const horizon = y + h * 0.6;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(x + w * (0.35 + rnd() * 0.3), horizon, 22 * u, Math.PI, 0);
      ctx.fill();
      ctx.globalAlpha = 0.7;
      for (let i = 0; i < 8; i += 1) {
        line(ctx, [[x + 6 * u, horizon + (4 + i * 4.2) * u], [x + w - 6 * u, horizon + (4 + i * 4.2) * u]], (1.3 - i * 0.12) * u);
      }
      break;
    }
    case 2: {
      // A grid of dots, a few of them grown.
      const cols = 7;
      const rows = 7;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const big = rnd() < 0.12;
          ctx.globalAlpha = big ? 1 : 0.55;
          ctx.beginPath();
          ctx.arc(x + (10 + c * 13.3) * u, y + h * 0.12 + r * (h * 0.76) / (rows - 1), (big ? 3.4 : 1.1) * u, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 3: {
      // Diagonal bands.
      ctx.globalAlpha = 0.88;
      const n = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i += 1) {
        const off = (i * 26 - 20) * u;
        ctx.beginPath();
        ctx.moveTo(x + off, y + h);
        ctx.lineTo(x + off + 12 * u, y + h);
        ctx.lineTo(x + off + 12 * u + h, y);
        ctx.lineTo(x + off + h, y);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 4: {
      // Nested arches, like a run of doorways.
      const cx = x + w / 2;
      const base = y + h * 0.95;
      for (let i = 0; i < 7; i += 1) {
        const r = (38 - i * 5) * u;
        ctx.globalAlpha = 0.95 - i * 0.08;
        ctx.beginPath();
        ctx.moveTo(cx - r, base);
        ctx.lineTo(cx - r, base - h * 0.35);
        ctx.arc(cx, base - h * 0.35, r, Math.PI, 0);
        ctx.lineTo(cx + r, base);
        ctx.lineWidth = (i === 0 ? 1.6 : 0.6) * u;
        ctx.stroke();
      }
      break;
    }
    case 5: {
      // Waves.
      const phase = rnd() * Math.PI * 2;
      for (let i = 0; i < 11; i += 1) {
        ctx.globalAlpha = 0.85;
        const pts: [number, number][] = [];
        for (let px = 0; px <= w; px += 2 * u) {
          pts.push([x + px, y + h * 0.1 + i * 7.4 * u + Math.sin(px / (9 * u) + phase + i * 0.55) * (1.2 + i * 0.25) * u]);
        }
        line(ctx, pts, (i % 4 === 0 ? 1.3 : 0.5) * u);
      }
      break;
    }
    case 6: {
      // A mosaic of blocks in two inks.
      const cell = 12 * u;
      for (let cy = y + 4 * u; cy < y + h - cell; cy += cell) {
        for (let cx = x + 6 * u; cx < x + w - cell; cx += cell) {
          const r = rnd();
          if (r < 0.42) continue;
          ctx.globalAlpha = r < 0.75 ? 0.9 : 0.35;
          ctx.fillStyle = r < 0.9 ? p.accent : p.ink;
          if (r > 0.82) {
            ctx.beginPath();
            ctx.arc(cx + cell / 2, cy + cell / 2, cell * 0.42, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillRect(cx + 0.6 * u, cy + 0.6 * u, cell - 1.2 * u, cell - 1.2 * u);
          }
        }
      }
      break;
    }
    case 7: {
      // Scattered stars.
      for (let i = 0; i < 26; i += 1) {
        const sx = x + (6 + rnd() * 88) * u;
        const sy = y + h * (0.05 + rnd() * 0.9);
        const s = (0.8 + rnd() * (i < 3 ? 4 : 1.8)) * u;
        ctx.globalAlpha = 0.5 + rnd() * 0.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy - s * 2);
        ctx.quadraticCurveTo(sx, sy, sx + s * 2, sy);
        ctx.quadraticCurveTo(sx, sy, sx, sy + s * 2);
        ctx.quadraticCurveTo(sx, sy, sx - s * 2, sy);
        ctx.quadraticCurveTo(sx, sy, sx, sy - s * 2);
        ctx.fill();
      }
      break;
    }
    default: {
      // A tall window with a moon in it.
      const ww = 34 * u;
      const wx = x + w / 2 - ww / 2 + (rnd() - 0.5) * 20 * u;
      const top = y + h * 0.08;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(wx, y + h);
      ctx.lineTo(wx, top + ww / 2);
      ctx.arc(wx + ww / 2, top + ww / 2, ww / 2, Math.PI, 0);
      ctx.lineTo(wx + ww, y + h);
      ctx.lineWidth = 1.4 * u;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(wx + ww / 2, top + ww * 0.62, ww * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.45;
      for (let i = 1; i < 6; i += 1) line(ctx, [[wx, top + ww + i * 6 * u], [wx + ww, top + ww + i * 6 * u]], 0.4 * u);
    }
  }
  ctx.restore();
}

// ---------- surfaces ----------

function titleSize(title: string, u: number): number {
  const n = title.length;
  if (n <= 12) return 10.6 * u;
  if (n <= 22) return 8.6 * u;
  if (n <= 38) return 7 * u;
  if (n <= 60) return 5.8 * u;
  return 4.9 * u;
}

/** Front cover for a book that came without one. */
export function paintFront(art: VolumeArt, p: Palette, aspect: number): HTMLCanvasElement {
  const W = 640;
  const H = Math.round(W * aspect);
  const [canvas, ctx] = makeCanvas(W, H);
  if (!ctx) return canvas;
  const u = W / 100;

  ctx.fillStyle = p.cover;
  ctx.fillRect(0, 0, W, H);
  drawMotif(ctx, art.seed, p, 0, H * 0.54, W, H * 0.36);
  grain(ctx, W, H);

  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 0.45 * u;
  ctx.strokeRect(3.2 * u, 3.2 * u, W - 6.4 * u, H - 6.4 * u);
  ctx.restore();

  ctx.fillStyle = p.ink;
  ctx.textBaseline = 'top';
  ctx.font = `600 ${2.3 * u}px ${SANS}`;
  tracked(ctx, art.imprint.toUpperCase(), 8 * u, 9 * u, 0.62 * u);

  const size = titleSize(art.title, u);
  ctx.font = `560 ${size}px ${SERIF}`;
  const lines = wrap(ctx, art.title, W - 16 * u, 5);
  const lh = size * 1.04;
  lines.forEach((l, i) => ctx.fillText(l, 7.4 * u, 16 * u + i * lh));

  if (art.author) {
    ctx.font = `500 ${3.6 * u}px ${SANS}`;
    ctx.fillText(ellipsize(ctx, art.author, W - 16 * u), 8 * u, 16 * u + lines.length * lh + 3.4 * u);
  }

  ctx.globalAlpha = 0.75;
  ctx.font = `500 ${1.9 * u}px ${SANS}`;
  ctx.textBaseline = 'alphabetic';
  tracked(ctx, art.tagline.toUpperCase(), 8 * u, H - 6.6 * u, 0.5 * u);
  return canvas;
}

/** Back cover: the reader's own words about the book, when there are some. */
export function paintBack(art: VolumeArt, p: Palette, aspect: number): HTMLCanvasElement {
  const W = 640;
  const H = Math.round(W * aspect);
  const [canvas, ctx] = makeCanvas(W, H);
  if (!ctx) return canvas;
  const u = W / 100;

  ctx.fillStyle = p.cover;
  ctx.fillRect(0, 0, W, H);
  grain(ctx, W, H);
  ctx.fillStyle = p.ink;
  ctx.textBaseline = 'top';

  let y = 12 * u;
  if (art.back) {
    ctx.save();
    ctx.fillStyle = p.accent;
    ctx.font = `600 ${16 * u}px ${SERIF}`;
    ctx.fillText('“', 6 * u, 4 * u);
    ctx.restore();
    y = 20 * u;
    ctx.font = `italic 440 ${4.3 * u}px ${SERIF}`;
    const lines = wrap(ctx, art.back.replace(/\s+/g, ' '), W - 18 * u, 14);
    lines.forEach((l, i) => ctx.fillText(l, 9 * u, y + i * 5.9 * u));
    y += lines.length * 5.9 * u + 5 * u;
  } else {
    ctx.font = `560 ${6.2 * u}px ${SERIF}`;
    const lines = wrap(ctx, art.title, W - 18 * u, 4);
    lines.forEach((l, i) => ctx.fillText(l, 9 * u, y + i * 7 * u));
    y += lines.length * 7 * u + 5 * u;
  }

  ctx.save();
  ctx.fillStyle = p.accent;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(9 * u, y, 12 * u, 0.9 * u);
  ctx.restore();

  ctx.font = `600 ${2.2 * u}px ${SANS}`;
  ctx.globalAlpha = 0.85;
  tracked(ctx, art.backCaption.toUpperCase(), 9 * u, y + 4 * u, 0.5 * u);

  // A barcode, because every book has one — this one spells nothing.
  const rnd = seededRandom(`${art.seed}#barcode`);
  ctx.globalAlpha = 0.9;
  let bx = W - 34 * u;
  const by = H - 22 * u;
  ctx.fillStyle = p.ink;
  ctx.fillRect(bx - 2 * u, by - 2 * u, 28 * u, 16 * u);
  ctx.fillStyle = p.cover;
  while (bx < W - 10 * u) {
    const bw = (0.25 + rnd() * 0.9) * u;
    ctx.fillRect(bx, by, bw, 10 * u);
    bx += bw + (0.3 + rnd() * 0.8) * u;
  }
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = p.ink;
  ctx.font = `500 ${1.8 * u}px ${SANS}`;
  ctx.textBaseline = 'alphabetic';
  tracked(ctx, art.tagline.toUpperCase(), 9 * u, H - 7 * u, 0.5 * u);
  return canvas;
}

/** The spine — the only face most books ever show. */
export function paintSpine(art: VolumeArt, p: Palette, thickness: number, height: number): HTMLCanvasElement {
  const SH = 768;
  const SW = Math.min(200, Math.max(36, Math.round((SH * thickness) / height)));
  const [canvas, ctx] = makeCanvas(SW, SH);
  if (!ctx) return canvas;

  ctx.fillStyle = p.cover;
  ctx.fillRect(0, 0, SW, SH);
  grain(ctx, SW, SH, 1.2);

  // Head and tail bands, the way cloth bindings are stamped.
  ctx.fillStyle = p.accent;
  ctx.fillRect(0, SH * 0.045, SW, SH * 0.012);
  ctx.fillRect(0, SH * 0.066, SW, SH * 0.003);
  ctx.fillRect(0, SH * 0.931, SW, SH * 0.003);
  ctx.fillRect(0, SH * 0.943, SW, SH * 0.012);

  ctx.fillStyle = p.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const markSize = Math.min(19, Math.max(9, SW * 0.24));
  ctx.font = `700 ${markSize}px ${SANS}`;
  tracked(ctx, art.spineMark, SW / 2, SH * 0.895, markSize * 0.08, 'center');

  // Title runs up the spine, starting just above the mark.
  const start = SH * 0.845;
  const end = SH * 0.105;
  const run = start - end;
  ctx.save();
  ctx.translate(SW / 2, start);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'left';

  let size = Math.min(52, Math.max(13, SW * 0.44));
  ctx.font = `560 ${size}px ${SERIF}`;
  const twoLines = SW > 120 && !!art.author;
  const authorSize = Math.min(20, Math.max(9, SW * (twoLines ? 0.15 : 0.2)));

  if (twoLines) {
    const fit = Math.min(1, run / Math.max(1, ctx.measureText(art.title).width));
    size = Math.max(14, size * fit);
    ctx.font = `560 ${size}px ${SERIF}`;
    ctx.fillText(ellipsize(ctx, art.title, run), 0, -authorSize * 0.75);
    ctx.globalAlpha = 0.8;
    ctx.font = `500 ${authorSize}px ${SANS}`;
    ctx.fillText(ellipsize(ctx, art.author ?? '', run), 0, size * 0.62);
  } else {
    ctx.font = `500 ${authorSize}px ${SANS}`;
    let author = art.author ? ellipsize(ctx, art.author, run * 0.32) : '';
    let authorW = author ? ctx.measureText(author).width + size * 0.9 : 0;
    ctx.font = `560 ${size}px ${SERIF}`;
    const titleW = Math.max(1, ctx.measureText(art.title).width);
    // The title matters more than the author: set it smaller before
    // cutting it, and give up the author before giving up the title.
    if ((run - authorW) / titleW < 0.74) {
      author = '';
      authorW = 0;
    }
    const room = run - authorW;
    size = Math.max(11, size * Math.min(1, room / titleW));
    ctx.font = `560 ${size}px ${SERIF}`;
    ctx.fillText(ellipsize(ctx, art.title, room), 0, 0);
    if (author) {
      ctx.globalAlpha = 0.8;
      ctx.font = `500 ${authorSize}px ${SANS}`;
      ctx.textAlign = 'right';
      ctx.fillText(author, run, 0);
    }
  }
  ctx.restore();
  return canvas;
}

/** Walnut for the shelf, tileable along its length. */
export function paintWood(): HTMLCanvasElement {
  const W = 1024;
  const H = 256;
  const [canvas, ctx] = makeCanvas(W, H);
  if (!ctx) return canvas;
  const rnd = seededRandom('walnut');

  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#6a4630');
  base.addColorStop(0.5, '#5d3c27');
  base.addColorStop(1, '#65432d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 120; i += 1) {
    const dark = rnd() < 0.62;
    ctx.strokeStyle = dark
      ? `rgba(38, 22, 13, ${0.12 + rnd() * 0.32})`
      : `rgba(150, 104, 70, ${0.06 + rnd() * 0.18})`;
    ctx.lineWidth = 0.5 + rnd() * 2.4;
    const y0 = rnd() * H;
    const k1 = 1 + Math.floor(rnd() * 3);
    const k2 = 3 + Math.floor(rnd() * 5);
    const a1 = 2 + rnd() * 7;
    const a2 = rnd() * 2;
    const ph = rnd() * Math.PI * 2;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const t = (x / W) * Math.PI * 2;
      const y = y0 + Math.sin(t * k1 + ph) * a1 + Math.sin(t * k2 + ph * 2) * a2;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  grain(ctx, W, H, 0.8);
  return canvas;
}

// ---------- colour from an uploaded cover ----------

function hexOf(rgb: number[]): string {
  return `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

function luminance([r, g, b]: number[]): number {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Board, headband and type colours that belong to a real cover image, so an
 * uploaded book's spine matches its front instead of wearing a random palette.
 */
export function paletteFromImage(img: HTMLImageElement, fallback: Palette): Palette {
  const [canvas, ctx] = makeCanvas(24, 36);
  if (!ctx) return fallback;
  try {
    ctx.drawImage(img, 0, 0, 24, 36);
    const data = ctx.getImageData(0, 0, 24, 36).data;
    const buckets = new Map<string, { n: number; r: number; g: number; b: number; edge: number }>();
    for (let y = 0; y < 36; y += 1) {
      for (let x = 0; x < 24; x += 1) {
        const i = (y * 24 + x) * 4;
        const rgb = [data[i], data[i + 1], data[i + 2]];
        const k = rgb.map((v) => v >> 5).join(',');
        const e = x < 3 || x > 20 || y < 3 || y > 32 ? 1 : 0;
        const bkt = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0, edge: 0 };
        bkt.n += 1;
        bkt.edge += e;
        bkt.r += rgb[0];
        bkt.g += rgb[1];
        bkt.b += rgb[2];
        buckets.set(k, bkt);
      }
    }
    const all = [...buckets.values()].map((b) => ({ ...b, rgb: [b.r / b.n, b.g / b.n, b.b / b.n] }));
    const cover = [...all].sort((a, b) => b.edge - a.edge || b.n - a.n)[0];
    if (!cover) return fallback;
    const sat = (c: number[]) => Math.max(...c) - Math.min(...c);
    const accent = all
      .filter((b) => Math.hypot(b.rgb[0] - cover.rgb[0], b.rgb[1] - cover.rgb[1], b.rgb[2] - cover.rgb[2]) > 70)
      .sort((a, b) => b.n * (1 + sat(b.rgb) / 90) - a.n * (1 + sat(a.rgb) / 90))[0];
    const light = [246, 240, 228];
    const dark = [29, 26, 23];
    const ink = contrast(cover.rgb, light) >= contrast(cover.rgb, dark) ? light : dark;
    return { cover: hexOf(cover.rgb), accent: hexOf(accent ? accent.rgb : ink), ink: hexOf(ink) };
  } catch {
    // A tainted canvas or a decode failure — keep the printed palette.
    return fallback;
  }
}

export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Wait for the shelf's typefaces, including the Cyrillic and Kazakh subsets.
 * Never fails: a font that cannot download (Safari rejects with NetworkError,
 * Sentry POWERBOOK-FRONTEND-4) leaves the fallback faces to draw with. */
export async function loadShelfFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  const sample = 'Aa Яя Әә Ғғ Ққ Ңң Өө Ұұ Үү Һһ Іі 0123';
  const specs = [`560 40px ${SERIF}`, `italic 440 40px ${SERIF}`, `500 20px ${SANS}`, `600 20px ${SANS}`, `700 20px ${SANS}`];
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, 2500));
  const loaded = Promise.all(specs.map((s) => document.fonts.load(s, sample))).then(
    () => undefined,
    () => undefined
  );
  await Promise.race([loaded, timeout]);
}
