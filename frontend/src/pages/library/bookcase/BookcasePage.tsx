import { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  useI18n,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  apiPut,
  apiUploadWithProgress,
  getApiBaseUrl,
  useResolvedTheme,
  type Bookcase,
  type BookcaseBook,
  type BookNote,
  type CustomShelf,
  type FellowReader,
  type LibraryBook,
  type LibraryStats,
  type Locale,
  type Work,
} from '@/shared/lib';
import { Avatar } from '@/shared/ui';
import { Header } from '@/widgets';
import { extractCover } from '../extractCover';
import { EditBookSheet } from './EditBookSheet';
import { MarkForm } from '../../books/MarkForm';
import { ExtBadge, PbBadge } from '../../books/bookUi';
import { BookcaseSections, ShelvesSheet } from './BookcaseSections';
import { loadShelfFonts, type VolumeArt } from './bookArt';
import { bookCount, plural } from './plural';
import type { BookcaseScene, SceneMode, SceneVolume } from './BookcaseScene';
import styles from './Bookcase.module.css';

type Sort = 'recent' | 'az' | 'popular';
type Filter = 'all' | 'files';

const MB = 1024 * 1024;
const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=Literata:ital,opsz,wght@0,7..72,300..700;1,7..72,300..700&display=swap';
// Phones: height kept free above the caption's bottom edge for its tallest
// form (badge, two-line title, author, buttons), less the fade books show through.
const CAPTION_ROOM = 200;

