import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet, useI18n, type CatalogItem, type CatalogPage as Page } from '@/shared/lib';
import { Container } from '@/shared/ui';
import { Header } from '@/widgets';
import { BookFace, ExtBadge, PbBadge, Shelves, useCount } from './bookUi';
import { WorkSheet } from './WorkSheet';
import styles from './Store.module.css';
import { LibrarySwitch } from './LibrarySwitch';

type Filter = 'all' | 'rated' | 'reviewed' | 'sale';
type Sort = 'popular' | 'pb' | 'ext' | 'new' | 'az';
const PAGE = 48;

/** The shared library: every book PowerBook readers have read, each one once. */
export function CatalogPage() {
  const { t } = useI18n();
  const count = useCount();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(query);
  const [filter, setFilter] = useState<Filter>((params.get('filter') as Filter) || 'all');
  const [sort, setSort] = useState<Sort>(() => {
    try {
      return (localStorage.getItem('pb.catalogSort') as Sort) || 'popular';
    } catch {
      return 'popular';
    }
  });
  const [topic, setTopic] = useState<string | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const openKey = params.get('book');

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  const load = useCallback(
    async (offset: number) => {
      const ticket = ++request.current;
      setLoading(true);
      const qs = new URLSearchParams({ filter, sort, offset: String(offset), limit: String(PAGE) });
      if (debounced) qs.set('q', debounced);
      if (topic) qs.set('topic', topic);
      const { data } = await apiGet<Page>(`/books/catalog?${qs}`, { requireAuth: true });
      if (ticket !== request.current) return;
      setLoading(false);
      if (!data) return setFailed(true);
      setFailed(false);
      setPage(data);
      setItems((prev) => (offset === 0 ? data.items : [...prev, ...data.items]));
    },
    [filter, sort, topic, debounced]
  );

  useEffect(() => {
    load(0);
  }, [load]);

  const changeSort = (next: Sort) => {
    setSort(next);
    try {
      localStorage.setItem('pb.catalogSort', next);
    } catch {
      // private mode: the order lasts this visit
    }
  };

  const open = (key: string | null) => {
    const next = new URLSearchParams(params);
    if (key) next.set('book', key);
    else next.delete('book');
    next.delete('review');
    setParams(next, { replace: !key });
  };

  const openItem = items.find((i) => i.key === openKey);
  const topics = Object.entries(page?.topics ?? {}).sort((a, b) => b[1] - a[1]);
  const counts = page?.counts;

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <Container>
          <div className={styles.head}>
            <div>
              <h1 className={styles.title}>
                <LibrarySwitch current="books" />
              </h1>
              <p className={styles.subtitle}>{t('cat.subtitle')}</p>
              {counts && (
                <p className={styles.headStats}>
                  <span>{count('books', counts.all)}</span>
                  <span>{t('cat.filterRated')}: {counts.rated}</span>
                  <span>{t('cat.filterSale')}: {counts.sale}</span>
                </p>
              )}
            </div>
          </div>

          <div className={styles.controls}>
            <input
              className={styles.search}
              type="search"
              value={query}
              placeholder={t('cat.search')}
              aria-label={t('cat.search')}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className={styles.segment} role="group" aria-label={t('cat.filterLabel')}>
              {(['all', 'rated', 'reviewed', 'sale'] as Filter[]).map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {t(f === 'all' ? 'cat.filterAll' : f === 'rated' ? 'cat.filterRated' : f === 'reviewed' ? 'cat.filterReviewed' : 'cat.filterSale')}
                  {counts && <span>{counts[f]}</span>}
                </button>
              ))}
            </div>
            <select className={styles.select} value={sort} onChange={(e) => changeSort(e.target.value as Sort)} aria-label={t('cat.sort')}>
              <option value="popular">{t('cat.sortPopular')}</option>
              <option value="pb">{t('cat.sortPb')}</option>
              <option value="ext">{t('cat.sortExt')}</option>
              <option value="new">{t('cat.sortNew')}</option>
              <option value="az">{t('cat.sortAz')}</option>
            </select>
          </div>

          {topics.length > 0 && (
            <div className={styles.chips}>
              <button type="button" className={styles.chip} aria-pressed={topic === null} onClick={() => setTopic(null)}>
                {t('cat.topicsAll')}
              </button>
              {topics.map(([key, n]) => (
                <button key={key} type="button" className={styles.chip} aria-pressed={topic === key} onClick={() => setTopic(topic === key ? null : key)}>
                  {t(`topics.${key}`)}
                  <span>{n}</span>
                </button>
              ))}
            </div>
          )}

          {failed && !items.length ? (
            <div className={styles.state}>
              <p>{t('cat.loadError')}</p>
              <button type="button" className={styles.primary} onClick={() => load(0)}>{t('cat.retry')}</button>
            </div>
          ) : !page && loading ? (
            <p className={styles.state}>{t('cat.loading')}</p>
          ) : items.length === 0 ? (
            <p className={styles.state}>{t('cat.empty')}</p>
          ) : (
            <Shelves
              items={items}
              keyOf={(b) => b.key}
              onOpen={(b) => open(b.key)}
              face={(b) => (
                <BookFace title={b.title} author={b.author} cover={b.cover_thumb_url ?? b.cover_url}>
                  <span className={styles.faceBadges}>
                    {b.pb_rating !== null && <PbBadge value={b.pb_rating} />}
                    {b.ext_rating !== null && <ExtBadge rating={b.ext_rating} source={b.ext_source} />}
                  </span>
                  {b.my_rating !== null && <span className={styles.mine} title={t('work.yourMark')}>{b.my_rating}</span>}
                  {b.for_sale > 0 && <span className={styles.saleDot} title={t('cat.forSale')}>₸</span>}
                </BookFace>
              )}
              label={(b) => (
                <>
                  <div className={styles.labelTitle}>{b.title}</div>
                  {b.author && <div className={styles.labelAuthor}>{b.author}</div>}
                  <div className={styles.labelMeta}>
                    {count('readers', b.readers)}
                    {b.pb_votes > 0 && ` · ${count('votes', b.pb_votes)}`}
                  </div>
                </>
              )}
            />
          )}

          {page && items.length < page.total && (
            <div className={styles.more}>
              <button type="button" className={styles.ghost} onClick={() => load(items.length)} disabled={loading}>
                {t('cat.more')} · {page.total - items.length}
              </button>
            </div>
          )}
        </Container>
      </main>

      {openKey && <WorkSheet workKey={openKey} title={openItem?.title} review={params.get('review')} onClose={() => open(null)} onChanged={() => load(0)} />}
    </div>
  );
}
