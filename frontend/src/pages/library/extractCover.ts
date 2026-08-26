/**
 * Build a small cover thumbnail from an uploaded book, in the browser.
 *
 * Done client-side on purpose: the server would need a PDF renderer and an
 * EPUB parser to do the same job, and the file is already in memory here.
 *
 * epub.js and pdf.js are imported dynamically so the library page doesn't
 * drag ~800KB of reader into its bundle just to show thumbnails.
 */

const MAX_W = 320;
const JPEG_QUALITY = 0.72;

function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

function scaleCanvas(source: HTMLCanvasElement | HTMLImageElement, w: number, h: number): string {
  const ratio = Math.min(1, MAX_W / w);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvasToDataUrl(canvas);
}

async function epubCover(file: File): Promise<string | null> {
  const { default: ePub } = await import('epubjs');
  const book = ePub(await file.arrayBuffer());
  try {
    const url = await book.coverUrl();
    if (!url) return null;
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = url;
    });
    if (!img) return null;
    return scaleCanvas(img, img.naturalWidth, img.naturalHeight);
  } finally {
    book.destroy();
  }
}

async function pdfCover(file: File): Promise<string | null> {
  const pdfjsLib = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = MAX_W / viewport.width;
    const scaled = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(scaled.width);
    canvas.height = Math.round(scaled.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    await page.render({ canvas, canvasContext: ctx, viewport: scaled }).promise;
    return canvasToDataUrl(canvas);
  } finally {
    pdf.destroy();
  }
}

/** Never throws: a missing cover is a cosmetic issue, not a failed upload. */
export async function extractCover(file: File): Promise<string | null> {
  try {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'epub') return await epubCover(file);
    if (ext === 'pdf') return await pdfCover(file);
    return null;
  } catch {
    return null;
  }
}
