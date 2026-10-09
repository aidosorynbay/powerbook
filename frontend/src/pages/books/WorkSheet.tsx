import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, apiPut, formatSpent, track, useI18n, type Work } from '@/shared/lib';
import { Avatar, Icon } from '@/shared/ui';
import { BookChat } from '@/widgets/BookChat';
import { BookFace, PbBadge, Sheet, formatDay, formatPrice, useCount } from './bookUi';
import { MarkForm } from './MarkForm';
import styles from './Store.module.css';

type Props = {
  workKey: string;
  title?: string;
  onClose: () => void;
  /** The book's marks changed: the list behind may want to show it. */
  onChanged?: () => void;
  /** A review to show at once: the bell's news of it leads here. */
  review?: string | null;
};

/** One book of the shared library: what PowerBook readers and the world think of it. */
export function WorkSheet({ workKey, title, onClose, onChanged, review }: Props) {
  const { t, locale } = useI18n();
  const count = useCount();
  const [work, setWork] = useState<Work | null>(null);
  const [failed, setFailed] = useState<'missing' | 'error' | null>(null);
  const [adding, setAdding] = useState(false);
  // «Обсудить с AI» over this sheet.
  const [talk, setTalk] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await apiGet<Work>(`/books/work/${encodeURIComponent(workKey)}?locale=${locale}`, { requireAuth: true });
    if (data) {
      setWork(data);
      setFailed(null);
    } else {
      setFailed(error === 'book_not_found' ? 'missing' : 'error');
    }
  }, [workKey, locale]);

  useEffect(() => {
    setWork(null);
    load();
  }, [load]);

  const loaded = !!work;
  useEffect(() => {
    if (!loaded || !review) return;
    document.getElementById(`review-${review}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [loaded, review]);

  // Not on my shelf yet: put it there as read, then the mark can follow.
  const addToShelf = async () => {
    if (!work || adding) return;
    setAdding(true);
    const { data } = await apiPost<{ id: string }>(
      '/insights/books',
      { title: work.title, author: work.author, finished_on: null },
      { requireAuth: true }
    );
    setAdding(false);
    if (data) setWork({ ...work, my_volume_key: `m:${data.id}` });
  };

  const sourceName = (source: string | null) => (source ? t(`src.${source}`) : '');

  // «Следить за книгой»: hear when it is on the bazaar or someone in the circle finishes it.
  const toggleWatch = async () => {
    if (!work) return;
    const path = `/books/watch/${encodeURIComponent(work.key)}`;
    const { data } = work.watching
      ? await apiDelete<{ watching: boolean; watchers: number }>(path, { requireAuth: true })
      : await apiPut<{ watching: boolean; watchers: number }>(path, {}, { requireAuth: true });
    if (data) {
      setWork({ ...work, watching: data.watching, watchers: data.watchers });
      track('book_watch', { on: data.watching });
    }
  };

  return (
    <Sheet label={work?.title ?? title ?? ''} onClose={onClose}>
      {!work && !failed && <p className={styles.state}>{t('cat.loading')}</p>}
      {failed && <p className={styles.state}>{failed === 'missing' ? t('work.notInLibrary') : t('work.loadError')}</p>}
      {work && (
        <>
          <div className={styles.hero}>
            <BookFace title={work.title} author={work.author} cover={work.cover_url} />
            <div>
              <h2 className={styles.heroTitle}>{work.title}</h2>
              {work.author && <p className={styles.heroAuthor}>{work.author}</p>}
              <p className={styles.heroMeta}>
                {work.year && <span>{work.year} {t('work.year')}</span>}
                {work.pages && <span>{work.pages} {t('work.pages')}</span>}
                <span>{count('readers', work.readers)}</span>
              </p>
              {/* the time the book has had: the viewer's own (their days, the reading room), and the circle's */}
              {((work.my_minutes ?? 0) > 0 || (work.circle_minutes ?? 0) > 0) && (
                <p className={styles.heroTime}>
                  {(work.my_minutes ?? 0) > 0 && <span>{t('bookTime.mine', { time: formatSpent(work.my_minutes!, t) })}</span>}
                  {(work.circle_minutes ?? 0) > 0 && (
                    <span>{t('bookTime.circle', { time: formatSpent(work.circle_minutes!, t), n: work.circle_readers ?? 0 })}</span>
                  )}
                </p>
              )}
            </div>
          </div>

          <div className={styles.ratings}>
            <div className={styles.ratingCard}>
              <h4>{t('work.pbRating')}</h4>
              {work.pb_rating !== null ? (
                <>
                  <div className={styles.ratingRow}>
                    <PbBadge value={work.pb_rating} big />
                    <span className={styles.ratingSub}>
                      {count('votes', work.pb_votes)}
                      {work.pb_reviews > 0 && <><br />{count('reviews', work.pb_reviews)}</>}
                    </span>
                  </div>
                  <div className={styles.histogram} aria-hidden="true">
                    {work.histogram.map((n, i) => (
                      <span key={i} data-on={n > 0} style={{ height: `${Math.max(6, (n / Math.max(...work.histogram, 1)) * 100)}%` }} title={`${i + 1}: ${n}`} />
                    ))}
                  </div>
                </>
              ) : (
                <span className={styles.ratingSub}>{t('work.noPbYet')}</span>
              )}
            </div>
            <div className={styles.ratingCard}>
              <h4>{t('work.extRating')}</h4>
              {work.ext_rating !== null ? (
                <>
                  <span className={styles.extBig}>
                    {work.ext_rating.toFixed(2)} <small>/ {work.ext_scale}</small>
                  </span>
                  <span className={styles.ratingSub}>
                    {work.ext_url ? (
                      <a className={styles.link} href={work.ext_url} target="_blank" rel="noopener noreferrer">
                        {sourceName(work.ext_source)} {'↗\uFE0E'}
                      </a>
                    ) : (
                      sourceName(work.ext_source)
                    )}
                    {work.ext_votes ? <><br />{t('work.extVotes', { n: work.ext_votes.toLocaleString() })}</> : null}
                  </span>
                </>
              ) : (
                <span className={styles.ratingSub}>{t('work.noExt')}</span>
              )}
            </div>
          </div>

          {work.my_volume_key ? (
            <MarkForm
              volumeKey={work.my_volume_key}
              rating={work.my_review?.rating ?? null}
              text={work.my_review?.text ?? null}
              reviewId={work.my_review?.id ?? null}
              onSaved={() => {
                load();
                onChanged?.();
              }}
            />
          ) : (
            <div className={styles.markBox}>
              <p className={styles.markHint} style={{ marginBottom: 10 }}>{t('work.notOnShelf')}</p>
              <button type="button" className={styles.primary} onClick={addToShelf} disabled={adding}>
                + {t('work.addToShelf')}
              </button>
            </div>
          )}

          {work.about && (
            <section className={styles.section}>
              <h3>{t('work.about')}</h3>
              <p>{work.about.text}</p>
              <span className={styles.sourceNote}>
                {work.about.url ? (
                  <a href={work.about.url} target="_blank" rel="noopener noreferrer">{sourceName(work.about.source)} {'↗\uFE0E'}</a>
                ) : (
                  sourceName(work.about.source)
                )}
              </span>
            </section>
          )}

          {work.readers_say && (
            <section className={styles.section}>
              <h3>{t('work.readersSay')}</h3>
              <p>{work.readers_say.text}</p>
              <span className={styles.sourceNote}>{t('work.readersSayNote', { source: sourceName(work.readers_say.source) })}</span>
            </section>
          )}

          <section className={styles.section}>
            <h3>{t('work.pbReviews')}</h3>
            {work.reviews.length === 0 ? (
              <p>{t('work.noReviews')}</p>
            ) : (
              <ul className={styles.reviewList}>
                {work.reviews.map((r) => (
                  <li key={r.id} id={`review-${r.id}`} className={`${styles.review} ${r.id === review ? styles.reviewNew : ''}`}>
                    <div className={styles.reviewHead}>
                      <Avatar src={r.avatar_data} name={r.display_name} size="sm" />
                      <Link to={`/readers/${r.user_id}`}>{r.is_viewer ? `${r.display_name} (${t('work.you')})` : r.display_name}</Link>
                      <PbBadge value={r.rating} />
                    </div>
                    {r.text && <p>{r.text}</p>}
                    <time className={styles.formNote}>{formatDay(r.updated_at, locale)}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {work.listings.length > 0 && (
            <section className={styles.section}>
              <h3>{t('work.sellers')}</h3>
              <div className={styles.offers}>
                {work.listings.map((l) => (
                  <Link key={l.id} to={`/market?listing=${l.id}`} className={styles.offer}>
                    <span>
                      {l.seller.display_name}
                      {l.city ? ` · ${l.city}` : ''} · {t(`mkt.cond.${l.condition}`)}
                    </span>
                    <strong className={`${styles.price} ${l.price <= 0 ? styles.priceFree : ''}`}>{formatPrice(l.price, locale, t('mkt.free'))}</strong>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {work.readers_list.length > 0 && (
            <section className={styles.section}>
              <h3>{t('work.readersTitle')}</h3>
              <ul className={styles.people}>
                {work.readers_list.map((r) => (
                  <li key={r.user_id}>
                    <Link to={`/readers/${r.user_id}`}>
                      <Avatar src={r.avatar_data} name={r.display_name} size="sm" />
                      <span>{r.is_viewer ? t('work.you') : r.display_name}</span>
                    </Link>
                  </li>
                ))}
                {work.readers > work.readers_list.length && (
                  <li className={styles.formNote} style={{ alignSelf: 'center' }}>{t('work.readersMore', { n: work.readers - work.readers_list.length })}</li>
                )}
              </ul>
            </section>
          )}

          <div className={styles.watch}>
            <button type="button" className={work.watching ? styles.primary : styles.ghost} onClick={toggleWatch} aria-pressed={!!work.watching}>
              <Icon name="bell" size="em" aria-hidden="true" /> {work.watching ? t('watch.on') : t('watch.off')}
            </button>
            <span className={styles.formNote}>
              {work.watching ? t('watch.hintOn') : t('watch.hint')}
              {(work.watchers ?? 0) > (work.watching ? 1 : 0) && <> · {t('watch.others', { n: (work.watchers ?? 0) - (work.watching ? 1 : 0) })}</>}
            </span>
          </div>

          <div className={styles.links}>
            <button type="button" className={styles.ghost} onClick={() => setTalk(true)}>
              <Icon name="sparkle" size="em" aria-hidden="true" /> {t('chat.open')}
            </button>
            {work.my_volume_key && (
              <Link className={styles.ghost} to={`/market?sell=${encodeURIComponent(work.my_volume_key)}&title=${encodeURIComponent(work.title)}${work.author ? `&author=${encodeURIComponent(work.author)}` : ''}`}>
                ₸ {t('work.sellThis')}
              </Link>
            )}
            {work.goodreads_url && (
              <a className={styles.ghost} href={work.goodreads_url} target="_blank" rel="noopener noreferrer">
                {t('work.goodreads')} {'↗\uFE0E'}
              </a>
            )}
            {work.source_url && (
              <a className={styles.ghost} href={work.source_url} target="_blank" rel="noopener noreferrer">
                {t('src.google')} {'↗\uFE0E'}
              </a>
            )}
          </div>
          {talk && <BookChat workKey={work.key} title={work.title} from="book" onClose={() => setTalk(false)} />}
        </>
      )}
    </Sheet>
  );
}
