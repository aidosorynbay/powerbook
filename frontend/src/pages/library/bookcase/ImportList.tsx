import { useState } from 'react';
import { apiPost, track, useI18n } from '@/shared/lib';
import styles from './Bookcase.module.css';
import s from './ImportList.module.css';

/**
 * «Вставить список» (the founder, 2026-10-23): the books a reader has read, pasted as text — a note on the phone, a
 * Telegram message — and the ones missing from the shelf go on it. The list is checked first and shown as it was
 * read: what will go on the shelf, what is there already, what came twice. A line read wrong is unticked, or tapped
 * and corrected; what is put on the shelf is the list as the reader left it (app/services/book_import.py).
 */

type Item = { n: number; line: string; title: string; author: string | null; status: 'add' | 'have' | 'dup'; known: boolean };
type Result = { items: Item[]; added: number };

export function ImportList({ onDone }: { onDone: (added: number) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    const { data } = await apiPost<Result>('/library/read/import', { text }, { requireAuth: true });
    setBusy(false);
    if (!data) {
      setError(t('shelf.importError'));
      return;
    }
    setItems(data.items);
    setSkip(new Set());
    setEditing(null);
    track('shelf_import_check', { lines: data.items.length, add: data.items.filter((i) => i.status === 'add').length });
  };

  const kept = (items ?? []).filter((i) => i.status === 'add' && !skip.has(i.n) && i.title.trim());

  const add = async () => {
    if (busy || !kept.length) return;
    setBusy(true);
    setError(null);
    const books = kept.map((i) => ({ title: i.title.trim(), author: i.author?.trim() || null }));
    const { data } = await apiPost<Result>('/library/read/import', { books }, { requireAuth: true });
    setBusy(false);
    if (!data) {
      setError(t('shelf.importError'));
      return;
    }
    track('shelf_import_add', { added: data.added, edited: (items ?? []).filter((i) => i.line !== i.title).length });
    setText('');
    setItems(null);
    onDone(data.added);
  };

  const toggle = (n: number) => setSkip((was) => {
    const next = new Set(was);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    return next;
  });
  const change = (n: number, patch: Partial<Item>) =>
    setItems((was) => was && was.map((i) => (i.n === n ? { ...i, ...patch } : i)));

  const count = (status: Item['status']) => (items ?? []).filter((i) => i.status === status).length;

  return (
    <div className={styles.sheetSection}>
      <h3>{t('shelf.importTitle')}</h3>
      {items === null ? (
        <>
          <p>{t('shelf.importText')}</p>
          <textarea
            className={`${styles.field} ${s.text}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('shelf.importPlaceholder')}
            rows={6}
            maxLength={30000}
          />
          {error && <p className={styles.formError}>{error}</p>}
          <div className={styles.sheetRow}>
            <button type="button" className={styles.addButton} onClick={check} disabled={busy || !text.trim()}>
              {busy ? t('shelf.importChecking') : t('shelf.importCheck')}
            </button>
          </div>
        </>
      ) : (
        <>
          {items.length === 0 ? (
            <p>{t('shelf.importNone')}</p>
          ) : (
            <>
              <p className={s.summary}>
                {t('shelf.importSummary', { n: count('add') })}
                {count('have') > 0 && <> · {t('shelf.importSummaryHave', { n: count('have') })}</>}
                {count('dup') > 0 && <> · {t('shelf.importSummaryDup', { n: count('dup') })}</>}
              </p>
              <p className={s.hint}>{t('shelf.importHint')}</p>
              <ul className={s.list}>
                {items.map((i) => {
                  const open = i.status === 'add';
                  const on = open && !skip.has(i.n);
                  return (
                    <li key={i.n} className={open ? (on ? undefined : s.off) : s.quiet}>
                      <div className={s.row}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          aria-label={i.title}
                          className={s.box}
                          disabled={!open}
                          onClick={() => toggle(i.n)}
                        >
                          {on && (
                            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                              <path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                        {editing === i.n ? (
                          <span className={s.edit}>
                            <input
                              className={styles.field}
                              value={i.title}
                              maxLength={300}
                              autoFocus
                              aria-label={t('profile.bookTitlePlaceholder')}
                              onChange={(e) => change(i.n, { title: e.target.value })}
                              onKeyDown={(e) => { if (e.key === 'Enter') setEditing(null); }}
                            />
                            <input
                              className={styles.field}
                              value={i.author ?? ''}
                              maxLength={200}
                              placeholder={t('profile.bookAuthorPlaceholder')}
                              aria-label={t('profile.bookAuthorPlaceholder')}
                              onChange={(e) => change(i.n, { author: e.target.value })}
                              onKeyDown={(e) => { if (e.key === 'Enter') setEditing(null); }}
                            />
                            <button type="button" className={s.done} onClick={() => setEditing(null)}>{t('shelf.importEditDone')}</button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={s.book}
                            disabled={!open}
                            onClick={() => { setEditing(i.n); setSkip((was) => { const next = new Set(was); next.delete(i.n); return next; }); }}
                          >
                            <span className={s.title}>{i.title || '—'}</span>
                            {i.author && <span className={s.author}>{i.author}</span>}
                          </button>
                        )}
                        {!open && (
                          <span className={s.tag}>{i.status === 'have' ? t('shelf.importHave') : t('shelf.importDup')}</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {error && <p className={styles.formError}>{error}</p>}
          <div className={s.bar}>
            <button type="button" className={styles.addButton} onClick={add} disabled={busy || kept.length === 0}>
              {t('shelf.importAdd', { n: kept.length })}
            </button>
            <button type="button" className={s.back} onClick={() => setItems(null)} disabled={busy}>
              {t('shelf.importBack')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
