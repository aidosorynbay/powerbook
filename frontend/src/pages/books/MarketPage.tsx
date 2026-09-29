import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet, useAuth, useI18n, type Listing, type MarketPage as Page } from '@/shared/lib';
import { Container } from '@/shared/ui';
import { Header } from '@/widgets';
import { BookFace, PbBadge, Shelves, formatPrice, useToast } from './bookUi';
import { ListingSheet, SellSheet } from './ListingSheet';
import styles from './Store.module.css';
import { LibrarySwitch } from './LibrarySwitch';

type Sort = 'new' | 'cheap' | 'dear';
const PAGE = 48;

/** The book market: readers' own copies for sale, on the same kind of case as the library. */
export function MarketPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const mine = params.get('tab') === 'mine';
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [city, setCity] = useState('');
  const [sort, setSort] = useState<Sort>('new');
  const [page, setPage] = useState<Page | null>(null);
  const [items, setItems] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Listing | null>(null);
  const [toast, showToast] = useToast();
  const request = useRef(0);

  const openId = params.get('listing');
  const sellKey = params.get('sell');
  const selling = params.get('new') === '1' || sellKey !== null;

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  const load = useCallback(
    async (offset: number) => {
      const ticket = ++request.current;
      setLoading(true);
      if (mine) {
        if (!user) return;
        const { data } = await apiGet<Listing[]>(`/market/user/${user.id}`, { requireAuth: true });
        if (ticket !== request.current) return;
        setLoading(false);
        setItems(data ?? []);
        setPage(null);
        return;
      }
      const qs = new URLSearchParams({ sort, offset: String(offset), limit: String(PAGE) });
      if (debounced) qs.set('q', debounced);
      if (city) qs.set('city', city);
      const { data } = await apiGet<Page>(`/market?${qs}`, { requireAuth: true });
      if (ticket !== request.current) return;
      setLoading(false);
      if (!data) return;
      setPage(data);
      setItems((prev) => (offset === 0 ? data.items : [...prev, ...data.items]));
    },
    [mine, user, sort, debounced, city]
  );

  useEffect(() => {
    load(0);
  }, [load]);

  const setParam = (changes: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v === null ? next.delete(k) : next.set(k, v)));
    setParams(next, { replace });
  };

  const closeForm = () => {
    setEditing(null);
    setParam({ sell: null, new: null, title: null, author: null }, true);
  };

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <Container>
          <div className={styles.head}>
            <div>
              <h1 className={styles.title}>
                <LibrarySwitch current="market" />
              </h1>
              <p className={styles.subtitle}>{t('mkt.subtitle')}</p>
            </div>
            <button type="button" className={styles.primary} onClick={() => setParam({ new: '1' })}>
              + {t('mkt.sell')}
            </button>
          </div>

          <div className={styles.controls}>
            <div className={styles.segment} role="group">
              <button type="button" aria-pressed={!mine} onClick={() => setParam({ tab: null })}>{t('mkt.all')}</button>
              <button type="button" aria-pressed={mine} onClick={() => setParam({ tab: 'mine' })}>{t('mkt.mine')}</button>
            </div>
            {!mine && (
              <>
                <input className={styles.search} type="search" value={query} placeholder={t('mkt.search')} aria-label={t('mkt.search')} onChange={(e) => setQuery(e.target.value)} />
                {page && page.cities.length > 0 && (
                  <select className={styles.select} value={city} onChange={(e) => setCity(e.target.value)} aria-label={t('mkt.city')}>
                    <option value="">{t('mkt.allCities')}</option>
                    {page.cities.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}
                <div className={styles.segment} role="group" aria-label={t('cat.sort')}>
                  {(['new', 'cheap', 'dear'] as Sort[]).map((s) => (
                    <button key={s} type="button" aria-pressed={sort === s} onClick={() => setSort(s)}>
                      {t(s === 'new' ? 'mkt.sortNew' : s === 'cheap' ? 'mkt.sortCheap' : 'mkt.sortDear')}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {loading && items.length === 0 ? (
            <p className={styles.state}>{t('cat.loading')}</p>
          ) : items.length === 0 ? (
            <div className={styles.state}>
              <p>{mine ? t('mkt.emptyMine') : t('mkt.empty')}</p>
              <button type="button" className={styles.primary} onClick={() => setParam({ new: '1' })}>+ {t('mkt.sell')}</button>
            </div>
          ) : (
            <Shelves
              items={items}
              keyOf={(l) => l.id}
              onOpen={(l) => setParam({ listing: l.id })}
              face={(l) => (
                <BookFace title={l.title} author={l.author} cover={l.photo_url ?? l.cover_thumb_url ?? l.cover_url}>
                  <span className={styles.faceBadges}>{l.pb_rating !== null && <PbBadge value={l.pb_rating} />}</span>
                  {(l.status === 'sold' || l.status === 'reserved' || l.status === 'hidden') && (
                    <span className={styles.soldVeil}>{t(`mkt.status.${l.status}`)}</span>
                  )}
                </BookFace>
              )}
              label={(l) => (
                <>
                  <div className={styles.labelTitle}>{l.title}</div>
                  <div className={styles.labelAuthor}>{[l.author, l.city].filter(Boolean).join(' · ') || l.seller.display_name}</div>
                  <span className={`${styles.price} ${l.price <= 0 ? styles.priceFree : ''}`}>{formatPrice(l.price, locale, t('mkt.free'))}</span>
                </>
              )}
            />
          )}

          {!mine && page && items.length < page.total && (
            <div className={styles.more}>
              <button type="button" className={styles.ghost} onClick={() => load(items.length)} disabled={loading}>
                {t('cat.more')} · {page.total - items.length}
              </button>
            </div>
          )}
        </Container>
      </main>

      {openId && !editing && (
        <ListingSheet
          listingId={openId}
          onClose={() => setParam({ listing: null }, true)}
          onEdit={(l) => setEditing(l)}
          onChanged={() => load(0)}
        />
      )}
      {(selling || editing) && (
        <SellSheet
          listing={editing}
          prefill={selling ? { volumeKey: sellKey, title: params.get('title') ?? '', author: params.get('author') } : undefined}
          onClose={closeForm}
          onSaved={(saved, created) => {
            setEditing(null);
            const next = new URLSearchParams(params);
            ['sell', 'new', 'title', 'author'].forEach((k) => next.delete(k));
            next.set('listing', saved.id);
            setParams(next, { replace: true });
            load(0);
            if (created) showToast(t('mkt.published'));
          }}
        />
      )}
      {toast && <div className={styles.toast} role="status">{toast}</div>}
    </div>
  );
}
