import { FormEvent, useEffect, useState } from 'react';
import { apiDelete, apiPut, useI18n, type ShelfReview } from '@/shared/lib';
import { MarkPicker } from './bookUi';
import styles from './Store.module.css';

type Props = {
  /** The book on the reader's own shelf: marks are given from there. */
  volumeKey: string;
  rating: number | null;
  text: string | null;
  reviewId: string | null;
  onSaved: (review: { id: string; rating: number; text: string | null } | null) => void;
};

/** The reader's mark out of ten and a few words, given on their own shelf. */
export function MarkForm({ volumeKey, rating, text, reviewId, onSaved }: Props) {
  const { t } = useI18n();
  const [value, setValue] = useState<number | null>(rating);
  const [draft, setDraft] = useState(text ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The mark as the server has it now (another book, or this one just saved).
  useEffect(() => {
    setValue(rating);
    setDraft(text ?? '');
  }, [volumeKey, rating, text]);
  // Another book in hand: nothing saved or failed about it yet.
  useEffect(() => {
    setError(null);
    setSaved(false);
  }, [volumeKey]);

  const dirty = value !== rating || draft.trim() !== (text ?? '').trim();

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    const { data, error: failed } = await apiPut<ShelfReview>(
      '/books/reviews',
      { volume_key: volumeKey, rating: value, text: draft.trim() || null },
      { requireAuth: true }
    );
    setBusy(false);
    if (failed || !data) return setError(t('work.saveError'));
    setSaved(true);
    onSaved({ id: data.id, rating: data.rating, text: data.text });
  };

  const remove = async () => {
    if (!reviewId || busy || !window.confirm(t('work.confirmRemove'))) return;
    setBusy(true);
    const { error: failed } = await apiDelete(`/books/reviews/${reviewId}`, { requireAuth: true });
    setBusy(false);
    if (failed) return setError(t('work.saveError'));
    onSaved(null);
  };

  return (
    <form className={styles.markBox} onSubmit={save}>
      <h3>{t('work.yourMark')}</h3>
      <p className={styles.markHint}>{t('work.scaleHint')}</p>
      <MarkPicker value={value} onChange={(n) => { setValue(n); setSaved(false); }} disabled={busy} />
      <textarea
        className={styles.field}
        rows={3}
        maxLength={5000}
        placeholder={t('work.reviewPlaceholder')}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setSaved(false); }}
        aria-label={t('work.reviewPlaceholder')}
      />
      <div className={styles.formRow}>
        <button type="submit" className={styles.primary} disabled={busy || !value || !dirty}>
          {t('work.save')}
        </button>
        {reviewId && (
          <button type="button" className={`${styles.ghost} ${styles.danger}`} onClick={remove} disabled={busy}>
            {t('work.removeMark')}
          </button>
        )}
        {saved && !dirty ? <span className={styles.formOk}>{t('work.saved')}</span> : <span className={styles.formNote}>{t('work.rateHint')}</span>}
      </div>
      {error && <p className={styles.formError} role="alert">{error}</p>}
    </form>
  );
}