const MONTHS: Record<Locale, string[]> = {
  ru: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
  kk: ['Қаңтар', 'Ақпан', 'Наурыз', 'Сәуір', 'Мамыр', 'Маусым', 'Шілде', 'Тамыз', 'Қыркүйек', 'Қазан', 'Қараша', 'Желтоқсан'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const INTL: Record<Locale, string> = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' };

function formatSize(bytes: number): string {
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

function seedOf(book: BookcaseBook): string {
  return book.match_key || book.title.trim().toLowerCase();
}

/**
 * Find a book by key or by title. A link from elsewhere in the app may carry
 * the whole comment a round book was finished with, while the shelf shows the
 * title carved out of it — so containment counts too, longest title first.
 */
function findBook(list: BookcaseBook[], wanted: string): number {
  const exact = list.findIndex((b) => b.key === wanted);
  if (exact >= 0) return exact;
  const norm = (s: string) => s.toLowerCase().replace(/[«»"“”„'’.,:;!?()—–-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const needle = norm(wanted);
  const same = list.findIndex((b) => norm(b.title) === needle);
  if (same >= 0) return same;
  let best = -1;
  let bestLen = 2;
  list.forEach((b, i) => {
    const title = norm(b.title);
    if (title.length > bestLen && needle.includes(title)) {
      best = i;
      bestLen = title.length;
    }
  });
  return best;
}

/**
 * The reader's own notes on the book held up: the list, a form to add one,
 * and edit / delete on each. Only rendered on the reader's own shelf.
 */
function BookNotes({ book, locale, onNotes }: { book: BookcaseBook; locale: Locale; onNotes: (key: string, notes: BookNote[]) => void }) {
  const { t } = useI18n();
  const notes = book.notes ?? [];
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Another book in the hands: start clean.
  useEffect(() => {
    setAdding(false);
    setDraft('');
    setEditingId(null);
    setError(null);
  }, [book.key]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const { data } = await apiPost<BookNote>('/library/notes', { volume_key: book.key, text }, { requireAuth: true });
    setBusy(false);
    if (!data) return setError(t('shelf.noteError'));
    onNotes(book.key, [...notes, data]);
    setDraft('');
    setAdding(false);
  };

  const save = async (e: FormEvent, id: string) => {
    e.preventDefault();
    const text = editDraft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const { data } = await apiPatch<BookNote>(`/library/notes/${id}`, { text }, { requireAuth: true });
    setBusy(false);
    if (!data) return setError(t('shelf.noteError'));
    onNotes(book.key, notes.map((n) => (n.id === id ? data : n)));
    setEditingId(null);
  };

  const remove = async (id: string) => {
    if (busy || !window.confirm(t('shelf.noteConfirmDelete'))) return;
    setBusy(true);
    setError(null);
    const { error: failed } = await apiDelete(`/library/notes/${id}`, { requireAuth: true });
    setBusy(false);
    if (failed) return setError(t('shelf.noteError'));
    onNotes(book.key, notes.filter((n) => n.id !== id));
  };

  // Escape inside a note closes the form, not the book (and keeps the draft safe).
  const escape = (close: () => void) => (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };

  return (
    <section className={styles.notes} aria-label={t('shelf.notesTitle')}>
      <h3 className={styles.notesTitle}>{t('shelf.notesTitle')}</h3>
      <p className={styles.notesHint}>{t('shelf.notesHint')}</p>
      {notes.length > 0 && (
        <ul className={styles.noteList}>
          {notes.map((n) => {
            const edited = new Date(n.updated_at).getTime() - new Date(n.created_at).getTime() > 60_000;
            return (
              <li key={n.id} className={styles.noteItem}>
                {editingId === n.id ? (
                  <form className={styles.noteForm} onSubmit={(e) => save(e, n.id)}>
                    <textarea
                      className={styles.field}
                      rows={3}
                      maxLength={4000}
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={escape(() => setEditingId(null))}
                      aria-label={t('shelf.noteEdit')}
                      autoFocus
                    />
                    <div className={styles.noteActions}>
                      <button type="submit" className={styles.addButton} disabled={busy || !editDraft.trim()}>
                        {t('shelf.noteSave')}
                      </button>
                      <button type="button" className={styles.ghostButton} onClick={() => setEditingId(null)}>
                        {t('shelf.noteCancel')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p className={styles.noteText}>{n.text}</p>
                    <div className={styles.noteMeta}>
                      <span>
                        {formatDate(n.created_at, locale)}
                        {edited && ` · ${t('shelf.noteEdited')}`}
                      </span>
                      <button type="button" onClick={() => { setEditingId(n.id); setEditDraft(n.text); setAdding(false); }} disabled={busy}>
                        {t('shelf.noteEdit')}
                      </button>
                      <button type="button" onClick={() => remove(n.id)} disabled={busy}>
                        {t('shelf.noteDelete')}
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {adding ? (
        <form className={styles.noteForm} onSubmit={add}>
          <textarea
            className={styles.field}
            rows={3}
            maxLength={4000}
            placeholder={t('shelf.notePlaceholder')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={escape(() => setAdding(false))}
            aria-label={t('shelf.noteAdd')}
            autoFocus
          />
          <div className={styles.noteActions}>
            <button type="submit" className={styles.addButton} disabled={busy || !draft.trim()}>
              {t('shelf.noteSave')}
            </button>
            <button type="button" className={styles.ghostButton} onClick={() => setAdding(false)}>
              {t('shelf.noteCancel')}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className={styles.noteAddButton} onClick={() => { setAdding(true); setEditingId(null); }}>
          <span aria-hidden="true">+</span>
          {t('shelf.noteAdd')}
        </button>
      )}
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function formatDate(iso: string | null, locale: Locale): string | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  // Russian appends "г." to a year; on a book's colophon it reads as clutter.
  return d.toLocaleDateString(INTL[locale], { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s?г\.$/, '');
}

function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <span aria-hidden="true" className={`${styles.arrowIcon} ${direction === 'left' ? styles.arrowLeft : styles.arrowRight}`}>
      <span />
    </span>
  );
}

type Props = {
  /** Someone else's shelf; omitted for the reader's own library. */
  ownerId?: string;
};

export function BookcasePage({ ownerId }: Props) {
  const { t, locale } = useI18n();
  const [params] = useSearchParams();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BookcaseScene | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTitle = useRef<string | null>(null);
  const pendingKey = useRef<string | null>(params.get('book'));
  const openOnReady = useRef(params.get('open') === '1');

  const [data, setData] = useState<Bookcase | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [noWebgl, setNoWebgl] = useState(false);
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<SceneMode>('browse');
  const [sort, setSort] = useState<Sort>(() => {
    try {
      const saved = localStorage.getItem('pb.shelfSort');
      return saved === 'az' || saved === 'popular' ? saved : 'recent';
    } catch {
      return 'recent';
    }
  });
  const [filter, setFilter] = useState<Filter>('all');
  const [fellows, setFellows] = useState<Record<string, FellowReader[] | 'loading'>>({});
  // The book held up, as the shared library knows it: its PowerBook and world ratings.
  const [works, setWorks] = useState<Record<string, Work | 'loading' | 'missing'>>({});

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<BookcaseBook | null>(null);
  const [askRights, setAskRights] = useState(false);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState('');
  const [manualAuthor, setManualAuthor] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const isSelf = !!data?.is_self;
  // The reader's own library (not someone else's shelf): the way into the reading room is there even before the
  // shelf has loaded or when it has nothing on it yet
  const ownLibrary = !ownerId;
  // One long shelf, or the bookcase: the reader's shelves stacked by theme.
  const [view, setView] = useState<'shelf' | 'sections'>(() => {
    try {
      return localStorage.getItem('pb.shelfView') === 'sections' ? 'sections' : 'shelf';
    } catch {
      return 'shelf';
    }
  });
  const [shelvesOpen, setShelvesOpen] = useState(false);
  const changeView = useCallback((next: 'shelf' | 'sections') => {
    setView(next);
    try {
      localStorage.setItem('pb.shelfView', next);
    } catch {
      // storage blocked: the choice lasts for this visit
    }
  }, []);
  const shelves = useMemo(() => data?.shelves ?? [], [data]);
  const setShelves = useCallback((next: CustomShelf[], removedId?: string) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            shelves: next,
            books: removedId ? prev.books.map((b) => (b.shelf_id === removedId ? { ...b, shelf_id: null } : b)) : prev.books,
          }
        : prev
    );
  }, []);
  const placeBook = useCallback(async (key: string, shelfId: string | null) => {
    let before: string | null | undefined;
    setData((prev) => {
      if (!prev) return prev;
      before = prev.books.find((b) => b.key === key)?.shelf_id;
      return { ...prev, books: prev.books.map((b) => (b.key === key ? { ...b, shelf_id: shelfId } : b)) };
    });
    const { error } = await apiPut(`/library/placements/${encodeURIComponent(key)}`, { shelf_id: shelfId }, { requireAuth: true });
    if (error) {
      // Put it back where it was; the shelf never moved.
      setData((prev) => (prev ? { ...prev, books: prev.books.map((b) => (b.key === key ? { ...b, shelf_id: before ?? null } : b)) } : prev));
      const text = t('shelf.editError');
      setNotice(text);
      window.setTimeout(() => setNotice((n) => (n === text ? null : n)), 4200);
    }
  }, [t]);

  const theme = useResolvedTheme();
  useEffect(() => {
    sceneRef.current?.setLook(theme);
  }, [theme]);
  const setNotes = useCallback((key: string, notes: BookNote[]) => {
    setData((prev) => (prev ? { ...prev, books: prev.books.map((b) => (b.key === key ? { ...b, notes } : b)) } : prev));
  }, []);
  const siteHeaderRef = useRef<HTMLDivElement>(null);
  const headerRowRef = useRef<HTMLElement>(null);
  const captionRef = useRef<HTMLElement>(null);

  // The room is fixed to the viewport; it starts under the site header,
  // whatever height the header has on this screen. The phone header can hang
  // a one-off menu hint below itself, so the lowest edge of anything in it counts.
  useEffect(() => {
    const el = siteHeaderRef.current;
    if (!el) return;
    const root = document.documentElement;
    const apply = () => {
      const top = el.getBoundingClientRect().top;
      let bottom = el.getBoundingClientRect().bottom;
      el.querySelectorAll('*').forEach((node) => {
        const r = node.getBoundingClientRect();
        if (r.height > 0) bottom = Math.max(bottom, r.bottom);
      });
      root.style.setProperty('--shelf-top', `${Math.round(bottom - top)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    const mo = new MutationObserver(apply);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      root.style.removeProperty('--shelf-top');
    };
  }, []);
  const inspecting = mode !== 'browse';

  // ---------- page chrome ----------

  useEffect(() => {
    // The page behind the canvas takes the site's colour (theme.css); the
    // browser bar is already set by the theme switcher.
    document.documentElement.classList.add('pb-paper-room');

    if (!document.querySelector('link[data-shelf-fonts]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = FONTS_HREF;
      link.dataset.shelfFonts = '1';
      document.head.appendChild(link);
    }
    let cancelled = false;
    loadShelfFonts().finally(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
      document.documentElement.classList.remove('pb-paper-room');
    };
  }, []);

  // ---------- data ----------

  const load = useCallback(async () => {
    const { data: next } = await apiGet<Bookcase>(ownerId ? `/library/bookcase/${ownerId}` : '/library/bookcase', {
      requireAuth: true,
    });
    if (next) {
      setData(next);
      setLoadError(false);
    } else {
      setLoadError(true);
    }
  }, [ownerId]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const hasFiles = !!data?.books.some((b) => b.has_file);
  const effectiveFilter: Filter = hasFiles ? filter : 'all';

  const books = useMemo(() => {
    if (!data) return [];
    const collator = new Intl.Collator(INTL[locale], { sensitivity: 'base', numeric: true });
    let list = data.books.slice();
    if (effectiveFilter === 'files') list = list.filter((b) => b.has_file);
    if (sort === 'az') list.sort((a, b) => collator.compare(a.title, b.title));
    else if (sort === 'popular') list.sort((a, b) => b.fellow_readers - a.fellow_readers || collator.compare(a.title, b.title));
    // "recent" is the order the server already sends.
    return list;
  }, [data, sort, effectiveFilter, locale]);

  const current: BookcaseBook | undefined = books[Math.min(active, Math.max(0, books.length - 1))];

  // ---------- words painted onto the books ----------

  const statusLine = useCallback(
    (b: BookcaseBook): string => {
      if (b.status === 'reading') {
        return t(isSelf ? 'shelf.statusReading' : 'shelf.statusReadingOther', { percent: b.progress_percent });
      }
      if (b.status === 'unread') return t('shelf.statusUnread');
      if (b.source === 'manual') {
        return b.finished_on ? `${t('shelf.statusManual')} · ${b.finished_on.slice(0, 4)}` : t('shelf.statusManual');
      }
      if (b.round_year && b.round_month) {
        return t('shelf.statusFinishedIn', { month: `${MONTHS[locale][b.round_month - 1]} ${b.round_year}` });
      }
      return t('shelf.statusFinished');
    },
    [t, locale, isSelf]
  );

  const volumes: SceneVolume[] = useMemo(
    () =>
      books.map((b) => {
        let mark = 'PB';
        let imprint = 'PowerBook';
        if (b.round_year && b.round_month) {
          mark = `${String(b.round_month).padStart(2, '0')}·${String(b.round_year).slice(2)}`;
          imprint = `PowerBook · ${MONTHS[locale][b.round_month - 1]} ${b.round_year}`;
        } else if (b.finished_on) {
          mark = b.finished_on.slice(0, 4);
        } else if (b.file_format) {
          mark = b.file_format.toUpperCase();
        }
        const finished = formatDate(b.finished_on, locale);
        const art: VolumeArt = {
          key: b.key,
          seed: seedOf(b),
          title: b.title,
          author: b.author,
          imprint,
          spineMark: mark,
          back: b.note,
          backCaption: finished ? t('shelf.backFinished', { date: finished }) : t('shelf.tagline'),
          tagline: t('shelf.tagline'),
          // The file's own cover wins over one found online.
          coverImage: b.cover_data ?? (b.cover_url ? `${getApiBaseUrl()}${b.cover_url}` : null),
          coverThumb: b.cover_data ?? (b.cover_thumb_url ? `${getApiBaseUrl()}${b.cover_thumb_url}` : null),
        };
        return { art, hasFile: b.has_file };
      }),
    [books, locale, t]
  );

  // From the bookcase to the book: back to the 3D shelf, held up in hand.
  const inspectFromSections = useCallback(
    (key: string) => {
      const index = books.findIndex((b) => b.key === key);
      if (index < 0) return;
      changeView('shelf');
      setActive(index);
      window.setTimeout(() => {
        sceneRef.current?.browseTo(index, true);
        sceneRef.current?.focus(index);
      }, 80);
    },
    [books, changeView]
  );

  // The bookcase view starts under the header row, whatever height it has.
  useEffect(() => {
    const head = headerRowRef.current;
    const room = head?.parentElement;
    if (!head || !room) return;
    const apply = () =>
      room.style.setProperty('--sections-top', `${Math.round(head.getBoundingClientRect().bottom - room.getBoundingClientRect().top + 6)}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(head);
    ro.observe(room);
    return () => ro.disconnect();
  }, []);

  // ---------- the scene ----------

  const activeKey = useRef<string | null>(null);
  // What the scene currently shows, to tell a re-sort (rebuild) from an
  // edit to one book (repaint that book in place).
  const shownKeys = useRef('');
  const shownArt = useRef<string[]>([]);
  useEffect(() => {
    if (current) activeKey.current = current.key;
  }, [current]);

  useEffect(() => {
    if (!fontsReady || !data || noWebgl) return;
    if (!sceneRef.current && books.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const wanted = pendingKey.current ?? activeKey.current;
    let start = 0;
    if (wanted) {
      start = Math.max(0, findBook(books, wanted));
    }
    pendingKey.current = null;

    const keys = volumes.map((v) => v.art.key).join('|');
    const art = volumes.map((v) => JSON.stringify(v));
    if (sceneRef.current) {
      if (keys === shownKeys.current) {
        art.forEach((a, i) => {
          if (a !== shownArt.current[i]) sceneRef.current?.updateVolume(i, volumes[i]);
        });
      } else {
        sceneRef.current.setVolumes(volumes, start);
      }
      shownKeys.current = keys;
      shownArt.current = art;
      return;
    }

    let cancelled = false;
    import('./BookcaseScene')
      .then(({ BookcaseScene: Scene }) => {
        if (cancelled) return;
        try {
          sceneRef.current = new Scene(
            canvas,
            volumes,
            {
              onActive: setActive,
              onMode: setMode,
              onReady: () => {
                setSceneReady(true);
                // Arrow keys should browse straight away, without a click first.
                if (document.activeElement === document.body) canvas.focus({ preventScroll: true });
                if (openOnReady.current) {
                  openOnReady.current = false;
                  window.setTimeout(() => sceneRef.current?.focus(), 350);
                }
              },
              onContextLost: () => setNoWebgl(true),
              focusArea: () => {
                const w = canvas.clientWidth;
                const h = canvas.clientHeight;
                const panel = detailsRef.current;
                const canvasTop = canvas.getBoundingClientRect().top;
                const top = (brandRef.current ? brandRef.current.getBoundingClientRect().bottom - canvasTop : 56) + 12;
                // offsetTop/offsetLeft ignore the panel's slide-in transform,
                // so this is where it will be, not where it is mid-animation.
                // The sheet fades in over the last 40px above its edge.
                // On a phone the header row hides while a book is held up.
                if (w < 760) return { left: 0, right: w, top: 12, bottom: panel ? panel.offsetTop - 40 : h * 0.5 };
                return { left: 0, right: panel ? panel.offsetLeft : w * 0.6, top: top + 10, bottom: h - 24 };
              },
            },
            start
          );
          setActive(start);
          shownKeys.current = keys;
          shownArt.current = art;
        } catch {
          setNoWebgl(true);
        }
      })
      .catch(() => setNoWebgl(true));
    return () => {
      cancelled = true;
    };
    // `books` is read only for the start index; `volumes` carries its changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsReady, data, volumes, noWebgl]);

  useEffect(
    () => () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (!inspecting) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      if (e.key === 'Escape' && !typing) sceneRef.current?.returnToShelf();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inspecting]);

  // Who else read the book being looked at — fetched once it is opened.
  useEffect(() => {
    if (!inspecting || !current || !data || !current.match_key || current.fellow_readers === 0) return;
    const key = current.match_key;
    if (fellows[key]) return;
    setFellows((f) => ({ ...f, [key]: 'loading' }));
    apiGet<FellowReader[]>(
      `/library/fellow-readers?key=${encodeURIComponent(key)}&owner_id=${data.owner.user_id}`,
      { requireAuth: true }
    ).then(({ data: list }) => setFellows((f) => ({ ...f, [key]: list ?? [] })));
  }, [inspecting, current, data, fellows]);

  useEffect(() => {
    if (!inspecting || !current?.match_key) return;
    const key = current.match_key;
    if (works[key]) return;
    setWorks((w) => ({ ...w, [key]: 'loading' }));
    apiGet<Work>(`/books/work/${encodeURIComponent(key)}?locale=${locale}`, { requireAuth: true }).then(({ data: work }) =>
      setWorks((w) => ({ ...w, [key]: work ?? 'missing' }))
    );
  }, [inspecting, current, works, locale]);

  const setMark = useCallback((key: string, review: { id: string; rating: number; text: string | null } | null) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            books: prev.books.map((b) =>
              b.key === key ? { ...b, rating: review?.rating ?? null, review: review?.text ?? null, review_id: review?.id ?? null } : b
            ),
          }
        : prev
    );
    // The book's ratings changed; ask again next time it is held up.
    setWorks((w) => {
      const next = { ...w };
      const book = data?.books.find((b) => b.key === key);
      if (book?.match_key) delete next[book.match_key];
      return next;
    });
  }, [data]);

  const changeSort = (next: Sort) => {
    if (next === sort || inspecting) return;
    setSort(next);
    try {
      localStorage.setItem('pb.shelfSort', next);
    } catch {
      // Private mode: the order just isn't remembered.
    }
  };

  // ---------- adding books ----------

  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((n) => (n === text ? null : n)), 4200);
  };

  const rightsOk = () => {
    try {
      return localStorage.getItem('pb.libraryRightsAck') === '1';
    } catch {
      return false;
    }
  };

  const openAdd = () => {
    setAddOpen(true);
    setManualError(null);
    apiGet<LibraryStats>('/library/stats', { requireAuth: true }).then(({ data: s }) => s && setStats(s));
  };

  const chooseFile = (title: string | null) => {
    uploadTitle.current = title;
    if (!rightsOk()) {
      setAskRights(true);
      setAddOpen(true);
      return;
    }
    fileInput.current?.click();
  };

  const acceptRights = () => {
    try {
      localStorage.setItem('pb.libraryRightsAck', '1');
    } catch {
      // Asked again next time; nothing else depends on it.
    }
    setAskRights(false);
    fileInput.current?.click();
  };

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Checked here rather than with the input's accept attribute: iOS refuses
    // to open the picker for some accept values, epub's among them.
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'pdf' && ext !== 'epub') {
      flash(t('library.wrongFormat'));
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setAddOpen(false);
    setUploadPct(0);

    const form = new FormData();
    form.append('file', file);
    // Uploading "the text of" a finished book keeps its shelf title, so the
    // server files the two as one volume.
    form.append('title', uploadTitle.current ?? file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '));

    const { data: created, error } = await apiUploadWithProgress<LibraryBook>('/library/books', form, setUploadPct);
    if (error || !created) {
      flash(t(error ?? 'error.validation'));
    } else {
      const cover = await extractCover(file);
      if (cover) await apiPatch(`/library/books/${created.id}`, { cover_data: cover }, { requireAuth: true });
      pendingKey.current = uploadTitle.current ?? created.title;
      await load();
      flash(t('shelf.uploaded'));
    }
    uploadTitle.current = null;
    setUploadPct(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const onAddManual = async (e: FormEvent) => {
    e.preventDefault();
    const title = manualTitle.trim();
    if (!title) {
      setManualError(t('profile.bookEmptyTitle'));
      return;
    }
    setManualBusy(true);
    const { data: created, error } = await apiPost<{ id: string; title: string }>(
      '/insights/books',
      { title, author: manualAuthor.trim() || null, finished_on: manualDate || null },
      { requireAuth: true }
    );
    setManualBusy(false);
    if (error || !created) {
      const known: Record<string, string> = {
        duplicate_round: 'profile.bookDuplicateRound',
        duplicate_manual: 'profile.bookDuplicateManual',
        empty_title: 'profile.bookEmptyTitle',
      };
      setManualError(t(known[error ?? ''] ?? 'error.validation'));
      return;
    }
    setManualTitle('');
    setManualAuthor('');
    setManualDate('');
    setAddOpen(false);
    pendingKey.current = `m:${created.id}`;
    setSort('recent');
    await load();
    flash(t('profile.bookAdded'));
  };

  // Kept apart from `data` on purpose: visibility changes nothing painted on
  // the book, and rebuilding the shelf would drop the reader out of the view.
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const isVisible = (b: BookcaseBook) => visibility[b.key] ?? !!b.is_visible_to_buddies;

  const toggleVisible = async (b: BookcaseBook) => {
    if (!b.upload_id) return;
    const next = !isVisible(b);
    const { error } = await apiPatch(`/library/books/${b.upload_id}`, { is_visible_to_buddies: next }, { requireAuth: true });
    if (!error) setVisibility((v) => ({ ...v, [b.key]: next }));
  };

  const deleteFile = async (b: BookcaseBook) => {
    if (!b.upload_id || !window.confirm(t('shelf.confirmDeleteFile', { title: b.title }))) return;
    await apiDelete(`/library/books/${b.upload_id}`, { requireAuth: true });
    sceneRef.current?.returnToShelf();
    pendingKey.current = b.source === 'upload' ? null : b.key;
    await load();
  };

  const removeManual = async (b: BookcaseBook) => {
    if (!b.manual_id || !window.confirm(t('shelf.confirmRemoveManual', { title: b.title }))) return;
    await apiDelete(`/insights/books/${b.manual_id}`, { requireAuth: true });
    sceneRef.current?.returnToShelf();
    await load();
  };

  // ---------- render ----------

  const ownerName = data?.owner.display_name ?? '';
  const count = books.length;
  const countLabel = bookCount(locale, count, t);
  const fellowsLabel = (n: number) =>
    plural(locale, n, {
      one: t('shelf.fellows.one', { n }),
      few: t('shelf.fellows.few', { n }),
      many: t('shelf.fellows.many', { n }),
    });
  const titleClass = (title: string) =>
    title.length > 48 ? styles.titleLong : title.length > 22 ? styles.titleMedium : '';

  const empty = !!data && data.books.length === 0;
  const showScene = !!data && !noWebgl && !empty;
  const fellowList = current?.match_key ? fellows[current.match_key] : undefined;

  // Phones: tell the shelf how much room is left between the header row and
  // the caption, so it frames the books there instead of under the caption.
  useEffect(() => {
    const canvas = canvasRef.current;
    const head = headerRowRef.current;
    const caption = captionRef.current;
    if (!sceneReady || !showScene || !canvas || !head || !caption) return;
    const push = () => {
      const top = canvas.getBoundingClientRect().top;
      // Measured from the caption's bottom edge, which stays put, with room
      // kept for its tallest form (a two-line title). Its top edge moves with
      // every book, and following it made the shelf zoom in and out.
      sceneRef.current?.setBrowseArea(head.getBoundingClientRect().bottom - top + 8, caption.getBoundingClientRect().bottom - top - CAPTION_ROOM);
    };
    push();
    const ro = new ResizeObserver(push);
    [canvas, head].forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [sceneReady, showScene]);

  return (
    <>
    <div ref={siteHeaderRef}>
      <Header />
    </div>
    <main
      className={[
        styles.room,
        sceneReady || empty || noWebgl || loadError ? styles.isReady : '',
        inspecting ? styles.isFocused : styles.isBrowsing,
        view === 'sections' && !empty ? styles.isSections : '',
      ].join(' ')}
    >
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="application"
        tabIndex={0}
        aria-label={t('shelf.canvasLabel', { n: count })}
        hidden={!showScene}
      />

      <header className={styles.header} ref={headerRowRef}>
        <div className={styles.brand} ref={brandRef}>
          {ownerId && (
            <Link className={styles.homeLink} to={`/readers/${ownerId}`}>
              <span aria-hidden="true">←</span>
              <span>{t('shelf.backToProfile')}</span>
            </Link>
          )}
          <span className={styles.wordmark}>
            {ownerId && !isSelf ? t('shelf.wordmarkOf', { name: ownerName }) : t('shelf.wordmarkSelf')}
          </span>
        </div>
        <div className={styles.actions}>
          {!empty && (
            <div className={styles.segment} role="group" aria-label={t('shelf.viewLabel')}>
              {(['shelf', 'sections'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={view === v} disabled={inspecting} onClick={() => changeView(v)}>
                  {t(v === 'shelf' ? 'shelf.viewShelf' : 'shelf.viewSections')}
                </button>
              ))}
            </div>
          )}
          {hasFiles && (
            <div className={styles.segment} role="group" aria-label={t('shelf.filterLabel')}>
              {(['all', 'files'] as Filter[]).map((f) => (
                <button key={f} type="button" aria-pressed={effectiveFilter === f} disabled={inspecting} onClick={() => setFilter(f)}>
                  {t(f === 'all' ? 'shelf.filterAll' : 'shelf.filterFiles')}
                </button>
              ))}
            </div>
          )}
          {!empty && (
          <div className={styles.segment} role="group" aria-label={t('shelf.sort')}>
            <span className={styles.segmentLabel}>{t('shelf.sort')}</span>
            {(['recent', 'az', 'popular'] as Sort[]).map((s) => (
              <button key={s} type="button" aria-pressed={sort === s} disabled={inspecting} onClick={() => changeSort(s)}>
                {t(s === 'recent' ? 'shelf.sortRecent' : s === 'az' ? 'shelf.sortAz' : 'shelf.sortPopular')}
              </button>
            ))}
          </div>
          )}
          {(isSelf || ownLibrary) && (
            <Link className={styles.hallLink} to="/library/hall">
              <i className={styles.hallDot} aria-hidden="true" />
              {t('room.enterLibrary')}
            </Link>
          )}
          {(isSelf || ownLibrary) && (
            <Link className={styles.hallLink} to="/books">
              {t('libtabs.books')}
            </Link>
          )}
          {(isSelf || ownLibrary) && (
            <Link className={styles.hallLink} to="/market">
              {t('libtabs.market')}
            </Link>
          )}
          {isSelf && (
            <button
              type="button"
              className={`${styles.addButton} ${styles.headerAdd}`}
              onClick={openAdd}
              disabled={inspecting || uploadPct !== null}
              aria-label={t('shelf.add')}
            >
              <span aria-hidden="true">+</span>
              <span className={styles.addLabel}>{t('shelf.add')}</span>
            </button>
          )}
        </div>
      </header>

      {data && !empty && view === 'sections' && (
        <BookcaseSections
          books={books}
          volumes={volumes}
          shelves={shelves}
          isSelf={isSelf}
          onInspect={inspectFromSections}
          onPlace={placeBook}
          onManage={() => setShelvesOpen(true)}
        />
      )}

      {showScene && current && (
        <>
          <section className={styles.caption} ref={captionRef} aria-hidden={inspecting}>
            <p className={styles.kicker}>
              {current.has_file && <span className={styles.ribbonDot} aria-hidden="true" />}
              {statusLine(current)}
            </p>
            <h1 className={titleClass(current.title)}>{current.title}</h1>
            {current.author && <p className={styles.author}>{current.author}</p>}
            <div className={styles.captionActions}>
              <button type="button" className={styles.inspect} disabled={inspecting} onClick={() => sceneRef.current?.focus(active)}>
                <span>{t('shelf.inspect')}</span>
                <span aria-hidden="true">↗</span>
              </button>
              {isSelf && current.upload_id && (
                <Link className={`${styles.inspect} ${styles.inspectPrimary}`} to={`/library/${current.upload_id}`}>
                  <span>{current.progress_percent > 0 && current.progress_percent < 100 ? t('shelf.continue') : t('shelf.read')}</span>
                  <span aria-hidden="true">→</span>
                </Link>
              )}
            </div>
          </section>

          <button
            type="button"
            className={`${styles.arrow} ${styles.arrowPrev}`}
            aria-label={t('shelf.previous')}
            disabled={inspecting || active === 0}
            onClick={() => sceneRef.current?.browseBy(-1)}
          >
            <ArrowIcon direction="left" />
          </button>
          <button
            type="button"
            className={`${styles.arrow} ${styles.arrowNext}`}
            aria-label={t('shelf.next')}
            disabled={inspecting || active >= count - 1}
            onClick={() => sceneRef.current?.browseBy(1)}
          >
            <ArrowIcon direction="right" />
          </button>

          <nav className={styles.index} aria-label={t('shelf.indexLabel')}>
            <div className={styles.ticks} style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}>
              {books.map((b, i) => (
                <button
                  key={b.key}
                  type="button"
                  className={[i === active ? styles.tickActive : '', b.has_file ? styles.tickFile : ''].join(' ')}
                  aria-label={b.title}
                  aria-current={i === active ? 'true' : undefined}
                  disabled={inspecting}
                  onClick={() => sceneRef.current?.browseTo(i)}
                >
                  <span />
                </button>
              ))}
            </div>
            <div className={styles.hint} aria-hidden="true">
              <span>{countLabel}</span>
              <i />
              <span>{t('shelf.dragHint')}</span>
              <i />
              <span>{t('shelf.keysHint')}</span>
            </div>
          </nav>

          <aside ref={detailsRef} className={styles.details} aria-hidden={!inspecting} aria-label={current.title}>
            {inspecting && (
              <div className={styles.detailsInner}>
                <button type="button" className={styles.back} onClick={() => sceneRef.current?.returnToShelf()}>
                  <ArrowIcon direction="left" />
                  <span>{t('shelf.returnToShelf')}</span>
                </button>
                <div className={styles.position}>
                  <span>{String(active + 1).padStart(2, '0')}</span>
                  <span>{String(count).padStart(2, '0')}</span>
                </div>

                <div className={styles.copy}>
                  <p className={styles.eyebrow}>
                    {current.has_file && <span className={styles.ribbonDot} aria-hidden="true" />}
                    {statusLine(current)}
                  </p>
                  <h2>{current.title}</h2>
                  {current.author && <p className={styles.detailsAuthor}>{current.author}</p>}

                  <dl className={styles.facts}>
                    {current.finished_on && current.status === 'finished' && (
                      <div>
                        <dt>{t('shelf.factFinished')}</dt>
                        <dd>{formatDate(current.finished_on, locale)}</dd>
                      </div>
                    )}
                    {current.times_finished > 1 && (
                      <div>
                        <dt>{t('shelf.factTimes')}</dt>
                        <dd>{current.times_finished}</dd>
                      </div>
                    )}
                    {current.has_file && current.file_format && (
                      <div>
                        <dt>{t('shelf.factFile')}</dt>
                        <dd>
                          {current.file_format.toUpperCase()}
                          {current.file_size ? ` · ${formatSize(current.file_size)}` : ''}
                        </dd>
                      </div>
                    )}
                    {current.has_file && current.progress_percent > 0 && current.progress_percent < 100 && (
                      <div className={styles.progressFact}>
                        <dt>{t('shelf.factProgress')}</dt>
                        <dd>
                          <span className={styles.progressTrack}>
                            <span style={{ width: `${current.progress_percent}%` }} />
                          </span>
                          {current.progress_percent}%
                        </dd>
                      </div>
                    )}
                  </dl>

                  {isSelf && shelves.length > 0 && (
                    <label className={styles.shelfPick}>
                      <span>{t('shelf.shelfOf')}</span>
                      <select
                        className={styles.field}
                        value={current.shelf_id && shelves.some((sh) => sh.id === current.shelf_id) ? current.shelf_id : ''}
                        onChange={(e) => placeBook(current.key, e.target.value || null)}
                      >
                        <option value="">{t('shelf.unsorted')}</option>
                        {shelves.map((sh) => (
                          <option key={sh.id} value={sh.id}>
                            {sh.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {current.note && (
                    <blockquote>
                      <p>{current.note}</p>
                      <cite>
                        {t('shelf.noteCite')}
                        {current.note_is_private && ` · ${t('shelf.notePrivate')}`}
                      </cite>
                    </blockquote>
                  )}

                  {(() => {
                    const work = current.match_key ? works[current.match_key] : undefined;
                    if (!work || work === 'loading' || work === 'missing') return null;
                    return (
                      <Link className={styles.libraryLine} to={`/books?book=${encodeURIComponent(work.key)}`}>
                        <span>{t('shelf.inLibrary')}</span>
                        {work.pb_rating !== null && <PbBadge value={work.pb_rating} />}
                        {work.ext_rating !== null && <ExtBadge rating={work.ext_rating} source={work.ext_source} />}
                        <span aria-hidden="true">→</span>
                      </Link>
                    );
                  })()}

                  {isSelf && (
                    <MarkForm
                      volumeKey={current.key}
                      rating={current.rating ?? null}
                      text={current.review ?? null}
                      reviewId={current.review_id ?? null}
                      onSaved={(review) => setMark(current.key, review)}
                    />
                  )}
                  {!isSelf && current.rating != null && (
                    <blockquote>
                      <p>
                        <PbBadge value={current.rating} />
                        {current.review ? ` ${current.review}` : ''}
                      </p>
                      <cite>{t('shelf.ownerMark')}</cite>
                    </blockquote>
                  )}

                  {isSelf && <BookNotes book={current} locale={locale} onNotes={setNotes} />}
                  {isSelf && ((current.notes?.length ?? 0) > 0 || current.note) && (
                    <Link className={styles.editLink} to={`/reading?tab=notes&book=${encodeURIComponent(current.key)}`}>
                      ✦ {t('shelf.aiNotes')}
                    </Link>
                  )}

                  <div className={styles.fellows}>
                    <p className={styles.fellowsLine}>
                      {current.fellow_readers > 0
                        ? fellowsLabel(current.fellow_readers)
                        : t(isSelf ? 'shelf.fellowsNoneSelf' : 'shelf.fellowsNone')}
                    </p>
                    {Array.isArray(fellowList) && fellowList.length > 0 && (
                      <ul className={styles.fellowList}>
                        {fellowList.slice(0, 12).map((r) => (
                          <li key={r.user_id}>
                            <Link to={`/readers/${r.user_id}`} title={r.display_name}>
                              <Avatar src={r.avatar_data} name={r.display_name} size="sm" />
                              <span>{r.is_viewer ? t('shelf.you') : r.display_name}</span>
                            </Link>
                          </li>
                        ))}
                        {fellowList.length > 12 && <li className={styles.fellowMore}>+{fellowList.length - 12}</li>}
                      </ul>
                    )}
                  </div>

                  {current.source_url && (
                    <a className={styles.sourceLink} href={current.source_url} target="_blank" rel="noopener noreferrer">
                      <span>{t('shelf.sourceGoogle')}</span>
                      <span aria-hidden="true">↗</span>
                    </a>
                  )}

                  {isSelf && current.upload_id && (
                    <Link className={styles.primaryLink} to={`/library/${current.upload_id}`}>
                      <span>{t('shelf.openBook')}</span>
                      <span aria-hidden="true">↗</span>
                    </Link>
                  )}
                  {isSelf && !current.has_file && (
                    <button type="button" className={styles.primaryLink} onClick={() => chooseFile(current.title)} disabled={uploadPct !== null}>
                      <span>{t('shelf.attachFile')}</span>
                      <span aria-hidden="true">↑</span>
                    </button>
                  )}
                  {isSelf && !current.has_file && <p className={styles.primaryHint}>{t('shelf.attachHint')}</p>}

                  {isSelf && current.status === 'finished' && (
                    <Link
                      className={styles.editLink}
                      to={`/market?sell=${encodeURIComponent(current.key)}&title=${encodeURIComponent(current.title)}${current.author ? `&author=${encodeURIComponent(current.author)}` : ''}`}
                    >
                      ₸ {t('mkt.sellFromShelf')}
                    </Link>
                  )}

                  {isSelf && (
                    <button type="button" className={styles.editLink} onClick={() => setEditing(current)}>
                      {t('shelf.edit')}
                    </button>
                  )}

                  {isSelf && (current.upload_id || current.manual_id) && (
                    <div className={styles.quiet}>
                      {current.upload_id && (
                        <button type="button" onClick={() => toggleVisible(current)}>
                          {isVisible(current) ? t('library.hideFromBuddies') : t('library.showToBuddies')}
                        </button>
                      )}
                      {current.upload_id && (
                        <button type="button" onClick={() => deleteFile(current)}>
                          {t('shelf.deleteFile')}
                        </button>
                      )}
                      {current.manual_id && (
                        <button type="button" onClick={() => removeManual(current)}>
                          {t('shelf.removeManual')}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className={styles.focusControls}>
                  <span>{t('shelf.orbitHint')}</span>
                  <span>{t('shelf.zoomHint')}</span>
                  <button type="button" onClick={() => sceneRef.current?.resetView()}>
                    {t('shelf.resetView')}
                  </button>
                </div>
              </div>
            )}
          </aside>

          <div className={styles.srOnly} aria-live="polite">
            {inspecting ? t('shelf.inspecting', { title: current.title }) : t('shelf.selected', { title: current.title })}
          </div>
        </>
      )}

      {empty && (
        <section className={styles.emptyState}>
          <div className={styles.emptyMark} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h1>{t('shelf.emptyTitle')}</h1>
          <p>{isSelf ? t('shelf.emptySelfText') : t('shelf.emptyOtherText', { name: ownerName })}</p>
          {isSelf && (
            <div className={styles.emptyActions}>
              <button type="button" className={styles.addButton} onClick={openAdd}>
                <span aria-hidden="true">+</span> {t('shelf.add')}
              </button>
              {/* no books of your own yet: you can still read with everyone in the reading room */}
              <Link className={`${styles.hallLink} ${styles.hallLinkBig}`} to="/library/hall">
                <i className={styles.hallDot} aria-hidden="true" />
                {t('room.enterLibrary')}
              </Link>
            </div>
          )}
        </section>
      )}

      {noWebgl && data && !empty && (
        <section className={styles.fallback}>
          <p className={styles.eyebrow}>{t('shelf.noWebgl')}</p>
          <ol>
            {books.map((b) => (
              <li key={b.key}>
                <span className={styles.fallbackTitle}>{b.title}</span>
                {b.author && <span className={styles.fallbackAuthor}>{b.author}</span>}
                <span className={styles.fallbackMeta}>{statusLine(b)}</span>
                {isSelf && b.upload_id && (
                  <Link to={`/library/${b.upload_id}`} className={styles.fallbackRead}>
                    {t('shelf.read')} →
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {loadError && !data && (
        <section className={styles.emptyState}>
          <h1>{t('shelf.loadError')}</h1>
          <div className={styles.emptyActions}>
            <button type="button" className={styles.addButton} onClick={() => load()}>
              {t('shelf.retry')}
            </button>
            {ownLibrary && (
              <Link className={`${styles.hallLink} ${styles.hallLinkBig}`} to="/library/hall">
                <i className={styles.hallDot} aria-hidden="true" />
                {t('room.enterLibrary')}
              </Link>
            )}
          </div>
        </section>
      )}

      <div className={styles.loading} aria-hidden={sceneReady || empty || noWebgl || loadError}>
        <div className={styles.loadingMark}>
          <span />
          <span />
          <span />
        </div>
        <p>{data ? t('shelf.assembling', { count: countLabel }) : t('shelf.opening')}</p>
      </div>

      {uploadPct !== null && (
        <div className={styles.toast} role="status">
          <span>{t('shelf.uploading', { percent: uploadPct })}</span>
          <span className={styles.toastBar}>
            <span style={{ width: `${uploadPct}%` }} />
          </span>
        </div>
      )}
      {notice && uploadPct === null && (
        <div className={styles.toast} role="status">
          {notice}
        </div>
      )}

      {shelvesOpen && isSelf && (
        <ShelvesSheet shelves={shelves} onClose={() => setShelvesOpen(false)} onShelves={setShelves} />
      )}

      {addOpen && isSelf && (
        <div className={styles.sheetBackdrop} onClick={() => { setAddOpen(false); setAskRights(false); }}>
          <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={t('shelf.addTitle')} onClick={(e) => e.stopPropagation()}>
            <div className={styles.sheetHead}>
              <span className={styles.wordmark}>{t('shelf.addTitle')}</span>
              <button type="button" className={styles.sheetClose} onClick={() => { setAddOpen(false); setAskRights(false); }}>
                {t('shelf.close')}
              </button>
            </div>

            {askRights ? (
              <div className={styles.sheetSection}>
                <h3>{t('library.rightsTitle')}</h3>
                <p>{t('library.rightsText')}</p>
                <div className={styles.sheetRow}>
                  <button type="button" className={styles.ghostButton} onClick={() => setAskRights(false)}>
                    {t('library.rightsCancel')}
                  </button>
                  <button type="button" className={styles.addButton} onClick={acceptRights}>
                    {t('library.rightsAccept')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.sheetSection}>
                  <h3>{t('shelf.addUploadTitle')}</h3>
                  <p>{t('shelf.addUploadText')}</p>
                  <div className={styles.sheetRow}>
                    <button type="button" className={styles.addButton} onClick={() => chooseFile(null)}>
                      {t('shelf.addUploadCta')}
                    </button>
                    {stats && stats.storage_quota_bytes > 0 && (
                      <span className={styles.storage}>
                        {t('library.storageUsed', {
                          used: formatSize(stats.storage_used_bytes),
                          total: formatSize(stats.storage_quota_bytes),
                        })}
                      </span>
                    )}
                  </div>
                </div>

                <form className={styles.sheetSection} onSubmit={onAddManual}>
                  <h3>{t('shelf.addManualTitle')}</h3>
                  <p>{t('shelf.addManualText')}</p>
                  <input
                    className={styles.field}
                    value={manualTitle}
                    onChange={(e) => setManualTitle(e.target.value)}
                    placeholder={t('profile.bookTitlePlaceholder')}
                    maxLength={300}
                  />
                  <input
                    className={styles.field}
                    value={manualAuthor}
                    onChange={(e) => setManualAuthor(e.target.value)}
                    placeholder={t('profile.bookAuthorPlaceholder')}
                    maxLength={200}
                  />
                  <label className={styles.fieldLabel}>
                    <span>{t('shelf.dateLabel')}</span>
                    <input className={styles.field} type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
                  </label>
                  {manualError && <p className={styles.formError}>{manualError}</p>}
                  <div className={styles.sheetRow}>
                    <button type="submit" className={styles.addButton} disabled={manualBusy}>
                      {t('shelf.addManualCta')}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {editing && (
        <EditBookSheet
          book={editing}
          seed={seedOf(editing)}
          onClose={() => setEditing(null)}
          onChanged={async (message) => {
            await load();
            flash(message);
          }}
        />
      )}

      <input ref={fileInput} type="file" onChange={onPickFile} hidden />
    </main>
    </>
  );
}
