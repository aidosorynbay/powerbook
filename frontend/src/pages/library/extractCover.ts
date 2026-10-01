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

/** epub.js keeps reading the book (navigation, page list) after the part we
 * asked for; destroying it midway throws inside epub.js. Let it finish first,
 * but never wait on a book whose navigation never comes: after a few seconds
 * it is left to the garbage collector instead. */
async function closeEpub(book: { ready: Promise<unknown>; destroy: () => void }): Promise<void> {
  const settled = await Promise.race([
    book.ready.then(() => true, () => true),
    new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 4000)),
  ]);
  if (settled) book.destroy();
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
    await closeEpub(book);
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

/**
 * The title and author the file itself carries (EPUB metadata, PDF document
 * info), to look the book up by instead of the file name. Never throws.
 */
export async function bookMeta(file: File): Promise<{ title: string; author: string } | null> {
  try {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'epub') {
      const { default: ePub } = await import('epubjs');
      const book = ePub(await file.arrayBuffer());
      try {
        const meta = await book.loaded.metadata;
        const title = (meta?.title ?? '').trim();
        return title ? { title, author: (meta?.creator ?? '').trim() } : null;
      } finally {
        await closeEpub(book);
      }
    }
    if (ext === 'pdf') {
      const pdfjsLib = await import('pdfjs-dist');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      try {
        const { info } = await pdf.getMetadata();
        const fields = info as { Title?: string; Author?: string };
        const title = (fields.Title ?? '').trim();
        // Office exports put the file name or "Microsoft Word - …" here; that says nothing.
        if (!title || /^microsoft|\.(docx?|pdf)$/i.test(title)) return null;
        return { title, author: (fields.Author ?? '').trim() };
      } finally {
        pdf.destroy();
      }
    }
    return null;
  } catch {
    return null;
  }
}
