import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  apiGet,
  apiPost,
  useI18n,
  type BookLetter,
  type Digest,
  type Locale,
  type NotebookEntry,
  type PeriodLetter,
  type ReadingOverview,
  type Recommendation,
} from '@/shared/lib';
import { Container } from '@/shared/ui';
import { Header } from '@/widgets';
import { BookFace, ExtBadge, INTL, PbBadge, formatDay, useCount } from '../books/bookUi';
import { WorkSheet } from '../books/WorkSheet';
import store from '../books/Store.module.css';
import { LetterError, Working, useDigest } from './digest';
import styles from './Reading.module.css';
import { LibrarySwitch } from '../books/LibrarySwitch';

type Tab = 'recap' | 'recs' | 'notes';

/** From the site's own words: browsers without Kazakh month names print "M08". */
function monthName(month: number, t: (key: string) => string, style: 'short' | 'long' = 'long'): string {
  const name = t(`month.${month}`);
  return style === 'long' ? name : name.slice(0, 3);
}

function PeriodLetterCard({ scope, aiAvailable }: { scope: string; aiAvailable: boolean }) {
  const { t } = useI18n();
  const { digest, error, start, starting } = useDigest('period', scope);
  const letter = digest?.status === 'done' ? (digest.content as PeriodLetter | null) : null;
  return (
    <section className={styles.letter}>
      <div className={styles.letterHead}>
        <h2>✦ {t('rd.letterTitle')}</h2>
        {aiAvailable && digest?.status !== 'working' && (
          <button type="button" className={letter ? store.ghost : store.primary} onClick={() => start(!!letter)} disabled={starting}>
            {letter ? t('rd.letterAgain') : t('rd.letterWrite')}
          </button>
        )}
      </div>
      {!letter && digest?.status !== 'working' && (
        <>
          <p className={styles.letterIntro}>{aiAvailable ? t('rd.letterIntro') : t('rd.letterOff')}</p>
          {aiAvailable && <p className={store.formNote}>{t('rd.letterPrivacy')}</p>}
        </>
      )}
      {digest?.status === 'working' && <Working />}
      {/* AI that is switched on but busy or out of reach: try later, not "coming soon". */}
      {digest?.status === 'error' && <LetterError code="failed" />}
      <LetterError code={error} />
      {letter && (
        <div className={styles.letterBody}>
          {digest?.stale && <p className={store.formNote}>{t('rd.letterStale')}</p>}
          <p className={styles.headline}>{letter.headline}</p>
          <p className={styles.prose}>{letter.summary}</p>
          {letter.themes.length > 0 && (
            <div>
              <h3>{t('rd.themes')}</h3>
              <ul className={styles.bullets}>
                {letter.themes.map((th, i) => (
                  <li key={i}><b>{th.title}.</b> {th.text}</li>
                ))}
              </ul>
            </div>
          )}
          {letter.patterns.length > 0 && (
            <div>
              <h3>{t('rd.patterns')}</h3>
              <ul className={styles.bullets}>{letter.patterns.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}
          {letter.from_notes.length > 0 && (
            <div>
              <h3>{t('rd.fromNotes')}</h3>
              <ul className={styles.bullets}>
                {letter.from_notes.map((n, i) => (
                  <li key={i}><b>{n.book}:</b> {n.idea}</li>
                ))}
              </ul>
            </div>
          )}
          {letter.next_reads.length > 0 && (
            <div>
              <h3>{t('rd.nextReads')}</h3>
              <ul className={styles.bullets}>
                {letter.next_reads.map((n, i) => (
                  <li key={i}>
                    <b>«{n.title}»</b>{n.author ? `, ${n.author}` : ''} — {n.why}{' '}
                    <Link className={store.link} to={`/books?q=${encodeURIComponent(n.title)}`}>{t('rd.findInLibrary')} →</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {letter.question && (
            <div>
              <h3>{t('rd.question')}</h3>
              <p className={styles.question}>{letter.question}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function BookLetterBlock({ volumeKey, aiAvailable }: { volumeKey: string; aiAvailable: boolean }) {
  const { t } = useI18n();
  const { digest, error, start, starting } = useDigest('book', volumeKey);
  const letter = digest?.status === 'done' ? (digest.content as BookLetter | null) : null;
  if (!aiAvailable && !letter) return null;
  return (
    <div style={{ marginTop: 10 }}>
      {!letter && digest?.status !== 'working' && (
        <button type="button" className={store.ghost} onClick={() => start(false)} disabled={starting}>✦ {t('rd.bookAi')}</button>
      )}
      {digest?.status === 'working' && <Working />}
      {digest?.status === 'error' && <LetterError code="failed" />}
      <LetterError code={error} />
      {letter && (
        <div className={styles.letter} style={{ marginTop: 10, marginBottom: 0 }}>
          <div className={styles.letterBody}>
            <p className={styles.prose}>{letter.summary}</p>
            {letter.key_ideas.length > 0 && (
              <div>
                <h3>{t('rd.keyIdeas')}</h3>
                <ul className={styles.bullets}>{letter.key_ideas.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
            {letter.moments.length > 0 && (
              <div>
                <h3>{t('rd.moments')}</h3>
                <ul className={styles.bullets}>{letter.moments.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
            {letter.connections.length > 0 && (
              <div>
                <h3>{t('rd.connections')}</h3>
                <ul className={styles.bullets}>{letter.connections.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
            {letter.question && <p className={styles.question}>{letter.question}</p>}
            <div>
              <button type="button" className={store.ghost} onClick={() => start(true)} disabled={starting}>{t('rd.letterAgain')}</button>
              {digest?.stale && <span className={store.formNote}> {t('rd.letterStale')}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- the recap ----------

function MinutesChart({ data, period }: { data: ReadingOverview; period: string }) {
  const { t, locale } = useI18n();
  const units = data.units;
  const peak = Math.max(1, ...units.map((u) => u.minutes));
  const peakIndex = units.findIndex((u) => u.minutes === peak);
  const kind = period === 'all' ? 'year' : period.length === 4 ? 'month' : 'day';
  const label = (key: string, style: 'short' | 'long') => {
    if (kind === 'year') return key;
    if (kind === 'month') return monthName(Number(key.slice(5, 7)), t, style);
    return style === 'long' ? formatDay(key, locale) : String(Number(key.slice(8, 10)));
  };
  const showTick = (i: number) => kind !== 'day' || i === 0 || (i + 1) % 5 === 0;
  const columns = { gridTemplateColumns: `repeat(${units.length}, minmax(0, 1fr))` };
  const title = t(kind === 'year' ? 'rd.byYear' : kind === 'month' ? 'rd.byMonth' : 'rd.byDay');
  return (
    <section className={styles.card}>
      <h2>{title}</h2>
      {data.best_day && (
        <p className={styles.cardNote}>{t('rd.bestDay', { date: formatDay(data.best_day.date, locale), min: data.best_day.minutes })}</p>
      )}
      <div className={styles.chart} style={columns} role="img" aria-label={title}>
        {units.map((u, i) => (
          <div key={u.key} className={styles.col} tabIndex={u.minutes || u.books ? 0 : -1}>
            <div className={styles.bar} style={{ height: `${(u.minutes / peak) * 100}%` }} />
            {i === peakIndex && u.minutes > 0 && <span className={styles.peak}>{t('rd.minutesN', { n: u.minutes })}</span>}
            <span className={styles.tip}>
              <b>{label(u.key, 'long')}</b>
              <br />
              {t('rd.minutesN', { n: u.minutes })}
              {u.books > 0 && <> · {t('rd.booksN', { n: u.books })}</>}
            </span>
          </div>
        ))}
      </div>
      <div className={styles.ticks} style={columns} aria-hidden="true">
        {units.map((u, i) => (
          <span key={u.key}>{showTick(i) ? label(u.key, 'short') : ''}</span>
        ))}
      </div>
      <table className={styles.srOnly}>
        <tbody>
          {units.map((u) => (
            <tr key={u.key}>
              <th>{label(u.key, 'long')}</th>
              <td>{u.minutes}</td>
              <td>{u.books}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Recap({ onOpenBook }: { onOpenBook: (key: string) => void }) {
  const { t, locale } = useI18n();
  const count = useCount();
  const [params, setParams] = useSearchParams();
  const period = params.get('period') ?? String(new Date().getFullYear());
  const [data, setData] = useState<ReadingOverview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setData(null);
    apiGet<ReadingOverview>(`/reading/overview?period=${period}`, { requireAuth: true }).then(({ data: next }) => {
      if (next) setData(next);
      else setFailed(true);
    });
  }, [period]);

  const setPeriod = (next: string) => {
    const p = new URLSearchParams(params);
    p.set('period', next);
    setParams(p, { replace: true });
  };

  const year = period === 'all' ? null : Number(period.slice(0, 4));
  const month = period.length === 7 ? Number(period.slice(5, 7)) : null;
  const years = data?.years.length ? data.years : year ? [year] : [];

  if (failed) return <p className={store.state}>{t('rd.loadError')}</p>;

  return (
    <div className={styles.wrap}>
      <div className={styles.periods}>
        <div className={store.chips} style={{ margin: 0 }} role="group" aria-label={t('rd.periodLabel')}>
          <button type="button" className={store.chip} aria-pressed={period === 'all'} onClick={() => setPeriod('all')}>{t('rd.all')}</button>
          {[...years].reverse().map((y) => (
            <button key={y} type="button" className={store.chip} aria-pressed={year === y} onClick={() => setPeriod(String(y))}>{y}</button>
          ))}
        </div>
        {year && data && data.months.length > 0 && (
          <div className={store.chips} style={{ margin: 0 }}>
            <button type="button" className={store.chip} aria-pressed={month === null} onClick={() => setPeriod(String(year))}>{t('rd.wholeYear')}</button>
            {data.months.map((m) => (
              <button key={m} type="button" className={store.chip} aria-pressed={month === m} onClick={() => setPeriod(`${year}-${String(m).padStart(2, '0')}`)}>
                {monthName(m, t)}
              </button>
            ))}
          </div>
        )}
      </div>

      {!data ? (
        <p className={store.state}>{t('cat.loading')}</p>
      ) : (
        <>
          <div className={styles.tiles}>
            <div className={styles.tile}><strong>{Math.round(data.minutes / 60)}</strong><span>{t('rd.hours')}</span></div>
            <div className={styles.tile}><strong>{data.days_read}</strong><span>{t('rd.days')}</span></div>
            <div className={styles.tile}><strong>{data.books.length}</strong><span>{t('rd.books')}</span></div>
            <div className={styles.tile}><strong>{data.longest_streak}</strong><span>{t('rd.streak')}</span></div>
            {data.avg_rating !== null && (
              <div className={styles.tile}><strong>{data.avg_rating.toFixed(1)}</strong><span>{t('rd.avgMark')} · {count('votes', data.rated_count)}</span></div>
            )}
          </div>

          <PeriodLetterCard scope={period} aiAvailable={data.ai_available} />

          <div className={styles.grid2}>
            <MinutesChart data={data} period={period} />
            <section className={styles.card}>
              <h2>{t('rd.topics')}</h2>
              {data.topics.length === 0 ? (
                <p className={styles.cardNote}>{t('rd.topicsEmpty')}</p>
              ) : (
                <ul className={styles.topicList}>
                  {data.topics.slice(0, 7).map((tp) => (
                    <li key={tp.key} className={styles.topicRow}>
                      <span>{t(`topics.${tp.key}`)}</span>
                      <b>{tp.share}% · {tp.count}</b>
                      <span className={styles.topicTrack}><span style={{ width: `${Math.max(3, tp.share)}%` }} /></span>
                    </li>
                  ))}
                </ul>
              )}
              {data.authors.length > 0 && (
                <>
                  <h2 style={{ marginTop: 18 }}>{t('rd.authors')}</h2>
                  <div className={styles.authors}>
                    {data.authors.map((a) => (
                      <span key={a.name}>{a.name} · {a.count}</span>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>

          <section className={styles.card}>
            <h2>{t('rd.booksTitle')}</h2>
            {data.books.length === 0 ? (
              <p className={styles.cardNote}>{t('rd.noBooks')}</p>
            ) : (
              <div className={store.strip} style={{ marginTop: 12 }}>
                {data.books.map((b) => (
                  <button key={b.key} type="button" className={store.stripItem} onClick={() => b.work_key && onOpenBook(b.work_key)}>
                    <BookFace title={b.title} author={b.author} cover={b.cover_url}>
                      {b.rating !== null && <span className={store.faceBadges}><PbBadge value={b.rating} /></span>}
                    </BookFace>
                    <span className={store.labelTitle}>{b.title}</span>
                    <span className={store.labelMeta}>{formatDay(b.finished_on, locale)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Recommendations({ onOpenBook }: { onOpenBook: (key: string) => void }) {
  const { t } = useI18n();
  const count = useCount();
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  useEffect(() => {
    apiGet<Recommendation[]>('/reading/recommendations?limit=18', { requireAuth: true }).then(({ data }) => setRecs(data ?? []));
  }, []);
  if (!recs) return <p className={store.state}>{t('cat.loading')}</p>;
  if (recs.length === 0) return <p className={store.state}>{t('rd.recsEmpty')}</p>;
  return (
    <>
      <p className={store.subtitle} style={{ marginBottom: 16 }}>{recs[0].reason === 'popular' ? t('rd.recsPopular') : t('rd.recsIntro')}</p>
      <div className={store.strip}>
        {recs.map((r) => (
          <button key={r.book.key} type="button" className={store.stripItem} onClick={() => onOpenBook(r.book.key)}>
            <BookFace title={r.book.title} author={r.book.author} cover={r.book.cover_thumb_url ?? r.book.cover_url}>
              <span className={store.faceBadges}>
                {r.book.pb_rating !== null && <PbBadge value={r.book.pb_rating} />}
                {r.book.ext_rating !== null && <ExtBadge rating={r.book.ext_rating} source={r.book.ext_source} />}
              </span>
              {r.book.for_sale > 0 && <span className={store.saleDot}>₸</span>}
            </BookFace>
            <span className={store.labelTitle}>{r.book.title}</span>
            {r.book.author && <span className={store.labelAuthor}>{r.book.author}</span>}
            <span className={styles.reason}>
              {r.because_title && r.shared_readers > 0
                ? t('rd.because', { title: r.because_title, n: r.shared_readers })
                : count('readers', r.book.readers)}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function notesMarkdown(entries: NotebookEntry[], t: (key: string) => string, locale: Locale): string {
  const lines = [`# ${t('rd.tabNotes')}`, ''];
  entries.forEach((e) => {
    lines.push(`## ${e.title}${e.author ? ` — ${e.author}` : ''}`);
    if (e.finished_on) lines.push(`*${formatDay(e.finished_on, locale)}*${e.rating ? ` · ${e.rating}/10` : ''}`);
    lines.push('');
    if (e.comment) lines.push(`**${t('rd.finishedWith')}:**`, '', e.comment, '');
    if (e.review) lines.push(`**${t('rd.myReview')}:**`, '', e.review, '');
    if (e.notes.length) {
      lines.push(`**${t('rd.shelfNotes')}:**`, '');
      e.notes.forEach((n) => lines.push(`- ${formatDay(n.created_at, locale)}: ${n.text.replace(/\n/g, '\n  ')}`));
      lines.push('');
    }
  });
  return lines.join('\n');
}

function Notebook({ aiAvailable, focus }: { aiAvailable: boolean; focus: string | null }) {
  const { t, locale } = useI18n();
  const [entries, setEntries] = useState<NotebookEntry[] | null>(null);
  useEffect(() => {
    apiGet<NotebookEntry[]>('/reading/notebook', { requireAuth: true }).then(({ data }) => setEntries(data ?? []));
  }, []);
  // Opened from a book on the shelf: that book first.
  const ordered = useMemo(() => {
    if (!entries || !focus) return entries;
    return [...entries].sort((a, b) => (b.key === focus ? 1 : 0) - (a.key === focus ? 1 : 0));
  }, [entries, focus]);

  const download = () => {
    if (!entries) return;
    const blob = new Blob([notesMarkdown(entries, t, locale)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'powerbook-notes.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!ordered) return <p className={store.state}>{t('cat.loading')}</p>;
  return (
    <>
      <div className={store.head} style={{ alignItems: 'center' }}>
        <p className={store.subtitle} style={{ margin: 0 }}>{t('rd.notesIntro')}</p>
        {ordered.length > 0 && <button type="button" className={store.ghost} onClick={download}>↓ {t('rd.download')}</button>}
      </div>
      {ordered.length === 0 ? (
        <p className={store.state}>{t('rd.notesEmpty')}</p>
      ) : (
        <div className={styles.notebook}>
          {ordered.map((e) => (
            <article key={e.key} className={styles.entry} id={`note-${e.key}`}>
              <BookFace title={e.title} author={e.author} cover={e.cover_url} />
              <div style={{ minWidth: 0 }}>
                <h3>{e.title}</h3>
                <p className={styles.entryMeta}>
                  {[e.author, formatDay(e.finished_on, locale)].filter(Boolean).join(' · ')}
                  {e.rating !== null && <> · <PbBadge value={e.rating} /></>}
                </p>
                {e.comment && (
                  <blockquote className={styles.quote}>
                    {e.comment}
                    <cite>{t('rd.finishedWith')}{e.comment_private ? ` · ${t('rd.private')}` : ''}</cite>
                  </blockquote>
                )}
                {e.review && (
                  <blockquote className={styles.quote}>
                    {e.review}
                    <cite>{t('rd.myReview')}</cite>
                  </blockquote>
                )}
                {e.notes.map((n) => (
                  <blockquote key={n.id} className={styles.quote}>
                    {n.text}
                    <cite>{formatDay(n.created_at, locale)}</cite>
                  </blockquote>
                ))}
                <BookLetterBlock volumeKey={e.key} aiAvailable={aiAvailable} />
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

/** A reader's reading looked back on: numbers and topics, what to read next, and every note in one place. */
export function ReadingPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'recap';
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [aiAvailable, setAiAvailable] = useState(false);

  // Whether Claude is switched on, for the notebook's buttons.
  useEffect(() => {
    apiGet<ReadingOverview>('/reading/overview?period=all', { requireAuth: true }).then(({ data }) => setAiAvailable(!!data?.ai_available));
  }, []);

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };

  return (
    <div className={store.page}>
      <Header />
      <main className={store.main}>
        <Container>
          <div className={store.head}>
            <div>
              <h1 className={store.title}>
                <LibrarySwitch current="reading" />
              </h1>
              <p className={store.subtitle}>{t('rd.subtitle')}</p>
            </div>
          </div>
          <div className={store.controls}>
            <div className={store.segment} role="tablist">
              {(['recap', 'recs', 'notes'] as Tab[]).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>
                  {t(k === 'recap' ? 'rd.tabRecap' : k === 'recs' ? 'rd.tabRecs' : 'rd.tabNotes')}
                </button>
              ))}
            </div>
          </div>
          {tab === 'recap' && <Recap onOpenBook={setOpenKey} />}
          {tab === 'recs' && <Recommendations onOpenBook={setOpenKey} />}
          {tab === 'notes' && <Notebook aiAvailable={aiAvailable} focus={params.get('book')} />}
        </Container>
      </main>
      {openKey && <WorkSheet workKey={openKey} onClose={() => setOpenKey(null)} />}
    </div>
  );
}
