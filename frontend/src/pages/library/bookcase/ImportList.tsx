import { useState } from 'react';
import { apiPost, track, useI18n } from '@/shared/lib';
import styles from './Bookcase.module.css';
import s from './ImportList.module.css';

/**
 * «Вставить список» (the founder, 2026-10-23): the books a reader has read, pasted as text — a note on the phone, a
 * Telegram message — and the ones missing from the shelf go on it. The list is checked first and shown as it was
 * read: what will be added, what is already on the shelf, what came twice; a line read wrong is unticked
 * (app/services/book_import.py).
 */

type Item = { n: number; line: string; title: string; author: string | null; status: 'add' | 'have' | 'dup'; known: boolean };
type Result = { items: Item[]; added: number };

export function ImportList({ onDone }: { onDone: (added: number) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
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
    track('shelf_import_check', { lines: data.items.length, add: data.items.filter((i) => i.status === 'add').length });
  };

  const add = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { data } = await apiPost<Result>(
      '/library/read/import', { text, apply: true, skip: [...skip] }, { requireAuth: true },
    );
    setBusy(false);
    if (!data) {
      setError(t('shelf.importError'));
      return;
    }
    track('shelf_import_add', { added: data.added });
    setText('');
    setItems(null);
    onDone(data.added);
  };

  const toAdd = items?.filter((i) => i.status === 'add' && !skip.has(i.n)).length ?? 0;
  const toggle = (n: number) => setSkip((was) => {
    const next = new Set(was);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    return next;
  });

  return (
    <div className={styles.sheetSection}>
      <h3>{t('shelf.importTitle')}</h3>
      <p>{t('shelf.importText')}</p>
      {items === null ? (
        <>
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
            <ul className={s.list}>
              {items.map((i) => {
                const on = i.status === 'add' && !skip.has(i.n);
                return (
                  <li key={i.n} className={i.status === 'add' ? undefined : s.quiet}>
                    <label className={s.row}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={i.status !== 'add'}
                        onChange={() => toggle(i.n)}
                      />
                      <span className={s.book}>
                        <span className={s.title}>{i.title}</span>
                        {i.author && <span className={s.author}>{i.author}</span>}
                      </span>
                      <span className={s.tag}>
                        {i.status === 'have' ? t('shelf.importHave') : i.status === 'dup' ? t('shelf.importDup') : i.known ? t('shelf.importKnown') : ''}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {error && <p className={styles.formError}>{error}</p>}
          <div className={styles.sheetRow}>
            <button type="button" className={styles.ghostButton} onClick={() => setItems(null)} disabled={busy}>
              {t('shelf.importBack')}
            </button>
            <button type="button" className={styles.addButton} onClick={add} disabled={busy || toAdd === 0}>
              {t('shelf.importAdd', { n: toAdd })}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
