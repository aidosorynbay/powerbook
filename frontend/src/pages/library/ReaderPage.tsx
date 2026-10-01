import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ePub, { type Book, type Rendition } from 'epubjs';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  useI18n,
  track,
  apiGet,
  apiGetBlob,
  apiPut,
  apiPost,
  DEFAULT_GROUP_SLUG,
  type LibraryBook,
  type CurrentRoundStatusResponse,
  type CalendarResponse,
} from '@/shared/lib';
import { Icon } from '@/shared/ui';
import { BookChat } from '@/widgets/BookChat';
import { Barys } from '@/widgets/Mascot';
import styles from './ReaderPage.module.css';

// pdf.js refuses to parse anything without a worker, and Vite needs the URL
// resolved at build time rather than guessed at runtime.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Progress is saved on a trailing timer rather than on every page turn: a fast
// reader flicking through pages would otherwise fire a request per flick.
const SAVE_DEBOUNCE_MS = 1500;

// A swipe shorter than this, or more vertical than sideways, is not a page turn.
const SWIPE_MIN_PX = 50;

/** Session time as the reader sees it ticking: 4:05, or 1:02:05 past an hour. */
const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

type ScreenLock = { release: () => Promise<void> };

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
  // Time actually spent reading this session. The app can measure it because
  // the book is open here — a tracker that lives outside your book has to
  // take your word for the number.
  const [seconds, setSeconds] = useState(0);
  const [logState, setLogState] = useState<'idle' | 'asking' | 'saving' | 'done' | 'error'>('idle');
  const [logMessage, setLogMessage] = useState('');
  const [toc, setToc] = useState<{ label: string; href: string }[]>([]);
  // Lock in: only the page, the page turns and the time are left on screen.
  const [focus, setFocus] = useState(false);
  // «Обсудить с AI» while reading.
  const [talk, setTalk] = useState(false);
  const wakeLock = useRef<ScreenLock | null>(null);
  const focusFullscreen = useRef(false);
  // The tap that ends a swipe must not turn the page a second time.
  const swipedAt = useRef(0);
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

  // Only counts while the reader is actually on screen: a book left open in a
  // background tab overnight must not turn into eight hours of "reading".
  useEffect(() => {
    if (isLoading || error) return;
    const tick = window.setInterval(() => {
      if (document.visibilityState === 'visible') setSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(tick);
  }, [isLoading, error]);

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

          // The book is drawn inside an iframe, so a swipe on the text never
          // reaches the stage's own touch handlers (that is why phones could
          // not turn pages). epub.js passes the iframe's events out through
          // the rendition instead.
          let touchStart: { x: number; y: number } | null = null;
          rendition.on('touchstart', (e: TouchEvent) => {
            touchStart = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
          });
          rendition.on('touchend', (e: TouchEvent) => {
            const start = touchStart;
            touchStart = null;
            if (!start) return;
            const dx = e.changedTouches[0].clientX - start.x;
            const dy = e.changedTouches[0].clientY - start.y;
            if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy)) return;
            swipedAt.current = Date.now();
            if (dx < 0) rendition.next();
            else rendition.prev();
          });
          // Arrow keys while the focus is inside the book's frame.
          rendition.on('keyup', (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') rendition.prev();
            if (e.key === 'ArrowRight') rendition.next();
          });
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
        if (!cancelled) {
          setIsLoading(false);
          track('reader_open', { format: info.file_format });
        }
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

  const minutes = Math.floor(seconds / 60);

  /** Add this session to today's entry.
   *
   * The log endpoint replaces the day's minutes rather than adding to them,
   * so today's existing total has to be read first — otherwise a 10-minute
   * session would wipe an hour already logged by hand.
   */
  const logSession = async () => {
    setLogState('saving');

    const { data: status } = await apiGet<CurrentRoundStatusResponse>(
      `/groups/by-slug/${DEFAULT_GROUP_SLUG}/current-round-status`, { requireAuth: true }
    );
    const round = status?.round;
    if (!round || !status?.participation?.is_participant) {
      setLogState('error');
      setLogMessage(t('reader.logNoRound'));
      return;
    }

    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const { data: cal } = await apiGet<CalendarResponse>(
      `/rounds/${round.id}/calendar`, { requireAuth: true }
    );
    const existing = cal?.days.find((d) => d.date === iso)?.minutes ?? 0;

    const { error: err } = await apiPost(
      `/rounds/${round.id}/reading_logs`,
      { date: iso, minutes: existing + minutes, book_finished: false, comment: null, comment_private: false },
      { requireAuth: true }
    );
    if (err) {
      setLogState('error');
      setLogMessage(err);
      return;
    }
    setLogState('done');
    track('reader_session_logged', { minutes });
    setLogMessage(t('reader.logSaved', { total: existing + minutes }));
  };

  const leave = () => {
    // Offer to keep the session rather than silently discarding it.
    if (minutes >= 1 && logState === 'idle') {
      setLogState('asking');
      return;
    }
    navigate('/library');
  };

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
  // buttons stay for desktop and accessibility. This catches touches on the
  // PDF page and on the edge zones; an EPUB's own text reports through the
  // rendition (see the loader).
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
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy)) return;
      swipedAt.current = Date.now();
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

  // ---- Lock in ------------------------------------------------------
  // The screen stays awake while locked in (where the browser allows it),
  // and the page goes full screen where there is such a thing (not on an
  // iPhone, where the reader simply gets the bars out of the way).
  const holdScreen = useCallback(async () => {
    const nav = navigator as Navigator & { wakeLock?: { request: (kind: 'screen') => Promise<ScreenLock> } };
    try {
      wakeLock.current = (await nav.wakeLock?.request('screen')) ?? null;
    } catch {
      wakeLock.current = null;
    }
  }, []);

  const enterFocus = useCallback(async () => {
    setFocus(true);
    track('reader_lock_in');
    setShowToc(false);
    holdScreen();
    const root = document.documentElement;
    if (document.fullscreenEnabled && !document.fullscreenElement && root.requestFullscreen) {
      try {
        await root.requestFullscreen({ navigationUI: 'hide' });
        focusFullscreen.current = true;
      } catch {
        focusFullscreen.current = false;
      }
    }
  }, [holdScreen]);

  const exitFocus = useCallback(() => {
    setFocus(false);
    wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
    if (focusFullscreen.current && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    focusFullscreen.current = false;
  }, []);

  useEffect(() => {
    if (!focus) return;
    // The browser lets go of the screen whenever the tab is hidden; take it back on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') holdScreen();
    };
    // Leaving full screen by the system's own gesture (Esc, Android back) leaves Lock in too.
    const onFullscreen = () => {
      if (!document.fullscreenElement && focusFullscreen.current) exitFocus();
    };
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [focus, holdScreen, exitFocus]);

  // The bars come and go, so the book's frame changes size: let epub.js lay the pages out again.
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        try {
          // With no size given epub.js measures its frame again; its types insist on one.
          (rendition.resize as unknown as () => void).call(rendition);
        } catch {
          /* a book still opening lays itself out anyway */
        }
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [focus]);

  // Never leave the screen held after the book is closed.
  useEffect(() => () => {
    wakeLock.current?.release().catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'Escape') {
        if (focus) exitFocus();
        else leave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goPrev, goNext, minutes, logState, focus, exitFocus]);

  // A tap on either edge turns the page, unless it is the end of a swipe that already did.
  const tapTurn = (dir: 'prev' | 'next') => {
    if (Date.now() - swipedAt.current < 400) return;
    if (dir === 'prev') goPrev();
    else goNext();
  };

  const position =
    meta?.file_format === 'pdf' && pdfPages > 0 ? t('library.pageOf', { page: pdfPage, total: pdfPages }) : `${percent}%`;

  return (
    <div className={`${styles.reader} ${focus ? styles.focus : ''}`}>
      <header className={styles.bar}>
        <button className={styles.barBtn} onClick={leave}>
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
          <button className={styles.toolBtn} onClick={() => setTalk(true)} aria-label={t('chat.open')} title={t('chat.open')}>
            <Icon name="sparkle" size="em" aria-hidden="true" />
          </button>
          <span className={styles.barPercent}>{percent}%</span>
        </div>
      </header>
      {talk && <BookChat volumeKey={`u:${bookId}`} title={meta?.title} from="reader" onClose={() => setTalk(false)} />}

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

      {logState !== 'idle' && (
        <div className={styles.logOverlay}>
          <div className={styles.logCard}>
            {logState === 'asking' && (
              <>
                <div className={styles.logTitle}>{t('reader.logTitle', { minutes })}</div>
                <p className={styles.logText}>{t('reader.logText')}</p>
                <div className={styles.logActions}>
                  <button className={styles.logSkip} onClick={() => navigate('/library')}>
                    {t('reader.logSkip')}
                  </button>
                  <button className={styles.logConfirm} onClick={logSession}>
                    {t('reader.logConfirm')}
                  </button>
                </div>
              </>
            )}
            {logState === 'saving' && <div className={styles.logTitle}>{t('reader.logSaving')}</div>}
            {(logState === 'done' || logState === 'error') && (
              <>
                <div className={styles.logTitle}>{logMessage}</div>
                <div className={styles.logActions}>
                  <button className={styles.logConfirm} onClick={() => navigate('/library')}>
                    {t('reader.logClose')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className={styles.stageWrap} ref={stageRef}>
        <div className={styles.stage}>
          {isLoading && <div className={styles.loading}>{t('library.opening')}</div>}
          {error && <div className={styles.error}>{error}</div>}
          <div ref={hostRef} className={styles.host} />
        </div>
        {!isLoading && !error && (
          <>
            <button type="button" className={`${styles.tapZone} ${styles.tapPrev}`} onClick={() => tapTurn('prev')} aria-label={t('reader.prev')}>
              <span aria-hidden="true">‹</span>
            </button>
            <button type="button" className={`${styles.tapZone} ${styles.tapNext}`} onClick={() => tapTurn('next')} aria-label={t('reader.next')}>
              <span aria-hidden="true">›</span>
            </button>
          </>
        )}
      </div>

      {!isLoading && !error && !focus && (
        <footer className={styles.controls}>
          <button className={styles.navBtn} onClick={goPrev} aria-label={t('reader.prev')}>‹</button>
          <div className={styles.sessionTime} title={t('reader.sessionTitle')}>
            <Icon name="clock" size="em" aria-hidden="true" /> {clock(seconds)}
          </div>
          <div className={styles.position}>{position}</div>
          <button type="button" className={styles.lockBtn} onClick={enterFocus} title={t('reader.focusHint')}>
            <Icon name="lock" size="em" aria-hidden="true" />
            {t('reader.lockIn')}
          </button>
          <button className={styles.navBtn} onClick={goNext} aria-label={t('reader.next')}>›</button>
        </footer>
      )}

      {!isLoading && !error && focus && (
        <footer className={styles.focusBar}>
          <span className={styles.focusTime} title={t('reader.sessionTitle')}>
            <Barys mood="reading" size={30} className={styles.focusBarys} />
            <Icon name="clock" size="em" aria-hidden="true" /> {clock(seconds)}
          </span>
          <span className={styles.position}>{position}</span>
          <button type="button" className={styles.unlockBtn} onClick={exitFocus}>
            <Icon name="unlock" size="em" aria-hidden="true" />
            {t('reader.unlock')}
          </button>
        </footer>
      )}
    </div>
  );
}
