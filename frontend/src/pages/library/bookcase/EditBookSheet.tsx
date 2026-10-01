import { FormEvent, useRef, useState } from 'react';
import {
  useI18n,
  apiGet,
  apiPut,
  apiDelete,
  apiUploadWithProgress,
  getApiBaseUrl,
  type BookcaseBook,
  type CoverOption,
} from '@/shared/lib';
import { loadImage, paletteFor } from './bookArt';
import { WorkPicker } from './WorkPicker';
import styles from './Bookcase.module.css';

type Props = {
  book: BookcaseBook;
  seed: string;
  onClose: () => void;
  /** Reload the shelf after a change; resolves once it shows. */
  onChanged: (message: string) => Promise<void>;
};

/** A photo scaled down to a JPEG in the browser: the server keeps no image library. */
async function toJpeg(file: File, maxWidth: number): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    if (!img) return null;
    const scale = Math.min(1, maxWidth / img.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Correct a book on your own shelf: its title and author, and its cover —
 * another edition's, a photo of your copy, or the painted one. Changes show
 * only on this reader's shelf.
 */
export function EditBookSheet({ book, seed, onClose, onChanged }: Props) {
  const { t } = useI18n();
  const photoInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author ?? '');
  const [query, setQuery] = useState([book.title, book.author].filter(Boolean).join(' '));
  const [results, setResults] = useState<CoverOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const path = `/library/overrides/${encodeURIComponent(book.key)}`;
  const palette = paletteFor(seed);
  const preview = book.cover_data ?? (book.cover_thumb_url ? `${getApiBaseUrl()}${book.cover_thumb_url}` : null);
  const modeLabel =
    book.cover_mode === 'image'
      ? t('shelf.coverCustom')
      : book.cover_mode === 'none' || !preview
        ? t('shelf.coverPainted')
        : t('shelf.coverAuto');

  const run = async (label: string, action: () => Promise<{ error: string | null }>, done: string) => {
    setBusy(label);
    setError(null);
    const { error: err } = await action();
    if (err) {
      setError(t(err === 'no_cover' ? 'shelf.pickNoCover' : 'shelf.editError'));
      setBusy(null);
      return;
    }
    await onChanged(done);
    setBusy(null);
    onClose();
  };

  const saveText = (e: FormEvent) => {
    e.preventDefault();
    void run(
      'text',
      () => apiPut(path, { title: title.trim() || null, author: author.trim() || null }, { requireAuth: true }),
      t('shelf.saved')
    );
  };

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setError(null);
    const { data } = await apiGet<CoverOption[]>(`/library/cover-search?q=${encodeURIComponent(query.trim())}`, {
      requireAuth: true,
    });
    setResults(data ?? []);
    setSearching(false);
  };

  const pick = (option: CoverOption) =>
    run(
      option.volume_id,
      () => apiPut(`${path}/cover`, { mode: 'pick', source: option.source, volume_id: option.volume_id }, { requireAuth: true }),
      t('shelf.saved')
    );

  const onPhoto = async (file: File | undefined) => {
    if (photoInput.current) photoInput.current.value = '';
    if (!file) return;
    await run(
      'photo',
      async () => {
        const [full, thumb] = await Promise.all([toJpeg(file, 900), toJpeg(file, 200)]);
        if (!full || !thumb) return { error: 'bad_photo' };
        const form = new FormData();
        form.append('photo', full, 'cover.jpg');
        form.append('thumb', thumb, 'cover-s.jpg');
        return apiUploadWithProgress(`${path}/photo`, form);
      },
      t('shelf.saved')
    );
  };

  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={t('shelf.editTitle')} onClick={(e) => e.stopPropagation()}>
        <div className={styles.sheetHead}>
          <span className={styles.wordmark}>{t('shelf.editTitle')}</span>
          <button type="button" className={styles.sheetClose} onClick={onClose}>
            {t('shelf.close')}
          </button>
        </div>

        {/* «Какая это книга»: one card for every edition and every file of a book. */}
        <div className={styles.sheetSection}>
          <h3>{t('which.head')}</h3>
          <p>{t('which.hintShort')}</p>
          <WorkPicker
            volumeKey={book.key}
            initialQuery={[book.title, book.author].filter(Boolean).join(' ')}
            pinned={!!book.pinned}
            autoSearch={false}
            onDone={async (message) => {
              await onChanged(message);
              onClose();
            }}
          />
        </div>

        <div className={styles.sheetSection}>
          <h3>{t('shelf.coverHead')}</h3>
          <div className={styles.coverNow}>
            {preview && book.cover_mode !== 'none' ? (
              <img src={preview} alt="" className={styles.coverNowImg} />
            ) : (
              <span className={styles.coverNowPainted} style={{ background: palette.cover, color: palette.ink, borderColor: palette.accent }}>
                {book.title}
              </span>
            )}
            <div className={styles.coverNowText}>
              <span className={styles.fieldLabelText}>{modeLabel}</span>
              <p>{t('shelf.coverHint')}</p>
              <div className={styles.sheetRow}>
                <button type="button" className={styles.addButton} onClick={() => photoInput.current?.click()} disabled={!!busy}>
                  {busy === 'photo' ? t('shelf.working') : t('shelf.uploadPhoto')}
                </button>
                {book.cover_mode !== 'none' && (
                  <button
                    type="button"
                    className={styles.ghostButton}
                    disabled={!!busy}
                    onClick={() => run('none', () => apiPut(`${path}/cover`, { mode: 'none' }, { requireAuth: true }), t('shelf.saved'))}
                  >
                    {t('shelf.noCover')}
                  </button>
                )}
              </div>
            </div>
          </div>
          <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />

          <form className={styles.searchRow} onSubmit={search}>
            <input
              className={styles.field}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('shelf.searchPlaceholder')}
              maxLength={200}
            />
            <button type="submit" className={styles.ghostButton} disabled={searching || !!busy}>
              {searching ? t('shelf.searching') : t('shelf.search')}
            </button>
          </form>
          {results && results.length === 0 && <p className={styles.formNote}>{t('shelf.noResults')}</p>}
          {results && results.length > 0 && (
            <ul className={styles.coverGrid}>
              {results.map((option) => (
                <li key={`${option.source}:${option.volume_id}`}>
                  <button type="button" onClick={() => pick(option)} disabled={!!busy} title={option.title}>
                    <img src={option.thumb_url} alt="" loading="lazy" />
                    <span className={styles.coverGridTitle}>{option.title}</span>
                    {option.author && <span className={styles.coverGridAuthor}>{option.author}</span>}
                    {busy === option.volume_id && <span className={styles.coverGridBusy}>{t('shelf.working')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form className={styles.sheetSection} onSubmit={saveText}>
          <h3>{t('shelf.editTextHead')}</h3>
          <p>{t('shelf.editTextHint')}</p>
          <label className={styles.fieldLabel}>
            <span>{t('shelf.titleLabel')}</span>
            <input className={styles.field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
          </label>
          <label className={styles.fieldLabel}>
            <span>{t('shelf.authorLabel')}</span>
            <input className={styles.field} value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={200} />
          </label>
          <div className={styles.sheetRow}>
            <button type="submit" className={styles.addButton} disabled={!!busy || !title.trim()}>
              {busy === 'text' ? t('shelf.working') : t('shelf.saveText')}
            </button>
          </div>
        </form>

        {error && <p className={styles.formError}>{error}</p>}

        {book.edited && (
          <div className={styles.sheetSection}>
            <button
              type="button"
              className={styles.quietButton}
              disabled={!!busy}
              onClick={() => run('reset', () => apiDelete(path, { requireAuth: true }), t('shelf.saved'))}
            >
              {t('shelf.resetAll')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
