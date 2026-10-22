import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, apiPut, track, useAuth, useI18n, type Pick, type Picks as PicksData, type PicksBasis, type User } from '@/shared/lib';
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
/** «На чём основана подборка»: one quiet line, and everything the picks stand on when opened (the founder, 2026-10-22). */
function Basis({ basis, wish }: { basis: PicksBasis; wish: string | null }) {
  const { t } = useI18n();
  const summary = [
    [basis.marks.length, 'picks.basisMarks'],
    [basis.finished.length + basis.long.length, 'picks.basisFinished'],
    [basis.favourites.length, 'picks.basisFavourites'],
    [basis.kindred.length, 'picks.basisKindred'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, key]) => `${t(key as string)} ${n}`)
    .join(' · ');
  const rows: { label: string; items: string[] }[] = [
    { label: t('picks.basisRowMarks'), items: basis.marks.map((m) => `${m.title} ${m.mark}`) },
    { label: t('picks.basisRowFinished'), items: basis.finished },
    { label: t('picks.basisRowLong'), items: basis.long },
    { label: t('picks.basisRowFavourites'), items: basis.favourites },
    { label: t('picks.basisRowDropped'), items: basis.dropped },
    { label: t('picks.basisRowWanted'), items: basis.wanted },
    { label: t('picks.basisRowDismissed'), items: basis.dismissed },
    { label: t('picks.basisRowKindred'), items: basis.kindred.map((k) => t('picks.basisKin', { name: k.name, agree: k.agree, shared: k.shared })) },
  ].filter((r) => r.items.length > 0);
  return (
    <details className={styles.basis} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && track('picks_basis_open')}>
      <summary>
        <span className={styles.basisTitle}>{t('picks.basis')}</span>
        {summary && <span className={styles.basisSummary}>{summary}</span>}
      </summary>
      <div className={styles.basisBody}>
        {wish && <p className={styles.basisRow}><b>{t('picks.basisRowWish')}</b> {wish}</p>}
        {rows.map((r) => (
          <p key={r.label} className={styles.basisRow}>
            <b>{r.label} · {r.items.length}</b> {r.items.join(' · ')}
          </p>
        ))}
        {basis.reviews_with_words > 0 && <p className={styles.basisRow}>{t('picks.basisWords', { n: basis.reviews_with_words })}</p>}
        <p className={styles.basisRow}>{t('picks.basisDna', { known: basis.dna_known, total: basis.dna_total })}</p>
        <p className={styles.basisRow}>{t('picks.basisHow')}</p>
      </div>
    </details>
  );
}

const CHIPS = ['picks.chipLight', 'picks.chipShort', 'picks.chipKazakh', 'picks.chipClassic', 'picks.chipNonfiction'] as const;

/** The reader's own ask, above the picks: a few words or a tap on a suggestion, then «Подобрать мне». */
function Ask({ value, onChange, onAsk, busy, asked, onClear }: {
  value: string;
  onChange: (v: string) => void;
  onAsk: (wish: string) => void;
  busy: boolean;
  asked: string | null;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) onAsk(value.trim());
  };
  return (
    <form className={styles.ask} onSubmit={submit}>
      <label className={styles.askLabel} htmlFor="picks-wish">{t('picks.askLabel')}</label>
      <div className={styles.askRow}>
        <input
          id="picks-wish"
          className={store.field}
          value={value}
          maxLength={200}
          placeholder={t('picks.askPlaceholder')}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="submit" className={`${store.primary} ${styles.small}`} disabled={busy}>
          ✦ {t('picks.ask')}
        </button>
      </div>
      <div className={styles.chips}>
        {CHIPS.map((key) => (
          <button key={key} type="button" className={styles.chip} disabled={busy} onClick={() => { onChange(t(key)); onAsk(t(key)); }}>
            {t(key)}
          </button>
        ))}
      </div>
      {asked && (
        <p className={styles.asked}>
          {t('picks.asked', { wish: asked })}{' '}
          <button type="button" className={styles.textButton} disabled={busy} onClick={onClear}>{t('picks.clearWish')}</button>
        </p>
      )}
    </form>
  );
}

