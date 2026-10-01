import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { apiDelete, apiPost, resizeImageToDataUrl, track, useI18n, type ExchangePhoto } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import { apiUrl } from '@/pages/books/bookUi';
import styles from './ExchangePhotos.module.css';

// The server keeps photos under 600 KB; a phone picture shrunk to this side fits with room to spare.
const SIDE = 1200;
const MAX_CHARS = 780_000;

const who = (name: string, telegram: string | null) => (telegram ? `@${telegram}` : name);

/** Shrink a phone picture until it fits what the server accepts. */
async function shrink(file: File): Promise<string> {
  let data = await resizeImageToDataUrl(file, SIDE, 0.82);
  if (data.length > MAX_CHARS) data = await resizeImageToDataUrl(file, 900, 0.72);
  return data;
}

/**
 * «Подтвердить с фото», next to the «got the book» tick: a photo of the book in
 * hand confirms the exchange and goes on this page for the circle to see.
 */
export function PhotoConfirm({ pairId, photoUrl, onChanged }: { pairId: string; photoUrl: string | null; onChanged: () => Promise<void> | void }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const photo = await shrink(file);
      const { error: failed } = await apiPost(`/exchange/${pairId}/photo`, { photo }, { requireAuth: true });
      if (failed) {
        setError(t(failed === 'photo_too_large' ? 'results.photoTooLarge' : 'results.photoError'));
      } else {
        track('exchange_confirm', { with_photo: true });
        await onChanged();
      }
    } catch {
      setError(t('results.photoError'));
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!window.confirm(t('results.photoRemoveConfirm'))) return;
    setBusy(true);
    await apiDelete(`/exchange/${pairId}/photo`, { requireAuth: true });
    await onChanged();
    setBusy(false);
  };

  return (
    <div className={styles.confirm}>
      {photoUrl ? (
        <div className={styles.mine}>
          <img src={apiUrl(photoUrl) ?? ''} alt="" className={styles.mineImg} />
          <div className={styles.mineText}>
            <strong>{t('results.photoSent')}</strong>
            <span>{t('results.photoHint')}</span>
            <div className={styles.mineActions}>
              <button type="button" onClick={() => input.current?.click()} disabled={busy}>
                {busy ? t('results.photoUploading') : t('results.photoReplace')}
              </button>
              <button type="button" onClick={remove} disabled={busy}>
                {t('results.photoRemove')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <button type="button" className={styles.confirmBtn} onClick={() => input.current?.click()} disabled={busy}>
            <Icon name="camera" size="em" aria-hidden="true" />
            {busy ? t('results.photoUploading') : t('results.photoConfirm')}
          </button>
          <p className={styles.hint}>{t('results.photoHint')}</p>
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
      {/* No "capture": the reader chooses between the camera and a photo already taken. */}
      <input ref={input} type="file" accept="image/*" hidden onChange={onPick} />
    </div>
  );
}

/** «Как прошёл обмен»: the round's exchange in pictures, each opening full size. */
export function ExchangeGallery({ photos }: { photos: ExchangePhoto[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<ExchangePhoto | null>(null);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);

  if (photos.length === 0) return null;

  return (
    <section className={styles.gallery} aria-labelledby="exchange-gallery-title">
      <h2 id="exchange-gallery-title" className={styles.galleryTitle}>
        <Icon name="camera" size="em" aria-hidden="true" /> {t('results.gallery')}
      </h2>
      <ul className={styles.grid}>
        {photos.map((p) => (
          <li key={p.id}>
            <button type="button" className={styles.tile} onClick={() => setOpen(p)}>
              <img src={apiUrl(p.url) ?? ''} alt={t('results.photoAlt', { giver: who(p.giver_name, p.giver_telegram_id), receiver: who(p.receiver_name, p.receiver_telegram_id) })} loading="lazy" />
              <span className={styles.tileCaption}>
                {who(p.giver_name, p.giver_telegram_id)} → {who(p.receiver_name, p.receiver_telegram_id)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {open &&
        createPortal(
          <div className={styles.viewer} role="dialog" aria-modal="true" aria-label={t('results.gallery')} onClick={() => setOpen(null)}>
            <figure className={styles.viewerFigure} onClick={(e) => e.stopPropagation()}>
              <img src={apiUrl(open.url) ?? ''} alt="" />
              <figcaption>
                <b>
                  {who(open.giver_name, open.giver_telegram_id)} → {who(open.receiver_name, open.receiver_telegram_id)}
                </b>
                {open.caption && <span>{open.caption}</span>}
              </figcaption>
            </figure>
            <button type="button" className={styles.viewerClose} onClick={() => setOpen(null)} aria-label={t('results.photoClose')}>
              ×
            </button>
          </div>,
          document.body
        )}
    </section>
  );
}
