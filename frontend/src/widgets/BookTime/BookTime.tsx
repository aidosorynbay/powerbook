import { useState } from 'react';
import { formatSpent, useI18n, type BookcaseBook } from '@/shared/lib';
import { bookCount } from '@/pages/library/bookcase/plural';
import styles from './BookTime.module.css';

/** At first only this many books, the most read; «Все книги» shows the rest. */
const TOP = 5;

/** The minutes on a reader's shelf: what the books have had of their time, from the shelf's own minutes_read. */
export function shelfMinutes(books: BookcaseBook[]): number {
  return books.reduce((n, b) => n + (b.minutes_read ?? 0), 0);
}

/**
 * «Время на книгах»: how much of a reader's time each book on their shelf has had, every spelling of it, the reading
 * room and the reader counted (book_time.py). Open to anyone who opens the reader's library, as the founder asked; the
 * reader's own profile shows it too.
 */
export function BookTime({ books, isSelf }: { books: BookcaseBook[]; isSelf: boolean }) {
  const { t, locale } = useI18n();
  const [all, setAll] = useState(false);
  const read = books.filter((b) => (b.minutes_read ?? 0) > 0).sort((a, b) => (b.minutes_read ?? 0) - (a.minutes_read ?? 0));
  if (!read.length) return null;
  const total = shelfMinutes(read);
  const most = read[0].minutes_read ?? 1;
  // the book of the last days: one being read, the latest first
  const now = read
    .filter((b) => b.status === 'reading')
    .sort((a, b) => (b.shelved_on ?? '').localeCompare(a.shelved_on ?? ''))[0];
  const shown = all ? read : read.slice(0, TOP);

  return (
    <div className={styles.card}>
      <div className={styles.sum}>
        <span className={styles.big}>{formatSpent(total, t)}</span>
        <span className={styles.muted}>{bookCount(locale, read.length, t)}</span>
      </div>
      <div className={styles.muted}>{t('bookTime.from')}</div>

      {now && (
        <div className={styles.now}>
          <div className={styles.kicker}>{t(isSelf ? 'bookTime.nowSelf' : 'bookTime.nowOther')}</div>
          <div className={styles.nowTitle}>{now.title}</div>
          <div className={styles.muted}>
            {formatSpent(now.minutes_read ?? 0, t)}
            {(now.days_read ?? 0) > 0 && <> · {t('bookTime.days', { n: now.days_read ?? 0 })}</>}
          </div>
        </div>
      )}

      <ul className={styles.list}>
        {shown.map((b) => (
          <li key={b.key} className={styles.row}>
            <span className={styles.title}>
              {b.title}
              {b.status === 'finished' && <em className={styles.done}>{t('bookTime.done')}</em>}
            </span>
            <span className={styles.time}>{formatSpent(b.minutes_read ?? 0, t)}</span>
            <span className={styles.bar} aria-hidden="true">
              <i style={{ width: `${Math.max(3, Math.round(((b.minutes_read ?? 0) / most) * 100))}%` }} />
            </span>
          </li>
        ))}
      </ul>
      {read.length > TOP && (
        <button type="button" className={styles.more} onClick={() => setAll((v) => !v)}>
          {all ? t('bookTime.less') : t('bookTime.all', { n: read.length })}
        </button>
      )}
    </div>
  );
}
