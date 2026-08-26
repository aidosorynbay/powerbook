import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ePub, { type Book, type Rendition } from 'epubjs';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useI18n, apiGet, apiGetBlob, apiPut, type LibraryBook } from '@/shared/lib';
import styles from './ReaderPage.module.css';

// pdf.js refuses to parse anything without a worker, and Vite needs the URL
// resolved at build time rather than guessed at runtime.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Progress is saved on a trailing timer rather than on every page turn: a fast
// reader flicking through pages would otherwise fire a request per flick.
const SAVE_DEBOUNCE_MS = 1500;

export function ReaderPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();

  const hostRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const saveTimer = useRef<number | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [meta, setMeta] = useState<LibraryBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [percent, setPercent] = useState(0);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfPages, setPdfPages] = useState(0);

  /** Persist position. Debounced, and never lowers a percentage the server
   *  already knows about — the backend enforces that too, this just avoids
   *  pointless writes. */
  const queueSave = useCallback((pct: number, position: string) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      apiPut(
        `/library/books/${bookId}/progress`,
        { percent: Math.round(pct), position },
        { requireAuth: true }
      );
    }, SAVE_DEBOUNCE_MS);
  }, [bookId]);

  // ---- PDF rendering -------------------------------------------------
  const renderPdfPage = useCallback(async (pageNum: number) => {
    const pdf = pdfRef.current;
    const host = hostRef.current;
    if (!pdf || !host) return;

    const page = await pdf.getPage(pageNum);
    // Fit the page to the container width; on a phone this is what makes a
    // PDF readable at all.
    const unscaled = page.getViewport({ scale: 1 });
    const scale = Math.min(3, Math.max(0.4, host.clientWidth / unscaled.width));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Render at device resolution so text isn't blurry on retina screens.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = '100%';
    canvas.style.height = 'auto';

    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    }).promise;

    host.replaceChildren(canvas);
  }, []);

  const goToPdfPage = useCallback((next: number) => {
    const total = pdfRef.current?.numPages ?? 0;
    if (!total) return;
    const clamped = Math.min(total, Math.max(1, next));
    setPdfPage(clamped);
    renderPdfPage(clamped);
    const pct = (clamped / total) * 100;
    setPercent(Math.round(pct));
    queueSave(pct, String(clamped));
  }, [renderPdfPage, queueSave]);

  // ---- load ----------------------------------------------------------
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;

    (async () => {
      // Metadata only lives on the list endpoint, so pick ours out of it.
      const { data: list, error: listErr } = await apiGet<LibraryBook[]>(
        '/library/books', { requireAuth: true }
      );
      if (cancelled) return;
      const info = list?.find((b) => b.id === bookId) ?? null;
      const metaErr = info ? null : listErr;
      if (!info) {
        setError(metaErr ?? t('library.notFound'));
        setIsLoading(false);
        return;
      }
      setMeta(info);
      setPercent(info.progress_percent);

      const { data: blob, error: fileErr } = await apiGetBlob(
        `/library/books/${bookId}/file`, { requireAuth: true }
      );
      if (cancelled) return;
      if (!blob) {
        setError(fileErr ?? t('library.notFound'));
        setIsLoading(false);
        return;
      }

      try {
        if (info.file_format === 'epub') {
          const buf = await blob.arrayBuffer();
          if (cancelled) return;
          const book = ePub(buf);
          bookRef.current = book;
          const rendition = book.renderTo(hostRef.current!, {
            width: '100%',
            height: '100%',
            spread: 'none',
          });
          renditionRef.current = rendition;
          await rendition.display(info.progress_position ?? undefined);

          // locations power the percentage; generating them is what lets a
          // CFI be turned into "you are 34% through".
          await book.locations.generate(1600);
          rendition.on('relocated', (location: { start: { cfi: string } }) => {
            const cfi = location.start.cfi;
            const pct = (book.locations.percentageFromCfi(cfi) ?? 0) * 100;
            setPercent(Math.round(pct));
            queueSave(pct, cfi);
          });
        } else {
          const buf = await blob.arrayBuffer();
          if (cancelled) return;
          const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
          pdfRef.current = pdf;
          setPdfPages(pdf.numPages);
          const startPage = Math.min(
            pdf.numPages,
            Math.max(1, parseInt(info.progress_position ?? '1', 10) || 1)
          );
          setPdfPage(startPage);
          await renderPdfPage(startPage);
        }
        if (!cancelled) setIsLoading(false);
      } catch {
        if (!cancelled) {
          setError(t('library.readError'));
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      pdfRef.current?.destroy();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [bookId, t, queueSave, renderPdfPage]);

  // ---- navigation ----------------------------------------------------
  const goPrev = useCallback(() => {
    if (renditionRef.current) renditionRef.current.prev();
    else goToPdfPage(pdfPage - 1);
  }, [goToPdfPage, pdfPage]);

  const goNext = useCallback(() => {
    if (renditionRef.current) renditionRef.current.next();
    else goToPdfPage(pdfPage + 1);
  }, [goToPdfPage, pdfPage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'Escape') navigate('/library');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goPrev, goNext, navigate]);

  return (
    <div className={styles.reader}>
      <header className={styles.bar}>
        <button className={styles.barBtn} onClick={() => navigate('/library')}>
          ← {t('library.backToLibrary')}
        </button>
        <div className={styles.barTitle}>{meta?.title ?? ''}</div>
        <div className={styles.barPercent}>{percent}%</div>
      </header>

      <div className={styles.stage}>
        {isLoading && <div className={styles.loading}>{t('library.opening')}</div>}
        {error && <div className={styles.error}>{error}</div>}
        <div ref={hostRef} className={styles.host} />
      </div>

      {!isLoading && !error && (
        <footer className={styles.controls}>
          <button className={styles.navBtn} onClick={goPrev}>‹</button>
          <div className={styles.position}>
            {meta?.file_format === 'pdf' && pdfPages > 0
              ? t('library.pageOf', { page: pdfPage, total: pdfPages })
              : `${percent}%`}
          </div>
          <button className={styles.navBtn} onClick={goNext}>›</button>
        </footer>
      )}
    </div>
  );
}
