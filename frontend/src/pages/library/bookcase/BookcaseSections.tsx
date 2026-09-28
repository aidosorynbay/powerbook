import { FormEvent, useEffect, useMemo, useState } from 'react';
import { apiDelete, apiPatch, apiPost, apiPut, useI18n, type BookcaseBook, type CustomShelf } from '@/shared/lib';
import { dimensionsFor, loadImage, paletteFor, paletteFromImage, type Palette } from './bookArt';
import type { SceneVolume } from './BookcaseScene';
import styles from './Bookcase.module.css';

// A bookcase always looks like one: short of this many shelves, empty boards fill it out.
const MIN_BOARDS = 5;

type Row = { id: string | null; name: string; books: BookcaseBook[] };

/**
 * Spine colours: the same the 3D shelf paints — taken from the real cover
 * when there is one, otherwise the title's own palette.
 */
function useSpinePalettes(volumes: SceneVolume[]): Record<string, Palette> {
  const [fromCovers, setFromCovers] = useState<Record<string, Palette>>({});
  useEffect(() => {
    let cancelled = false;
    volumes.forEach(({ art }) => {
      if (!art.coverThumb || fromCovers[art.key]) return;
      loadImage(art.coverThumb).then((img) => {
        if (cancelled || !img) return;
        const palette = paletteFromImage(img, paletteFor(art.seed));
        setFromCovers((prev) => ({ ...prev, [art.key]: palette }));
      });
    });
    return () => {
      cancelled = true;
    };
    // Only new books need a look at their cover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volumes]);
  return useMemo(() => {
    const out: Record<string, Palette> = {};
    volumes.forEach(({ art }) => {
      out[art.key] = fromCovers[art.key] ?? paletteFor(art.seed);
    });
    return out;
  }, [volumes, fromCovers]);
}

type SectionsProps = {
  books: BookcaseBook[];
  volumes: SceneVolume[];
  shelves: CustomShelf[];
  isSelf: boolean;
  onInspect: (key: string) => void;
  onPlace: (key: string, shelfId: string | null) => void;
  onManage: () => void;
};

/** The bookcase view: the reader's shelves stacked like a real bookcase. */
export function BookcaseSections({ books, volumes, shelves, isSelf, onInspect, onPlace, onManage }: SectionsProps) {
  const { t } = useI18n();
  const palettes = useSpinePalettes(volumes);
  const [picked, setPicked] = useState<string | null>(null);
  const seeds = useMemo(() => Object.fromEntries(volumes.map((v) => [v.art.key, v.art.seed])), [volumes]);

  const rows: Row[] = useMemo(() => {
    const known = new Set(shelves.map((s) => s.id));
    const list: Row[] = shelves.map((s) => ({ id: s.id, name: s.name, books: books.filter((b) => b.shelf_id === s.id) }));
    const unsorted = books.filter((b) => !b.shelf_id || !known.has(b.shelf_id));
    if (unsorted.length > 0 || shelves.length === 0) list.push({ id: null, name: t('shelf.unsorted'), books: unsorted });
    return list;
  }, [books, shelves, t]);

  const pickedBook = picked ? books.find((b) => b.key === picked) : undefined;
  const fillers = Math.max(0, MIN_BOARDS - rows.length);

  return (
    <div className={styles.sectionsView}>
      {isSelf && (
        <div className={styles.cabToolbar}>
          <button type="button" className={styles.ghostButton} onClick={onManage}>
            {t('shelf.manageShelves')}
          </button>
        </div>
      )}
      <div className={styles.cabinet}>
        <div className={styles.cabinetInner}>
          {rows.map((row) => (
            <section key={row.id ?? 'unsorted'} className={styles.cabShelf} aria-label={row.name}>
              <div className={styles.cabLabel}>
                <span className={row.id ? styles.plate : `${styles.plate} ${styles.plateQuiet}`}>{row.name}</span>
                <span className={styles.cabCount}>{row.books.length}</span>
              </div>
              <div className={styles.cabBooks}>
                {row.books.length === 0 && (
                  <p className={styles.cabEmpty}>
                    {t('shelf.emptyShelf')}
                    {isSelf && ` · ${t('shelf.emptyShelfHint')}`}
                  </p>
                )}
                {row.books.map((b) => {
                  const p = palettes[b.key] ?? paletteFor(seeds[b.key] ?? b.title);
                  const d = dimensionsFor(seeds[b.key] ?? b.title);
                  return (
                    <button
                      key={b.key}
                      type="button"
                      className={[styles.cabSpine, b.has_file ? styles.cabSpineFile : '', picked === b.key ? styles.cabSpinePicked : ''].join(' ')}
                      style={{
                        height: `${Math.round(d.height * 78)}px`,
                        width: `${Math.max(20, Math.round(d.thickness * 100))}px`,
                        background: p.cover,
                        color: p.ink,
                      }}
                      title={b.author ? `${b.title} — ${b.author}` : b.title}
                      aria-pressed={picked === b.key}
                      onClick={() => setPicked(picked === b.key ? null : b.key)}
                    >
                      <span>{b.title}</span>
                    </button>
                  );
                })}
              </div>
              <div className={styles.cabBoard} aria-hidden="true" />
            </section>
          ))}
          {Array.from({ length: fillers }, (_, i) => (
            <section key={`filler-${i}`} className={styles.cabShelf} aria-hidden={!(isSelf && i === 0)}>
              <div className={styles.cabBooks}>
                {isSelf && i === 0 && (
                  <button type="button" className={styles.cabAdd} onClick={onManage}>
                    <span aria-hidden="true">+</span> {t('shelf.newShelf')}
                  </button>
                )}
              </div>
              <div className={styles.cabBoard} aria-hidden="true" />
            </section>
          ))}
        </div>
      </div>

      {pickedBook ? (
        <div className={styles.cabBar} role="region" aria-label={pickedBook.title}>
          <div className={styles.cabBarTitle}>
            <strong>{pickedBook.title}</strong>
            {pickedBook.author && <span>{pickedBook.author}</span>}
          </div>
          {isSelf && (
            <label className={styles.cabBarShelf}>
              <span>{t('shelf.shelfOf')}</span>
              <select
                className={styles.field}
                value={pickedBook.shelf_id && shelves.some((s) => s.id === pickedBook.shelf_id) ? pickedBook.shelf_id : ''}
                onChange={(e) => onPlace(pickedBook.key, e.target.value || null)}
              >
                <option value="">{t('shelf.unsorted')}</option>
                {shelves.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className={styles.addButton} onClick={() => onInspect(pickedBook.key)}>
            {t('shelf.inspect')}
          </button>
        </div>
      ) : (
        <p className={styles.cabHint}>{t('shelf.pickBook')}</p>
      )}
    </div>
  );
}

type SheetProps = {
  shelves: CustomShelf[];
  onClose: () => void;
  onShelves: (next: CustomShelf[], removedId?: string) => void;
};

/** Add, rename, reorder and remove the shelves of the bookcase. */
export function ShelvesSheet({ shelves, onClose, onShelves }: SheetProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presets = t('shelf.shelfPresets')
    .split('|')
    .filter((p) => !shelves.some((s) => s.name.toLowerCase() === p.toLowerCase()));
  const full = shelves.length >= 12;

  const run = async <T,>(call: () => Promise<{ data: T | null; error: string | null }>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    const { data, error: failed } = await call();
    setBusy(false);
    if (failed) {
      setError(t('shelf.editError'));
      return null;
    }
    return data;
  };

  const add = async (value: string) => {
    const clean = value.trim();
    if (!clean || busy || full) return;
    const shelf = await run(() => apiPost<CustomShelf>('/library/shelves', { name: clean }, { requireAuth: true }));
    if (shelf) {
      onShelves([...shelves, shelf]);
      setName('');
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    add(name);
  };

  const rename = async (e: FormEvent, id: string) => {
    e.preventDefault();
    const clean = editName.trim();
    if (!clean) return;
    const shelf = await run(() => apiPatch<CustomShelf>(`/library/shelves/${id}`, { name: clean }, { requireAuth: true }));
    if (shelf) {
      onShelves(shelves.map((s) => (s.id === id ? shelf : s)));
      setEditing(null);
    }
  };

  const move = async (index: number, by: number) => {
    const next = shelves.slice();
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    const saved = await run(() => apiPut<CustomShelf[]>('/library/shelves/order', { ids: next.map((s) => s.id) }, { requireAuth: true }));
    if (saved) onShelves(saved);
  };

  const remove = async (shelf: CustomShelf) => {
    if (!window.confirm(t('shelf.confirmDeleteShelf', { name: shelf.name }))) return;
    const ok = await run(() => apiDelete<{ ok: boolean }>(`/library/shelves/${shelf.id}`, { requireAuth: true }));
    if (ok) onShelves(shelves.filter((s) => s.id !== shelf.id), shelf.id);
  };

  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={t('shelf.shelvesTitle')} onClick={(e) => e.stopPropagation()}>
        <div className={styles.sheetHead}>
          <span className={styles.wordmark}>{t('shelf.shelvesTitle')}</span>
          <button type="button" className={styles.sheetClose} onClick={onClose}>
            {t('shelf.close')}
          </button>
        </div>
        <div className={styles.sheetSection}>
          <p>{t('shelf.shelvesHint')}</p>
          {shelves.length === 0 ? (
            <p className={styles.cabEmpty}>{t('shelf.noShelvesYet')}</p>
          ) : (
            <ol className={styles.shelfList}>
              {shelves.map((s, i) => (
                <li key={s.id} className={styles.shelfRow}>
                  {editing === s.id ? (
                    <form className={styles.shelfEdit} onSubmit={(e) => rename(e, s.id)}>
                      <input className={styles.field} value={editName} maxLength={60} onChange={(e) => setEditName(e.target.value)} autoFocus aria-label={t('shelf.renameShelf')} />
                      <button type="submit" className={styles.addButton} disabled={busy || !editName.trim()}>
                        {t('shelf.saveText')}
                      </button>
                      <button type="button" className={styles.ghostButton} onClick={() => setEditing(null)}>
                        {t('shelf.noteCancel')}
                      </button>
                    </form>
                  ) : (
                    <>
                      <span className={styles.plate}>{s.name}</span>
                      <span className={styles.shelfTools}>
                        <button type="button" onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label={t('shelf.moveUp')} title={t('shelf.moveUp')}>
                          ↑
                        </button>
                        <button type="button" onClick={() => move(i, 1)} disabled={busy || i === shelves.length - 1} aria-label={t('shelf.moveDown')} title={t('shelf.moveDown')}>
                          ↓
                        </button>
                        <button type="button" onClick={() => { setEditing(s.id); setEditName(s.name); }} disabled={busy}>
                          {t('shelf.renameShelf')}
                        </button>
                        <button type="button" onClick={() => remove(s)} disabled={busy}>
                          {t('shelf.deleteShelf')}
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className={styles.sheetSection}>
          <h3>{t('shelf.newShelf')}</h3>
          <form className={styles.shelfEdit} onSubmit={submit}>
            <input
              className={styles.field}
              value={name}
              maxLength={60}
              placeholder={t('shelf.shelfNamePlaceholder')}
              onChange={(e) => setName(e.target.value)}
              disabled={full}
              aria-label={t('shelf.newShelf')}
            />
            <button type="submit" className={styles.addButton} disabled={busy || full || !name.trim()}>
              {t('shelf.addShelf')}
            </button>
          </form>
          {full ? (
            <p className={styles.formNote}>{t('shelf.shelvesLimit')}</p>
          ) : (
            presets.length > 0 && (
              <div className={styles.shelfPresets}>
                <span>{t('shelf.shelfIdeas')}</span>
                {presets.map((p) => (
                  <button key={p} type="button" onClick={() => add(p)} disabled={busy}>
                    {p}
                  </button>
                ))}
              </div>
            )
          )}
          {error && (
            <p className={styles.formError} role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
