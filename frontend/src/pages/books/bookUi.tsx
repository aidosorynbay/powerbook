import { KeyboardEvent as ReactKeyboardEvent, ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getApiBaseUrl, useI18n, type Locale } from '@/shared/lib';
import { paletteFor } from '../library/bookcase/bookArt';
import { plural } from '../library/bookcase/plural';
import styles from './Store.module.css';

export const INTL: Record<Locale, string> = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' };

/** Covers and photos are served by the API, from our own domain. */
export function apiUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith('data:') || path.startsWith('http') ? path : `${getApiBaseUrl()}${path}`;
}

/** Kinopoisk's colours: green for a good verdict, grey for middling, red for poor. */
export function markClass(value: number): string {
  if (value >= 7) return styles.pbGood;
  if (value >= 5) return styles.pbMid;
  return styles.pbBad;
}

export function PbBadge({ value, big = false }: { value: number; big?: boolean }) {
  return <span className={`${styles.pb} ${markClass(value)} ${big ? styles.pbBig : ''}`}>{value.toFixed(1)}</span>;
}

const SOURCE_SHORT: Record<string, string> = { goodreads: 'GR', livelib: 'LL', google: 'GB', openlibrary: 'OL' };

export function ExtBadge({ rating, source }: { rating: number; source: string | null }) {
  return (
    <span className={styles.ext} title={source ?? undefined}>
      <i aria-hidden="true">★</i>
      {rating.toFixed(1)}
      {source && <small> {SOURCE_SHORT[source] ?? ''}</small>}
    </span>
  );
}

/** A book's front: its real cover, or one painted in the colours the 3D shelf gives the same title. */
export function BookFace({ title, author, cover, children }: { title: string; author: string | null; cover: string | null; children?: ReactNode }) {
  const [broken, setBroken] = useState(false);
  const src = apiUrl(cover);
  const palette = paletteFor(title.trim().toLowerCase());
  return (
    <span className={styles.face}>
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span className={styles.painted} style={{ background: palette.cover, color: palette.ink }}>
          <span>
            <span className={styles.paintedRule} style={{ display: 'block', background: palette.accent }} />
            <span className={styles.paintedTitle}>{title}</span>
          </span>
          {author && <span className={styles.paintedAuthor}>{author}</span>}
        </span>
      )}
      {children}
    </span>
  );
}

export function formatPrice(price: number, locale: Locale, free: string): string {
  if (price <= 0) return free;
  return `${new Intl.NumberFormat(INTL[locale]).format(price)} ₸`;
}

export function formatDay(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(INTL[locale], { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s?г\.$/, '');
}

/** "12 оценок", "1 mark", "5 баға". */
export function useCount() {
  const { t, locale } = useI18n();
  return (key: 'votes' | 'reviews' | 'readers' | 'books', n: number) =>
    plural(locale, n, {
      one: t(`cat.${key}.one`, { n }),
      few: t(`cat.${key}.few`, { n }),
      many: t(`cat.${key}.many`, { n }),
    });
}

/** One to ten, as the circles have always written it. */
export function MarkPicker({ value, onChange, disabled }: { value: number | null; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <div className={styles.picker} role="radiogroup">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-pressed={value === n}
          className={value === n ? markClass(n) : ''}
          disabled={disabled}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** A panel from the right on wide screens, from the bottom on phones. */
export function Sheet({ label, onClose, wide, children }: { label: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      if (e.key === 'Escape' && !typing) onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);
  const escapeFromField = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') (e.target as HTMLElement).blur?.();
  };
  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div
        ref={panel}
        className={`${styles.sheet} ${wide ? styles.sheetWide : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={escapeFromField}
      >
        <div className={styles.sheetHead}>
          <strong>{label}</strong>
          <button type="button" className={styles.close} onClick={onClose}>
            {t('work.close')}
          </button>
        </div>
        <div className={styles.sheetBody}>{children}</div>
      </div>
    </>
  );
}

/** The library's sections, as one row of pills at the top of each. */
export function LibraryTabs() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const tabs = [
    { to: '/library', label: t('libtabs.shelf'), active: pathname === '/library' },
    { to: '/books', label: t('libtabs.books'), active: pathname.startsWith('/books') },
    { to: '/market', label: t('libtabs.market'), active: pathname.startsWith('/market') },
    { to: '/library/hall', label: t('room.enterLibrary'), active: pathname === '/library/hall', dot: true },
    { to: '/reading', label: t('libtabs.reading'), active: pathname.startsWith('/reading') },
  ];
  return (
    <nav className={styles.tabs} aria-label={t('libtabs.label')}>
      {tabs.map((tab) => (
        <Link key={tab.to} to={tab.to} className={`${styles.tab} ${tab.active ? styles.tabActive : ''}`} aria-current={tab.active ? 'page' : undefined}>
          {tab.dot && <i className={styles.tabDot} aria-hidden="true" />}
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The case: books face out, as many to a shelf as the width holds, each
 * shelf with its board and a label on the board's edge under every book.
 */
export function Shelves<T>({
  items,
  keyOf,
  face,
  label,
  onOpen,
}: {
  items: T[];
  keyOf: (item: T) => string;
  face: (item: T) => ReactNode;
  label: (item: T) => ReactNode;
  onOpen: (item: T) => void;
}) {
  const inner = useRef<HTMLDivElement>(null);
  const [perRow, setPerRow] = useState(6);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth - 28;
      const narrow = window.innerWidth < 600;
      const min = narrow ? 92 : 124;
      const gap = narrow ? 10 : 14;
      setPerRow(Math.max(2, Math.min(8, Math.floor((width + gap) / (min + gap)))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow));
  const columns = { gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` };

  return (
    <div className={styles.cabinet}>
      <div className={styles.cabinetInner} ref={inner}>
        {rows.map((row, r) => (
          <div className={styles.row} key={r}>
            <div className={styles.rowBooks} style={columns}>
              {row.map((item) => (
                <button key={keyOf(item)} type="button" className={styles.bookBtn} onClick={() => onOpen(item)}>
                  {face(item)}
                </button>
              ))}
            </div>
            <div className={styles.board} aria-hidden="true" />
            <div className={styles.rowLabels} style={columns}>
              {row.map((item) => (
                <div key={keyOf(item)} className={styles.label} onClick={() => onOpen(item)} aria-hidden="true">
                  {label(item)}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function useToast(): [string | null, (text: string) => void] {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number>();
  const show = (text: string) => {
    setToast(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3600);
  };
  return [toast, show];
}
