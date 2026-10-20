import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiDelete, apiGet, useI18n, type WantBook } from '@/shared/lib';
import { Container } from '@/shared/ui';
import { Header } from '@/widgets';
import { LibraryTabs } from '@/widgets/SectionTabs';
import { BookFace, Shelves, useCount } from './bookUi';
import { WorkSheet } from './WorkSheet';
import styles from './Store.module.css';

/**
 * «Хочу прочитать», the second shelf (the founder, 2026-10-21): books to read later, added from the shared library.
 * They count nowhere — the read shelf and its count are built from read books alone — and a book leaves this shelf
 * by itself once it is read.
 */
export function WantPage() {
  const { t } = useI18n();
  const count = useCount();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<WantBook[] | null>(null);
  const [failed, setFailed] = useState(false);
  const openKey = params.get('book');

  const load = useCallback(async () => {
    const { data } = await apiGet<WantBook[]>('/library/want', { requireAuth: true });
    if (data) {
      setItems(data);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = (key: string | null) => {
    const next = new URLSearchParams(params);
    if (key) next.set('book', key);
    else next.delete('book');
    setParams(next, { replace: !key });
  };

  // a book that is not in the shared library has no card to open: it can only be taken off
  const remove = async (book: WantBook) => {
    if (!window.confirm(t('want.removeAsk', { title: book.title }))) return;
    await apiDelete(`/library/want/${book.id}`, { requireAuth: true });
    load();
  };

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <Container>
          <LibraryTabs />
          <div className={styles.head}>
            <div>
              <h1 className={styles.title}>{t('want.title')}</h1>
              <p className={styles.subtitle}>{t('want.subtitle')}</p>
              {items && items.length > 0 && <p className={styles.headStats}><span>{count('books', items.length)}</span></p>}
            </div>
          </div>

          {failed && !items ? (
            <div className={styles.state}>
              <p>{t('cat.loadError')}</p>
              <button type="button" className={styles.primary} onClick={load}>{t('cat.retry')}</button>
            </div>
          ) : !items ? (
            <p className={styles.state}>{t('cat.loading')}</p>
          ) : items.length === 0 ? (
            <div className={styles.state}>
              <p>{t('want.empty')}</p>
              <Link to="/books" className={styles.primary}>{t('want.toLibrary')}</Link>
            </div>
          ) : (
            <Shelves
              items={items}
              keyOf={(b) => b.id}
              onOpen={(b) => (b.work_key ? open(b.work_key) : remove(b))}
              face={(b) => (
                <BookFace title={b.title} author={b.author} cover={b.cover_thumb_url ?? b.cover_url} seed={b.work_key ?? b.title.trim().toLowerCase()} />
              )}
              label={(b) => (
                <>
                  <div className={styles.labelTitle}>{b.title}</div>
                  {b.author && <div className={styles.labelAuthor}>{b.author}</div>}
                </>
              )}
            />
          )}
        </Container>
      </main>
      {openKey && <WorkSheet workKey={openKey} onClose={() => open(null)} onChanged={load} />}
    </div>
  );
}
