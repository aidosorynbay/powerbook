import { useEffect, useState } from 'react';
import { apiGet, getApiBaseUrl, useI18n } from '@/shared/lib';
import styles from './Store.module.css';

type PublicBook = { title: string; author: string | null; cover_url: string; minutes: number; readers: number };

/**
 * «Что сейчас читает круг»: this month's books with their minutes, on top of all books. It lived only on the
 * front page, which members no longer land on — and it is the warmest way into the shared library.
 */
export function CircleBooks() {
  const { t, locale } = useI18n();
  const [books, setBooks] = useState<PublicBook[]>([]);
  useEffect(() => {
    let alive = true;
    apiGet<PublicBook[]>('/stats/public/books').then(({ data }) => {
      if (alive && data) setBooks(data);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (books.length < 3) return null;
  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ru-RU');
  return (
    <section className={styles.circleBooks} aria-label={t('home.tr.books')}>
      <h2 className={styles.circleBooksTitle}>{t('home.tr.books')}</h2>
      <ul className={styles.circleBooksRow} tabIndex={0}>
        {books.map((b) => (
          <li key={b.title} className={styles.circleBook}>
            <img src={`${getApiBaseUrl()}${b.cover_url}`} alt="" loading="lazy" decoding="async" />
            <span className={styles.circleBookTitle}>{b.title}</span>
            <span className={styles.circleBookMeta}>
              {nf.format(b.minutes)} {t('home.room.min')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
