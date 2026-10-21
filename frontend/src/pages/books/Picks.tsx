import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut, track, useAuth, useI18n, type Pick, type Picks as PicksData, type User } from '@/shared/lib';
import { BookFace } from './bookUi';
import store from './Store.module.css';
import styles from './Picks.module.css';

/**
 * «Что почитать дальше»: the AI librarian (app/services/librarian.py). From the reader's marks it picks three books —
 * two of the club's library, one from the world that a catalogue really has — and says why; one tap puts a book on
 * «Хочу прочитать», «Не моё» never shows it again. It writes itself when opened and the marks changed since — no
 * button to find (the founder, 2026-10-21: «максимально простенько»). A newcomer starts from three favourite books.
 */

/** A newcomer's first step: three favourite books (the profile's «Любимые книги»), and the picks follow. */
function FirstStep({ missing, onSaved }: { missing: number; onSaved: () => void }) {
  const { t } = useI18n();
  const { user, setUserQuietly } = useAuth();
  const [books, setBooks] = useState<string[]>(() => [0, 1, 2].map((i) => user?.favorite_books?.[i] ?? ''));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const filled = books.filter((b) => b.trim()).length;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !filled) return;
    setBusy(true);
    setFailed(false);
    const { data } = await apiPut<User>('/auth/profile', { favorite_books: books.map((b) => b.trim()).filter(Boolean) }, { requireAuth: true });
    setBusy(false);
    if (!data) return setFailed(true);
    setUserQuietly(data);
    track('picks_first_step', { books: filled });
    onSaved();
  };

  return (
    <form className={styles.first} onSubmit={save}>
      <p className={styles.empty}>{t('picks.firstStep')}</p>
      <div className={styles.fields}>
        {books.map((b, i) => (
          <input
            key={i}
            className={store.field}
            value={b}
            maxLength={200}
            placeholder={t('picks.favPlaceholder', { n: i + 1 })}
            aria-label={t('picks.favPlaceholder', { n: i + 1 })}
            onChange={(e) => setBooks((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
          />
        ))}
      </div>
      <div className={styles.actions}>
        <button type="submit" className={`${store.primary} ${styles.small}`} disabled={busy || !filled}>
          {t('picks.firstGo')}
        </button>
        <span className={styles.privacy}>{t('picks.firstHint', { n: missing })}</span>
      </div>
      {failed && <p className={styles.note}>{t('picks.error')}</p>}
    </form>
  );
}
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
        { title: p.book.title, author: p.book.author, work_key: p.outside ? null : p.book.key },
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
    const { error: failed } = await apiPost(
      '/reading/picks/dismiss',
      { work_key: p.book.key, title: p.book.title, author: p.book.author },
      { requireAuth: true }
    );
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
      { title: p.book.title, author: p.book.author, work_key: p.outside ? null : p.book.key },
      { requireAuth: true }
    );
    setBusy(null);
    if (failed) return;
    setData((d) => (d ? { ...d, picks: d.picks.filter((x) => x.book.key !== p.book.key) } : d));
    track('picks_read', { outside: p.outside });
    onWantChanged?.();
    // a book of the library opens its card for the mark; one from the world has no card yet
    if (!p.outside) onOpen(p.book.key);
  };

  const undo = async (key: string) => {
    const title = dismissed[key] ?? '';
    await apiDelete(`/reading/picks/dismiss?work_key=${encodeURIComponent(key)}&title=${encodeURIComponent(title)}`, { requireAuth: true });
    setDismissed((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
  };

  // a book of the library opens its card; one from the world, its page in the catalogue it was found in
  const look = (p: Pick) => {
    if (!p.outside) return onOpen(p.book.key);
    if (p.link) window.open(p.link, '_blank', 'noopener,noreferrer');
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
        {data.has_taste && (data.taste && !working ? <p className={styles.taste}>{data.taste}</p> : <p className={styles.taste}>{t('picks.intro')}</p>)}
      </div>

      {!data.has_taste ? (
        <FirstStep missing={data.marks_missing} onSaved={async () => {
          asked.current = false;
          await load();
        }} />
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
                    <button type="button" className={styles.cover} onClick={() => look(p)} aria-label={p.book.title}>
                      <BookFace title={p.book.title} author={p.book.author} cover={p.book.cover_thumb_url ?? p.book.cover_url} seed={p.book.key} />
                    </button>
                    <div className={styles.body}>
                      {p.outside && <span className={styles.fresh}>{t('picks.outside')}</span>}
                      <button type="button" className={styles.name} onClick={() => look(p)}>
                        <span className={styles.bookTitle}>{p.book.title}</span>
                        {p.book.author && <span className={styles.author}>{p.book.author}</span>}
                      </button>
                      <p className={styles.why}>{p.why}</p>
                      <p className={styles.meta}>
                        {p.days && data.pace ? <span>{t('picks.days', { days: p.days, pace: data.pace })}</span> : null}
                        {p.buy_url && (
                          <a href={p.buy_url} target="_blank" rel="noopener noreferrer" onClick={() => track('picks_buy', { outside: p.outside })}>
                            {t('picks.buy')} ↗
                          </a>
                        )}
                      </p>
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
