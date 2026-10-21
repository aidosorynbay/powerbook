import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, track, useI18n, type Pick, type Picks as PicksData } from '@/shared/lib';
import { BookFace } from './bookUi';
import store from './Store.module.css';
import styles from './Picks.module.css';

/**
 * «Что почитать дальше»: the AI librarian (app/services/librarian.py). From the reader's marks it picks three books of
 * the shared library and says why; one tap puts a book on «Хочу прочитать», «Не моё» never shows it again. It writes
 * itself when opened and the marks changed since — no button to find (the founder, 2026-10-21: «максимально простенько»).
 */
export function Picks({ onOpen, onWantChanged }: { onOpen: (key: string) => void; onWantChanged?: () => void }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<PicksData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // turned down here, to say so in its place (and take it back)
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  const asked = useRef(false);
  const poll = useRef<number>();
  const section = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    const { data: next } = await apiGet<PicksData>(`/reading/picks?lang=${locale}`, { requireAuth: true });
    if (next) setData(next);
    return next ?? null;
  }, [locale]);

  const start = useCallback(
    async (force: boolean) => {
      setError(null);
      const { data: next, error: failed } = await apiPost<PicksData>('/reading/picks', { lang: locale, force }, { requireAuth: true });
      if (next) {
        setData(next);
        if (force) setDismissed({});
        track('picks_start', { force });
      } else setError(failed);
    },
    [locale]
  );

  useEffect(() => {
    asked.current = false;
    setData(null);
    load();
  }, [load]);

  // Writes itself: never written, or the reader's marks changed since.
  useEffect(() => {
    if (!data || asked.current || !data.enabled || !data.ai_available || !data.has_taste) return;
    if (data.status === 'working') return;
    if (data.status === null || data.stale || data.status === 'error') {
      asked.current = true;
      start(false);
    }
  }, [data, start]);

  useEffect(() => {
    if (data?.status !== 'working') return;
    let tries = 0;
    const tick = async () => {
      tries += 1;
      const next = await load();
      if (next?.status === 'working' && tries < 100) poll.current = window.setTimeout(tick, 3000);
    };
    poll.current = window.setTimeout(tick, 3000);
    return () => window.clearTimeout(poll.current);
  }, [data?.status, load]);

  // From the bell: straight to the picks.
  useEffect(() => {
    if (data?.picks.length && window.location.hash === '#picks') section.current?.scrollIntoView({ block: 'start' });
  }, [data?.picks.length]);

  if (!data || !data.enabled || !data.ai_available) return null;

  const setPick = (key: string, patch: Partial<Pick>) =>
    setData((d) => (d ? { ...d, picks: d.picks.map((p) => (p.book.key === key ? { ...p, ...patch } : p)) } : d));

  const want = async (p: Pick) => {
    if (busy) return;
    setBusy(p.book.key);
    if (p.want_id) {
      const { error: failed } = await apiDelete(`/library/want/${p.want_id}`, { requireAuth: true });
      if (!failed) setPick(p.book.key, { want_id: null });
    } else {
      const { data: added } = await apiPost<{ id: string }>(
        '/library/want',
        { title: p.book.title, author: p.book.author, work_key: p.book.key },
        { requireAuth: true }
      );
      if (added) {
        setPick(p.book.key, { want_id: added.id });
        track('picks_want');
      }
    }
    setBusy(null);
    onWantChanged?.();
  };

  const notMine = async (p: Pick) => {
    if (busy) return;
    setBusy(p.book.key);
    const { error: failed } = await apiPost('/reading/picks/dismiss', { work_key: p.book.key }, { requireAuth: true });
    setBusy(null);
    if (failed) return;
    if (p.want_id) {
      await apiDelete(`/library/want/${p.want_id}`, { requireAuth: true });
      onWantChanged?.();
    }
    setDismissed((d) => ({ ...d, [p.book.key]: p.book.title }));
    track('picks_dismiss');
  };

  // read it already: onto the read shelf, then its card, to give it a mark (the next picks learn from it)
  const readIt = async (p: Pick) => {
    if (busy) return;
    setBusy(p.book.key);
    const { error: failed } = await apiPost(
      '/library/read',
      { title: p.book.title, author: p.book.author, work_key: p.book.key },
      { requireAuth: true }
    );
    setBusy(null);
    if (failed) return;
    setData((d) => (d ? { ...d, picks: d.picks.filter((x) => x.book.key !== p.book.key) } : d));
    track('picks_read');
    onWantChanged?.();
    onOpen(p.book.key);
  };

  const undo = async (key: string) => {
    await apiDelete(`/reading/picks/dismiss?work_key=${encodeURIComponent(key)}`, { requireAuth: true });
    setDismissed((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
  };

  const working = data.status === 'working';
  const left = data.picks.filter((p) => !dismissed[p.book.key]);
  const failed = error ?? (data.status === 'error' ? 'failed' : null);

  return (
    <section id="picks" ref={section} className={styles.picks} aria-labelledby="picks-title">
      <div className={styles.head}>
        <h2 id="picks-title" className={styles.title}>
          <span aria-hidden="true">✦</span> {t('picks.title')}
        </h2>
        {data.taste && !working ? <p className={styles.taste}>{data.taste}</p> : <p className={styles.taste}>{t('picks.intro')}</p>}
      </div>

      {!data.has_taste ? (
        <p className={styles.empty}>
          {t('picks.noTaste', { n: data.marks_missing })} <Link className={store.link} to="/library">{t('picks.toShelf')} →</Link>
        </p>
      ) : (
        <>
          {working && (
            <p className={styles.working}>
              <span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>
              {t('picks.working')}
            </p>
          )}
          {failed && !working && (
            <p className={styles.note}>{failed === 'ai_daily_limit' ? t('picks.limit') : t('picks.error')}</p>
          )}
          {data.picks.length > 0 && (
            <ol className={`${styles.list} ${working ? styles.dim : ''}`}>
              {data.picks.map((p) =>
                dismissed[p.book.key] ? (
                  <li key={p.book.key} className={styles.gone}>
                    {t('picks.dismissed', { title: dismissed[p.book.key] })}{' '}
                    <button type="button" className={styles.textButton} onClick={() => undo(p.book.key)}>{t('picks.undo')}</button>
                  </li>
                ) : (
                  <li key={p.book.key} className={styles.card}>
                    <button type="button" className={styles.cover} onClick={() => onOpen(p.book.key)} aria-label={p.book.title}>
                      <BookFace title={p.book.title} author={p.book.author} cover={p.book.cover_thumb_url ?? p.book.cover_url} seed={p.book.key} />
                    </button>
                    <div className={styles.body}>
                      <button type="button" className={styles.name} onClick={() => onOpen(p.book.key)}>
                        <span className={styles.bookTitle}>{p.book.title}</span>
                        {p.book.author && <span className={styles.author}>{p.book.author}</span>}
                      </button>
                      <p className={styles.why}>{p.why}</p>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={p.want_id ? `${store.ghost} ${styles.small}` : `${store.primary} ${styles.small}`}
                          onClick={() => want(p)}
                          disabled={busy === p.book.key || working}
                          aria-pressed={!!p.want_id}
                        >
                          {p.want_id ? t('picks.wanted') : t('picks.want')}
                        </button>
                        {!p.want_id && (
                          <button type="button" className={styles.textButton} onClick={() => readIt(p)} disabled={busy === p.book.key || working}>
                            {t('picks.readIt')}
                          </button>
                        )}
                        {!p.want_id && (
                          <button type="button" className={styles.textButton} onClick={() => notMine(p)} disabled={busy === p.book.key || working}>
                            {t('picks.notMine')}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                )
              )}
            </ol>
          )}
          {data.status === 'done' && !working && (
            <div className={styles.foot}>
              <span className={styles.privacy}>{t('picks.privacy')}</span>
              {left.length === 0 && <span className={styles.note}>{t('picks.allDone')}</span>}
              <button type="button" className={`${styles.textButton} ${styles.again}`} onClick={() => start(true)}>
                ↻ {t('picks.more')}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
