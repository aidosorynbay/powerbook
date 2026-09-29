import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDelete, apiGet, apiPatch, apiPost, resizeImageToDataUrl, useAuth, useI18n, type Listing } from '@/shared/lib';
import { Avatar } from '@/shared/ui';
import { BookFace, PbBadge, Sheet, apiUrl, formatDay, formatPrice } from './bookUi';
import styles from './Store.module.css';

const CONDITIONS = ['new', 'like_new', 'good', 'fair'] as const;

/** Digits only, for tel: and wa.me links; a Kazakh number written 8 7xx becomes +7 7xx. */
function phoneDigits(contact: string | null): string | null {
  if (!contact) return null;
  let digits = contact.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits;
}

export function statusPill(status: Listing['status']): string {
  if (status === 'reserved') return `${styles.pill} ${styles.pillWarn}`;
  if (status === 'sold') return `${styles.pill} ${styles.pillDone}`;
  return styles.pill;
}

type SheetProps = {
  listingId: string;
  onClose: () => void;
  onEdit: (listing: Listing) => void;
  onChanged: () => void;
};

/** One book for sale: its price, its state, and how to reach the seller. */
export function ListingSheet({ listingId, onClose, onEdit, onChanged }: SheetProps) {
  const { t, locale } = useI18n();
  const [listing, setListing] = useState<Listing | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setListing(null);
    apiGet<Listing>(`/market/${listingId}`, { requireAuth: true }).then(({ data }) => {
      if (data) setListing(data);
      else setFailed(true);
    });
  }, [listingId]);

  const setStatus = async (status: Listing['status']) => {
    if (!listing || busy) return;
    setBusy(true);
    const { data } = await apiPatch<Listing>(`/market/${listing.id}`, { status }, { requireAuth: true });
    setBusy(false);
    if (data) {
      setListing(data);
      onChanged();
    }
  };

  const remove = async () => {
    if (!listing || busy || !window.confirm(t('mkt.confirmDelete', { title: listing.title }))) return;
    setBusy(true);
    const { error } = await apiDelete(`/market/${listing.id}`, { requireAuth: true });
    setBusy(false);
    if (!error) {
      onChanged();
      onClose();
    }
  };

  const phone = phoneDigits(listing?.contact ?? null);
  const cover = listing ? listing.photo_url ?? listing.cover_url : null;

  return (
    <Sheet label={listing?.title ?? ''} onClose={onClose}>
      {!listing && !failed && <p className={styles.state}>{t('cat.loading')}</p>}
      {failed && <p className={styles.state}>{t('work.loadError')}</p>}
      {listing && (
        <>
          <div className={styles.hero}>
            <BookFace title={listing.title} author={listing.author} cover={cover} />
            <div>
              <h2 className={styles.heroTitle}>{listing.title}</h2>
              {listing.author && <p className={styles.heroAuthor}>{listing.author}</p>}
              <p className={styles.priceBig}>{formatPrice(listing.price, locale, t('mkt.free'))}</p>
              <p className={styles.heroMeta}>
                <span className={styles.pill}>{t(`mkt.cond.${listing.condition}`)}</span>
                {listing.status !== 'active' && <span className={statusPill(listing.status)}>{t(`mkt.status.${listing.status}`)}</span>}
                {listing.city && <span>{listing.city}</span>}
                <span>{formatDay(listing.created_at, locale)}</span>
              </p>
            </div>
          </div>

          {listing.note && (
            <section className={styles.section}>
              <p>{listing.note}</p>
            </section>
          )}

          <section className={styles.section}>
            <h3>{t('mkt.seller')}</h3>
            <Link className={styles.seller} to={`/readers/${listing.seller.user_id}`}>
              <Avatar src={listing.seller.avatar_data} name={listing.seller.display_name} size="md" />
              <span>
                <strong>{listing.seller.display_name}</strong>
                <span>{t('mkt.profile')} →</span>
              </span>
            </Link>
            {!listing.is_mine && (
              <div className={styles.contacts}>
                {listing.seller.telegram && (
                  <a className={`${styles.primary} ${styles.telegram}`} href={`https://t.me/${listing.seller.telegram}`} target="_blank" rel="noopener noreferrer">
                    {t('mkt.writeTelegram')}
                  </a>
                )}
                {phone && (
                  <a className={`${styles.primary} ${styles.whatsapp}`} href={`https://wa.me/${phone}`} target="_blank" rel="noopener noreferrer">
                    {t('mkt.whatsapp')}
                  </a>
                )}
                {phone && (
                  <a className={styles.ghost} href={`tel:+${phone}`}>
                    {t('mkt.call')} · {listing.contact}
                  </a>
                )}
                {!phone && listing.contact && <span className={styles.ghost}>{listing.contact}</span>}
                {!listing.seller.telegram && !listing.contact && <p className={styles.formNote}>{t('mkt.noContacts')}</p>}
              </div>
            )}
          </section>

          {listing.work_key && (
            <section className={styles.section}>
              <Link className={styles.offer} to={`/books?book=${encodeURIComponent(listing.work_key)}`}>
                <span>{t('mkt.aboutBook')}</span>
                {listing.pb_rating !== null && <PbBadge value={listing.pb_rating} />}
                {listing.ext_rating !== null && <span className={styles.formNote}>★ {listing.ext_rating.toFixed(1)}</span>}
                <span aria-hidden="true" style={{ flex: 'none' }}>→</span>
              </Link>
            </section>
          )}

          {listing.is_mine && (
            <div className={styles.ownerTools}>
              <button type="button" className={styles.ghost} onClick={() => onEdit(listing)} disabled={busy}>{t('mkt.edit')}</button>
              {listing.status === 'active' && (
                <button type="button" className={styles.ghost} onClick={() => setStatus('reserved')} disabled={busy}>{t('mkt.markReserved')}</button>
              )}
              {listing.status !== 'sold' && (
                <button type="button" className={styles.ghost} onClick={() => setStatus('sold')} disabled={busy}>{t('mkt.markSold')}</button>
              )}
              {listing.status !== 'active' && (
                <button type="button" className={styles.ghost} onClick={() => setStatus('active')} disabled={busy}>{t('mkt.markActive')}</button>
              )}
              {listing.status !== 'hidden' && listing.status !== 'sold' && (
                <button type="button" className={styles.ghost} onClick={() => setStatus('hidden')} disabled={busy}>{t('mkt.hide')}</button>
              )}
              <button type="button" className={`${styles.ghost} ${styles.danger}`} onClick={remove} disabled={busy}>{t('mkt.delete')}</button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

type FormProps = {
  /** Editing this one; otherwise a new listing. */
  listing?: Listing | null;
  prefill?: { volumeKey: string | null; title: string; author: string | null };
  onClose: () => void;
  onSaved: (listing: Listing, created: boolean) => void;
};

/** Put a book up for sale, or change what is already up. */
export function SellSheet({ listing, prefill, onClose, onSaved }: FormProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(listing?.title ?? prefill?.title ?? '');
  const [author, setAuthor] = useState(listing?.author ?? prefill?.author ?? '');
  const [price, setPrice] = useState(listing ? String(listing.price) : '');
  const [condition, setCondition] = useState<Listing['condition']>(listing?.condition ?? 'good');
  const [city, setCity] = useState(() => {
    if (listing) return listing.city ?? '';
    try {
      return localStorage.getItem('pb.marketCity') ?? '';
    } catch {
      return '';
    }
  });
  const [contact, setContact] = useState(() => {
    if (listing) return listing.contact ?? '';
    try {
      return localStorage.getItem('pb.marketContact') ?? '';
    } catch {
      return '';
    }
  });
  const [note, setNote] = useState(listing?.note ?? '');
  const [photo, setPhoto] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const telegram = user?.telegram_id?.replace(/^@/, '') ?? null;
  const shownPhoto = photo ?? (removePhoto ? null : apiUrl(listing?.photo_url));

  const pickPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhoto(await resizeImageToDataUrl(file, 900, 0.8));
      setRemovePhoto(false);
    } catch {
      setError(t('mkt.errPhoto'));
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(price.replace(/\s/g, ''));
    if (!title.trim() || !Number.isFinite(amount) || amount < 0 || busy) {
      setError(t('mkt.error'));
      return;
    }
    // Buyers reach the seller on this number, so it has to be one.
    const digits = contact.replace(/\D/g, '').length;
    if (digits < 10 || digits > 15) {
      setError(t('mkt.errPhone'));
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      title: title.trim(),
      author: author.trim() || null,
      price: Math.round(amount),
      condition,
      city: city.trim() || null,
      contact: contact.trim(),
      note: note.trim() || null,
      ...(photo ? { photo } : {}),
    };
    const { data, error: failed } = listing
      ? await apiPatch<Listing>(`/market/${listing.id}`, { ...body, remove_photo: removePhoto && !photo }, { requireAuth: true })
      : await apiPost<Listing>('/market', { ...body, volume_key: prefill?.volumeKey ?? null }, { requireAuth: true });
    setBusy(false);
    if (!data) {
      const known: Record<string, string> = {
        too_many_listings: 'mkt.errTooMany',
        bad_photo: 'mkt.errPhoto',
        photo_too_large: 'mkt.errPhoto',
        bad_phone: 'mkt.errPhone',
      };
      setError(t(known[failed ?? ''] ?? 'mkt.error'));
      return;
    }
    try {
      if (body.city) localStorage.setItem('pb.marketCity', body.city);
      if (body.contact) localStorage.setItem('pb.marketContact', body.contact);
    } catch {
      // remembered next time only when storage allows
    }
    onSaved(data, !listing);
  };

  return (
    <Sheet label={listing ? t('mkt.formEdit') : t('mkt.formTitle')} onClose={onClose}>
      <form className={styles.form} onSubmit={submit}>
        {prefill?.volumeKey && !listing && <span className={styles.fromShelf}>✓ {t('mkt.fromShelf')}</span>}
        <label>
          {t('mkt.fTitle')}
          <input className={styles.field} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          {t('mkt.fAuthor')}
          <input className={styles.field} value={author} maxLength={200} onChange={(e) => setAuthor(e.target.value)} />
        </label>
        <div className={styles.formGrid}>
          <label>
            {t('mkt.fPrice')}
            <input className={styles.field} value={price} inputMode="numeric" placeholder="3000" onChange={(e) => setPrice(e.target.value.replace(/[^\d\s]/g, ''))} required />
          </label>
          <label>
            {t('mkt.condition')}
            <select className={styles.field} value={condition} onChange={(e) => setCondition(e.target.value as Listing['condition'])}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>{t(`mkt.cond.${c}`)}</option>
              ))}
            </select>
          </label>
          <label>
            {t('mkt.fCity')}
            <input className={styles.field} value={city} maxLength={80} placeholder="Алматы" onChange={(e) => setCity(e.target.value)} />
          </label>
          <label>
            {t('mkt.fContact')}
            <input
              className={styles.field}
              value={contact}
              maxLength={120}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+7 7xx xxx xx xx"
              onChange={(e) => setContact(e.target.value)}
              required
            />
          </label>
        </div>
        <p className={styles.formNote} style={{ margin: 0 }}>
          {telegram ? t('mkt.fContactHint', { tg: telegram }) : t('mkt.fContactHintNoTg')}
        </p>
        <label>
          {t('mkt.fNote')}
          <textarea className={styles.field} rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div>
          <span className={styles.formNote}>{t('mkt.fPhoto')}</span>
          <div className={styles.photoRow} style={{ marginTop: 6 }}>
            <span className={styles.photoPreview}>{shownPhoto && <img src={shownPhoto} alt="" />}</span>
            <button type="button" className={styles.ghost} onClick={() => fileInput.current?.click()}>{t('mkt.fPhotoAdd')}</button>
            {shownPhoto && (
              <button type="button" className={styles.ghost} onClick={() => { setPhoto(null); setRemovePhoto(true); }}>{t('mkt.fPhotoRemove')}</button>
            )}
          </div>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={pickPhoto} />
        </div>
        {error && <p className={styles.formError} role="alert">{error}</p>}
        <div className={styles.formRow}>
          <button type="submit" className={styles.primary} disabled={busy}>
            {listing ? t('mkt.fSave') : t('mkt.fPublish')}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export { CONDITIONS };
