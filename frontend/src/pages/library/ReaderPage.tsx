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
  const stageRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const saveTimer = useRef<number | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const fontPctRef = useRef(100);

  const [meta, setMeta] = useState<LibraryBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [percent, setPercent] = useState(0);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfPages, setPdfPages] = useState(0);
  const [showToc, setShowToc] = useState(false);
  const [toc, setToc] = useState<{ label: string; href: string }[]>([]);
  // Font size is a reader preference, not a per-book one, so it is remembered
  // globally and applied to whatever they open next.
  const [fontPct, setFontPct] = useState(() => {
    const saved = Number(localStorage.getItem('pb.readerFont'));
    return Number.isFinite(saved) && saved >= 80 && saved <= 200 ? saved : 100;
  });

  // Keep the ref in step so the loader effect doesn't depend on font size and
  // re-open the book every time it changes.
  useEffect(() => {
    fontPctRef.current = fontPct;
    localStorage.setItem('pb.readerFont', String(fontPct));
    renditionRef.current?.themes.fontSize(`${fontPct}%`);
  }, [fontPct]);

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
          rendition.themes.fontSize(`${fontPctRef.current}%`);
          await rendition.display(info.progress_position ?? undefined);

          // Chapter list for jumping around — every real reader has one.
          try {
            const nav = await book.loaded.navigation;
            setToc(
              (nav.toc ?? []).map((item: { label: string; href: string }) => ({
                label: (item.label ?? '').trim(),
                href: item.href,
              }))
            );
          } catch {
            /* a book without navigation still reads fine */
          }

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

  // Swipe to turn pages. On a phone this is how people expect to read; the
  // buttons stay for desktop and accessibility.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let startX = 0;
    let startY = 0;
    const onStart = (e: TouchEvent) => {
      startX = e.changedTouches[0].clientX;
      startY = e.changedTouches[0].clientY;
    };
    const onEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      // Ignore mostly-vertical movement so scrolling a PDF page doesn't
      // accidentally flip it.
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) goNext();
      else goPrev();
    };
    stage.addEventListener('touchstart', onStart, { passive: true });
    stage.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      stage.removeEventListener('touchstart', onStart);
      stage.removeEventListener('touchend', onEnd);
    };
  }, [goNext, goPrev]);

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
        <div className={styles.barTools}>
          {meta?.file_format === 'epub' && (
            <>
              <button
                className={styles.toolBtn}
                onClick={() => setFontPct((v) => Math.max(80, v - 10))}
                aria-label={t('library.fontSmaller')}
              >
                A−
              </button>
              <button
                className={styles.toolBtn}
                onClick={() => setFontPct((v) => Math.min(200, v + 10))}
                aria-label={t('library.fontBigger')}
              >
                A+
              </button>
              {toc.length > 0 && (
                <button
                  className={styles.toolBtn}
                  onClick={() => setShowToc((v) => !v)}
                  aria-label={t('library.contents')}
                >
                  ☰
                </button>
              )}
            </>
          )}
          <span className={styles.barPercent}>{percent}%</span>
        </div>
      </header>

      {showToc && (
        <>
          <div className={styles.tocBackdrop} onClick={() => setShowToc(false)} />
          <nav className={styles.tocPanel}>
            <div className={styles.tocTitle}>{t('library.contents')}</div>
            {toc.map((item, i) => (
              <button
                key={i}
                className={styles.tocItem}
                onClick={() => {
                  renditionRef.current?.display(item.href);
                  setShowToc(false);
                }}
              >
                {item.label || `#${i + 1}`}
              </button>
            ))}
          </nav>
        </>
      )}

      <div className={styles.stage} ref={stageRef}>
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
