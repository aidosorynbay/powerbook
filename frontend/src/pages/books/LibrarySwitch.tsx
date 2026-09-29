import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '@/shared/lib';
import styles from './LibrarySwitch.module.css';

type Section = 'shelf' | 'books' | 'market' | 'hall' | 'reading';

// Set once the reader has opened the list: until then its chevron pulses, so
// nobody takes the title for a plain heading.
const SEEN_KEY = 'pb.libSwitchSeen';

function seenBefore(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

const SECTIONS: { key: Section; to: string; title: string; hint: string; group: 1 | 2 }[] = [
  { key: 'shelf', to: '/library', title: 'shelf.wordmarkSelf', hint: 'libswitch.shelfHint', group: 1 },
  { key: 'books', to: '/books', title: 'cat.title', hint: 'libswitch.booksHint', group: 1 },
  { key: 'market', to: '/market', title: 'mkt.title', hint: 'libswitch.marketHint', group: 1 },
  { key: 'hall', to: '/library/hall', title: 'room.enterLibrary', hint: 'libswitch.hallHint', group: 2 },
  { key: 'reading', to: '/reading', title: 'rd.title', hint: 'libswitch.readingHint', group: 2 },
];

/**
 * The library's title is also the way between its sections: "Моя библиотека ▾"
 * opens a list of the shared library, the market, the reading room and the recap.
 */
export function LibrarySwitch({ current, labelClass }: { current: Section; labelClass?: string }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(() => !seenBefore());
  const box = useRef<HTMLDivElement>(null);

  const toggle = () => {
    setOpen((o) => !o);
    if (hint) {
      setHint(false);
      try {
        localStorage.setItem(SEEN_KEY, '1');
      } catch {
        // storage blocked: the pulse stops for this visit
      }
    }
  };

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);

  const here = SECTIONS.find((s) => s.key === current) ?? SECTIONS[0];

  return (
    <div className={styles.switch} ref={box}>
      <button
        type="button"
        className={`${styles.trigger} ${labelClass ?? ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t(here.title)} — ${t('libswitch.label')}`}
        onClick={toggle}
      >
        <span className={styles.triggerText}>{t(here.title)}</span>
        <span className={`${styles.chev} ${open ? styles.chevOpen : ''} ${hint ? styles.chevHint : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className={styles.menu} role="menu" aria-label={t('libswitch.label')}>
          {SECTIONS.map((s, i) => (
            <div key={s.key}>
              {i > 0 && SECTIONS[i - 1].group !== s.group && <div className={styles.divider} role="separator" />}
              <Link
                to={s.to}
                role="menuitem"
                className={`${styles.item} ${s.key === current ? styles.itemCurrent : ''}`}
                aria-current={s.key === current ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                <span className={styles.itemText}>
                  <span className={styles.itemTitle}>{t(s.title)}</span>
                  <span className={styles.itemHint}>{t(s.hint)}</span>
                </span>
                {s.key === current && <span className={styles.check} aria-hidden="true">✓</span>}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
