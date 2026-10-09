import { useEffect, useRef, useState } from 'react';
import { apiGet, track, useI18n, type BookFinish, type CalendarDay, type DayBook } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import { apiUrl } from '@/pages/books/bookUi';
import { BookDays } from '@/widgets/BookDays';
import styles from './FinishBook.module.css';

/** The book a minutes form marks finished: its title, its minutes that day,
 * and which «Что читаю» row it is (null: the title is the comment's first line). */
export type FinishedBook = { title: string; minutes: number; index: number | null };

export function finishedBook(books: DayBook[], bookFinished: boolean, comment: string, minutes: number): FinishedBook | null {
  if (books.length > 1) {
    const index = books.findIndex((b) => b.finished && b.title.trim());
    return index < 0 ? null : { title: books[index].title, minutes: books[index].minutes, index };
  }
  if (!bookFinished) return null;
  if (books[0]?.title.trim()) return { title: books[0].title, minutes, index: 0 };
  const first = comment.trim().split('\n', 1)[0].trim();
  return first ? { title: first, minutes, index: null } : null;
}

/** The title of the book a saved day finished, if it finished one. */
export function savedFinish(day: CalendarDay | null | undefined): string | null {
  if (!day?.book_finished) return null;
  return day.books?.find((b) => b.finished)?.title ?? (day.comment ?? '').trim().split('\n', 1)[0].trim() ?? null;
}

/** The form with the finished book's title as the shelf or the library has it. */
export function pickTitle(books: DayBook[], comment: string, book: FinishedBook, title: string): { books: DayBook[]; comment: string } {
  if (book.index !== null) {
    return { books: books.map((b, i) => (i === book.index ? { ...b, title } : b)), comment };
  }
  // The title was the comment's first line: it moves to «Что читаю», and the server puts it back on top.
  const rest = comment.trim().split('\n').slice(1).join('\n').trim();
  return { books: [{ title, minutes: 0, finished: true }], comment: rest };
}

/** «14 ч 20 мин». */
function formatMinutes(minutes: number, h: string, m: string): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} ${m}`;
  return rest ? `${hours} ${h} ${rest} ${m}` : `${hours} ${h}`;
}

type Props = {
  roundId: string;
  /** The day the book is finished on. */
  day: string;
  book: FinishedBook;
  /** The finished book's title as saved for this day, if the day is saved finished. */
  savedTitle?: string | null;
  /** The reader says it is this book of the shelf or the library. */
  onPick: (title: string) => void;
  /** The day the book was begun, to save with the finish. */
  onStart: (start: string | null) => void;
};

/**
 * Under «Книга прочитана»: which book this is, so that a book already on the
 * shelf or in the shared library is not made again under another spelling,
 * and how long it took, from the day the reader began it.
 */
export function FinishBook({ roundId, day, book, savedTitle, onPick, onStart }: Props) {
  const { t } = useI18n();
  const [found, setFound] = useState<BookFinish | null>(null);
  const [start, setStart] = useState<string | null>(null);
  // The title the reader said is a book of its own, not one of those offered.
  const [own, setOwn] = useState<string | null>(null);
  const [byDay, setByDay] = useState(false);
  // Days saved one by one: the time is asked again.
  const [version, setVersion] = useState(0);
  const ticket = useRef(0);
  const report = useRef(onStart);
  report.current = onStart;
  const title = book.title.trim();
  // This day is saved with this book finished: its days are kept as they are
  // (one by one, maybe) unless the reader moves the start.
  const saved = !!savedTitle && savedTitle.trim().toLowerCase() === title.toLowerCase();

  // Another book: its own period.
  useEffect(() => setStart(null), [title]);

  useEffect(() => {
    if (!title) return;
    const mine = ++ticket.current;
    const timer = window.setTimeout(async () => {
      const qs = new URLSearchParams({ title, day, minutes: String(book.minutes || 0) });
      if (start) qs.set('start', start);
      const { data } = await apiGet<BookFinish>(`/rounds/${roundId}/book_finish?${qs}`, { requireAuth: true });
      if (mine !== ticket.current || !data) return;
      setFound(data);
      report.current(saved && !start ? null : data.start);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [roundId, day, title, book.minutes, start, saved, version]);

  useEffect(() => () => report.current(null), []);

  if (!found) return null;
  const match = found.exact ? found.choices[0] : null;
  const asking = !found.exact && found.choices.length > 0 && own !== title;

  return (
    <div className={styles.finish}>
      {match && (
        <p className={styles.found}>
          <Icon name="check" size="em" aria-hidden="true" />
          <span>{match.on_shelf ? t('finish.onShelf', { title: match.title }) : t('finish.inLibrary', { title: match.title, n: match.readers })}</span>
        </p>
      )}

      {asking && (
        <div className={styles.ask}>
          <p>{t('finish.isIt')}</p>
          {found.choices.map((c) => (
            <button
              key={c.key}
              type="button"
              className={styles.choice}
              onClick={() => {
                track('finish_book_pick', { on_shelf: c.on_shelf });
                onPick(c.title);
              }}
            >
              {c.cover_thumb_url ? <img src={apiUrl(c.cover_thumb_url) ?? ''} alt="" loading="lazy" /> : <span className={styles.noCover} aria-hidden="true"><Icon name="book" size="em" /></span>}
              <span>
                <strong>{c.title}</strong>
                <small>{[c.author, c.on_shelf ? t('finish.yours') : t('finish.readers', { n: c.readers })].filter(Boolean).join(' · ')}</small>
              </span>
            </button>
          ))}
          <button type="button" className={styles.own} onClick={() => setOwn(title)}>
            {t('finish.another')}
          </button>
        </div>
      )}

      {!found.exact && !asking && <p className={styles.note}>{t('finish.newBook')}</p>}

      <div className={styles.time}>
        <span className={styles.label}>{t('finish.time')}</span>
        <strong>
          {found.minutes > 0
            ? t('shelf.factTimeDays', { time: formatMinutes(found.minutes, t('rings.hoursShort'), t('rings.minutesShort')), days: found.days })
            : t('finish.noTime')}
        </strong>
        <label className={styles.since}>
          <span>{t('finish.since')}</span>
          <input
            type="date"
            value={found.start}
            min={found.earliest}
            max={day}
            onChange={(e) => setStart(e.target.value || null)}
          />
        </label>
        <small className={styles.note}>{t('finish.howCounted')}</small>
        {found.shared_with.length > 0 && (
          <small className={styles.note}>{t('finish.shared', { titles: found.shared_with.map((x) => `«${x}»`).join(', ') })}</small>
        )}
        {saved ? (
          <button type="button" className={styles.byDay} onClick={() => setByDay(true)}>
            <Icon name="calendar" size="em" aria-hidden="true" />
            {t('finish.byDay')}
          </button>
        ) : (
          <small className={styles.note}>{t('finish.byDayLater')}</small>
        )}
      </div>
      {byDay && (
        <BookDays title={title} day={day} onClose={() => setByDay(false)} onSaved={() => setVersion((v) => v + 1)} />
      )}
    </div>
  );
}
