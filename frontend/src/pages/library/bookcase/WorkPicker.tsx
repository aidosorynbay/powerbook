import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPut, track, useI18n, type CatalogItem, type CoverOption } from '@/shared/lib';
import { apiUrl, PbBadge, useCount } from '@/pages/books/bookUi';
import styles from './Bookcase.module.css';

type Match = { works: CatalogItem[]; editions: CoverOption[] };

type Props = {
  volumeKey: string;
  initialQuery: string;
  pinned?: boolean;
  /** Search as soon as it opens (after an upload); in the edit sheet the reader asks. */
  autoSearch?: boolean;
  /** After a pick or an unpin: reload the shelf; the message is what to flash. */
  onDone: (message: string) => Promise<void> | void;
};

/**
 * «Какая это книга?»: the reader says which book their copy is, so that a
 * file called "Clear_James_-_Atomic_Habits" and a Russian edition on someone
 * else's shelf are one book, with one card and everyone's marks.
 *
 * Books of PowerBook's shared library come first (that is what joins readers
 * up), catalogue editions after, for a book nobody here has read yet.
 */
export function WorkPicker({ volumeKey, initialQuery, pinned = false, autoSearch = true, onDone }: Props) {
  const { t } = useI18n();
  const count = useCount();
  const [query, setQuery] = useState(initialQuery);
  const [found, setFound] = useState<Match | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = `/library/overrides/${encodeURIComponent(volumeKey)}/work`;

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) return;
    setSearching(true);
    setError(null);
    const { data } = await apiGet<Match>(`/books/match?q=${encodeURIComponent(q.trim())}`, { requireAuth: true });
    setFound(data ?? { works: [], editions: [] });
    setSearching(false);
  }, []);

  // Searched straight away: the query is what the file or the shelf already says.
  useEffect(() => {
    if (autoSearch && initialQuery.trim().length >= 2) void search(initialQuery);
  }, [autoSearch, initialQuery, search]);

  const pin = async (id: string, body: Record<string, string | null>, title: string) => {
    setBusy(id);
    setError(null);
    const { error: failed } = await apiPut(path, body, { requireAuth: true });
    setBusy(null);
    if (failed) {
      setError(t('which.error'));
      return;
    }
    track('book_pin', { kind: body.work_key ? 'library' : 'edition' });
    await onDone(t('which.done', { title }));
  };

  const unpin = async () => {
    setBusy('unpin');
    await apiDelete(path, { requireAuth: true });
    setBusy(null);
    await onDone(t('which.unpinned'));
  };

  return (
    <div className={styles.which}>
      {pinned && (
        <div className={styles.whichPinned}>
          <span>{t('which.pinned')}</span>
          <button type="button" className={styles.ghostButton} onClick={unpin} disabled={!!busy}>
            {t('which.unpin')}
          </button>
        </div>
      )}

      <form
        className={styles.searchRow}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void search(query);
        }}
      >
        <input
          className={styles.field}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('which.placeholder')}
          maxLength={200}
        />
        <button type="submit" className={styles.ghostButton} disabled={searching || !!busy}>
          {searching ? t('shelf.searching') : t('shelf.search')}
        </button>
      </form>

      {error && <p className={styles.formNote}>{error}</p>}
      {found && found.works.length === 0 && found.editions.length === 0 && !searching && (
        <p className={styles.formNote}>{t('which.none')}</p>
      )}

      {found && found.works.length > 0 && (
        <>
          <span className={styles.fieldLabelText}>{t('which.inLibrary')}</span>
          <ul className={styles.whichList}>
            {found.works.map((w) => (
              <li key={w.key}>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => pin(w.key, { work_key: w.key }, w.title)}
                >
                  {w.cover_thumb_url ? (
                    <img src={apiUrl(w.cover_thumb_url) ?? ''} alt="" loading="lazy" />
                  ) : (
                    <span className={styles.whichNoCover} aria-hidden="true" />
                  )}
                  <span className={styles.whichText}>
                    <strong>{w.title}</strong>
                    {w.author && <span>{w.author}</span>}
                    <small>
                      {count('readers', w.readers)}
                      {w.pb_rating !== null && <> · <PbBadge value={w.pb_rating} /></>}
                    </small>
                  </span>
                  <span className={styles.whichPick}>{busy === w.key ? t('shelf.working') : t('which.thisOne')}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {found && found.editions.length > 0 && (
        <>
          <span className={styles.fieldLabelText}>{t('which.editions')}</span>
          <ul className={styles.coverGrid}>
            {found.editions.map((option) => (
              <li key={`${option.source}:${option.volume_id}`}>
                <button
                  type="button"
                  disabled={!!busy}
                  title={option.title}
                  onClick={() =>
                    pin(
                      option.volume_id,
                      { source: option.source, volume_id: option.volume_id, title: option.title, author: option.author },
                      option.title
                    )
                  }
                >
                  <img src={option.thumb_url} alt="" loading="lazy" />
                  <span className={styles.coverGridTitle}>{option.title}</span>
                  {option.author && <span className={styles.coverGridAuthor}>{option.author}</span>}
                  {busy === option.volume_id && <span className={styles.coverGridBusy}>{t('shelf.working')}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Right after a file is brought in: say which book it is, or skip. */
export function WhichBookSheet({ volumeKey, initialQuery, onClose, onDone }: Props & { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={t('which.title')} onClick={(e) => e.stopPropagation()}>
        <div className={styles.sheetHead}>
          <span className={styles.wordmark}>{t('which.title')}</span>
          <button type="button" className={styles.sheetClose} onClick={onClose}>
            {t('which.skip')}
          </button>
        </div>
        <div className={styles.sheetSection}>
          <h3>{t('which.title')}</h3>
          <p>{t('which.hint')}</p>
          <WorkPicker volumeKey={volumeKey} initialQuery={initialQuery} onDone={onDone} />
        </div>
      </div>
    </div>
  );
}
