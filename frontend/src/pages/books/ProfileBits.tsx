import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, useI18n, type Listing } from '@/shared/lib';
import { BookFace, formatPrice } from './bookUi';
import { statusPill } from './ListingSheet';
import styles from './Store.module.css';

/** A reader's books on the market, on their profile. Nothing at all when they sell nothing. */
export function ProfileListings({ userId, isSelf, titleClass }: { userId: string; isSelf: boolean; titleClass?: string }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<Listing[] | null>(null);
  useEffect(() => {
    apiGet<Listing[]>(`/market/user/${userId}`, { requireAuth: true }).then(({ data }) => setItems(data ?? []));
  }, [userId]);
  const shown = (items ?? []).filter((l) => isSelf || l.status === 'active' || l.status === 'reserved');
  if (!shown.length) return null;
  return (
    <section style={{ margin: '24px 0' }}>
      <div className={styles.head} style={{ alignItems: 'center', marginBottom: 12 }}>
        <h2 className={titleClass} style={titleClass ? undefined : { margin: 0, fontSize: 18 }}>
          {isSelf ? t('mkt.onProfileMine') : t('mkt.onProfile')}
        </h2>
        <Link className={styles.link} to={isSelf ? '/market?tab=mine' : '/market'}>
          {t('mkt.openMarket')} →
        </Link>
      </div>
      <div className={styles.strip}>
        {shown.slice(0, 12).map((l) => (
          <Link key={l.id} to={`/market?listing=${l.id}`} className={styles.stripItem}>
            <BookFace title={l.title} author={l.author} cover={l.photo_url ?? l.cover_thumb_url ?? l.cover_url}>
              {l.status !== 'active' && <span className={styles.soldVeil}>{t(`mkt.status.${l.status}`)}</span>}
            </BookFace>
            <span className={styles.labelTitle}>{l.title}</span>
            <span>
              <span className={`${styles.price} ${l.price <= 0 ? styles.priceFree : ''}`}>{formatPrice(l.price, locale, t('mkt.free'))}</span>
              {l.status !== 'active' && isSelf && <span className={statusPill(l.status)} style={{ marginLeft: 6 }}>{t(`mkt.status.${l.status}`)}</span>}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** The way from the profile to the reading recap. */
export function RecapLink() {
  const { t } = useI18n();
  return (
    <Link to="/reading" className={styles.offer} style={{ padding: '14px 16px', margin: '0 0 16px' }}>
      <span style={{ whiteSpace: 'normal' }}>
        <strong style={{ display: 'block', fontSize: 15 }}>✦ {t('rd.profileCard')}</strong>
        <span className={styles.formNote}>{t('rd.profileCardText')}</span>
      </span>
      <span className={styles.primary} style={{ flex: 'none' }}>{t('rd.open')} →</span>
    </Link>
  );
}
