import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { apiGet, useI18n, type DayBook } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import styles from './ReadingBooks.module.css';

/** At most this many books in one day. */
const MAX_BOOKS = 5;

type Props = {
  books: DayBook[];
  onChange: (books: DayBook[]) => void;
  /** The day's minutes as typed, used when a second book splits them. */
  totalMinutes: number;
  /** A one-book day again: the remaining book's minutes become the total. */
  onTotalChange: (minutes: number) => void;
  /** The reader's current and recent books, offered first. */
  suggestions: string[];
};

type Match = { works: { title: string; author: string | null }[] };

/** Titles to offer as the reader types: their own books first, then the shared library's. */
function useTitleOptions(query: string, own: string[]): string[] {
  const [found, setFound] = useState<string[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFound([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      const { data } = await apiGet<Match>(`/books/match?q=${encodeURIComponent(q)}&editions=false`, { requireAuth: true });
      setFound((data?.works ?? []).map((w) => w.title));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  return useMemo(() => Array.from(new Set([...own, ...found])).slice(0, 12), [own, found]);
}

function TitleInput({
  value, onCommit, suggestions, placeholder, autoFocus,
}: {
  value: string;
  onCommit: (title: string) => void;
  suggestions: string[];
  placeholder: string;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const [text, setText] = useState(value);
  const options = useTitleOptions(text, suggestions);
  useEffect(() => setText(value), [value]);
  return (
    <>
      <input
        className={styles.input}
        value={text}
        list={listId}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={300}
        onChange={(e) => {
          setText(e.target.value);
          // A pick from the list is a whole title: take it at once.
          if (options.includes(e.target.value)) onCommit(e.target.value);
        }}
        onBlur={() => onCommit(text.trim())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit(text.trim());
          }
        }}
      />
      <datalist id={listId}>
        {options.map((o) => <option key={o} value={o} />)}
      </datalist>
    </>
  );
}

/**
 * «Что читаю» in the minutes form.
 *
 * One book is the usual day: it is filled in from the last time, shown with a
 * tick, and the minutes field stays the only thing to type. «+ ещё книга»
 * turns it into rows with their own minutes, for a day split between books.
 */
export function ReadingBooks({ books, onChange, totalMinutes, onTotalChange, suggestions }: Props) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const focusNew = useRef(false);
  const multi = books.length > 1;
  const own = suggestions.filter((s) => !books.some((b) => b.title === s));

  const setTitle = (i: number, title: string) => {
    if (!title) {
      if (i === 0 && books.length <= 1) onChange([]);
      return;
    }
    onChange(books.map((b, j) => (j === i ? { ...b, title } : b)));
  };

  const addBook = () => {
    focusNew.current = true;
    // The first book keeps the minutes typed so far; the new one starts at zero.
    const seeded = books.length === 1 ? [{ ...books[0], minutes: totalMinutes }] : books;
    onChange([...seeded, { title: '', minutes: 0, finished: false }]);
  };

  const removeBook = (i: number) => {
    const rest = books.filter((_, j) => j !== i);
    if (rest.length === 1) onTotalChange(rest[0].minutes);
    onChange(rest);
  };

  const sum = sumMinutes(books);

  return (
    <div className={styles.wrap}>
      <span className={styles.label}>{t('readingBooks.label')}</span>

      {!multi && (
        books[0] && !editing ? (
          <div className={styles.chosen}>
            <button type="button" className={styles.chip} onClick={() => setEditing(true)} title={t('readingBooks.change')}>
              <Icon name="check" size="em" className={styles.tick} aria-hidden="true" />
              <span className={styles.chipTitle}>{books[0].title}</span>
            </button>
            <button
              type="button"
              className={styles.remove}
              onClick={() => onChange([])}
              aria-label={t('readingBooks.remove')}
              title={t('readingBooks.remove')}
            >
              ×
            </button>
          </div>
        ) : (
          <TitleInput
            value={books[0]?.title ?? ''}
            suggestions={own}
            placeholder={t('readingBooks.placeholder')}
            autoFocus={editing}
            onCommit={(title) => {
              setEditing(false);
              if (!title) {
                onChange([]);
                return;
              }
              onChange([{ title, minutes: books[0]?.minutes ?? 0, finished: books[0]?.finished ?? false }]);
            }}
          />
        )
      )}

      {multi && (
        <div className={styles.rows}>
          {books.map((b, i) => (
            <div key={i} className={styles.row}>
              <div className={styles.rowTitle}>
                <TitleInput
                  value={b.title}
                  suggestions={own}
                  placeholder={t('readingBooks.placeholder')}
                  autoFocus={focusNew.current && i === books.length - 1 && !b.title}
                  onCommit={(title) => setTitle(i, title)}
                />
              </div>
              <input
                type="number"
                min="0"
                max="1440"
                inputMode="numeric"
                className={`${styles.input} ${styles.minutes}`}
                value={b.minutes ? String(b.minutes) : ''}
                placeholder="0"
                aria-label={t('readingBooks.minutesFor', { title: b.title || '…' })}
                onChange={(e) => onChange(books.map((x, j) => (j === i ? { ...x, minutes: Math.max(0, parseInt(e.target.value, 10) || 0) } : x)))}
              />
              <span className={styles.unit}>{t('readingBooks.min')}</span>
              <label className={styles.done} title={t('readingBooks.finished')}>
                <input
                  type="checkbox"
                  checked={b.finished}
                  onChange={(e) => onChange(books.map((x, j) => (j === i ? { ...x, finished: e.target.checked } : x)))}
                />
                <span>{t('readingBooks.finishedShort')}</span>
              </label>
              <button
                type="button"
                className={styles.remove}
                onClick={() => removeBook(i)}
                aria-label={t('readingBooks.remove')}
                title={t('readingBooks.remove')}
              >
                ×
              </button>
            </div>
          ))}
          <div className={styles.sum}>{t('readingBooks.total', { minutes: sum })}</div>
        </div>
      )}

      {books.length > 0 && books.length < MAX_BOOKS && (
        <button type="button" className={styles.add} onClick={addBook}>
          <Icon name="book" size="em" aria-hidden="true" />
          {t('readingBooks.addAnother')}
        </button>
      )}
    </div>
  );
}

/** The day's books as the API wants them, given the form's one-book fields. */
export function booksPayload(books: DayBook[], minutes: number, bookFinished: boolean): DayBook[] {
  if (books.length === 1) return [{ ...books[0], minutes, finished: bookFinished }];
  return books.filter((b) => b.title.trim());
}

export function sumMinutes(books: DayBook[]): number {
  return books.reduce((n, b) => n + (b.minutes || 0), 0);
}