/** Where «Что почитать дальше» lives elsewhere: one line to its own page (Библиотека → «✦ Подобрать»). */
export function PicksEntry() {
  const { t } = useI18n();
  return (
    <Link to="/library/picks" className={styles.entry} onClick={() => track('picks_entry')}>
      <span aria-hidden="true">✦</span>
      <span className={styles.entryText}>{t('picks.entry')}</span>
      <span className={styles.entryGo}>{t('picks.entryGo')} →</span>
    </Link>
  );
}

export function Picks({ onOpen, onWantChanged, askable = false, initialWish = null }: {
  onOpen: (key: string) => void;
  onWantChanged?: () => void;
  /** the reader may say what they want now (the picks' own page) */
  askable?: boolean;
  /** an ask that came with the link («Похожее на …» from a book's card): asked at once */
  initialWish?: string | null;
}) {
  const { t, locale } = useI18n();
  const [wish, setWish] = useState(initialWish ?? '');
  const sentInitial = useRef(false);
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

  // `ask` undefined: written again by itself, the last ask kept; a string (empty: none) is the reader's new ask
  const start = useCallback(
    async (force: boolean, ask?: string) => {
      setError(null);
      const body = ask === undefined ? { lang: locale, force, keep_wish: true } : { lang: locale, force, wish: ask || null };
      const { data: next, error: failed } = await apiPost<PicksData>('/reading/picks', body, { requireAuth: true });
      if (next) {
        setData(next);
        setDismissed({});
        track('picks_start', { force, wish: ask === undefined ? 'kept' : ask ? 'own' : 'none' });
      } else setError(failed);
    },
    [locale]
  );

  useEffect(() => {
    asked.current = false;
    setData(null);
    load();
  }, [load]);

  // Writes itself: never written, or the reader's marks changed since. An ask that came with the link goes first.
  useEffect(() => {
    if (!data || asked.current || !data.enabled || !data.ai_available || !data.has_taste) return;
    if (data.status === 'working') return;
    if (initialWish && !sentInitial.current) {
      sentInitial.current = true;
      asked.current = true;
      start(false, initialWish);
      return;
    }
    if (data.status === null || data.stale || data.status === 'error') {
      asked.current = true;
      start(false);
    }
  }, [data, start, initialWish]);

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
        {/* on its own page the page's title says it */}
        <h2 id="picks-title" className={askable ? styles.hidden : styles.title}>
          <span aria-hidden="true">✦</span> {t('picks.title')}
        </h2>
        {data.has_taste && (data.taste && !working ? <p className={styles.taste}>{data.taste}</p> : <p className={styles.taste}>{t('picks.intro')}</p>)}
        {data.has_taste && data.likes.length > 0 && (
          <p className={styles.portrait}>
            <span className={styles.portraitLabel}>{t('picks.yourTaste')}</span>
            {data.likes.map((trait) => <span key={trait} className={styles.like}>{t(`dna.${trait}`)}</span>)}
            {data.dislikes.length > 0 && <span className={styles.portraitLabel}>{t('picks.notQuite')}</span>}
            {data.dislikes.map((trait) => <span key={trait} className={styles.dislike}>{t(`dna.${trait}`)}</span>)}
          </p>
        )}
      </div>

      {!data.has_taste ? (
        <FirstStep missing={data.marks_missing} onSaved={async () => {
          asked.current = false;
          await load();
        }} />
      ) : (
        <>
          {askable && (
            <Ask
              value={wish}
              onChange={setWish}
              onAsk={(w) => start(false, w)}
              busy={working}
              asked={data.wish}
              onClear={() => {
                setWish('');
                start(false, '');
              }}
            />
          )}
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
                      {(p.outside || p.match !== null) && (
                        <span className={styles.badges}>
                          {p.match !== null && <span className={styles.matchBadge}>{t('picks.match', { n: p.match })}</span>}
                          {p.outside && <span className={styles.fresh}>{t('picks.outside')}</span>}
                        </span>
                      )}
                      <button type="button" className={styles.name} onClick={() => look(p)}>
                        <span className={styles.bookTitle}>{p.book.title}</span>
                        {p.book.author && <span className={styles.author}>{p.book.author}</span>}
                      </button>
                      {p.fits.length > 0 && (
                        <p className={styles.fits}>{p.fits.map((trait) => t(`dna.${trait}`)).join(' · ')}</p>
                      )}
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
          {data.status === 'done' && !working && data.basis && <Basis basis={data.basis} wish={data.wish} />}
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
