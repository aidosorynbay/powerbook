import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { apiGet, apiPost, track, useAuth, useI18n, type SiteNotification } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import { formatDay, formatPrice, Sheet } from '@/pages/books/bookUi';
import styles from './Bell.module.css';

// How often the bell asks; it also asks on every page change.
const POLL_MS = 60_000;

/** Where a notification leads, and what it says. */
function useWords() {
  const { t, locale } = useI18n();
  return (n: SiteNotification): { text: string; to: string } => {
    const d = n.data as Record<string, string | number | null>;
    const title = String(d.title ?? '');
    if (n.kind === 'watch_listing') {
      const price = formatPrice(Number(d.price ?? 0), locale, t('mkt.free'));
      return {
        text: t('notif.listing', { title, price, city: d.city ? ` · ${d.city}` : '' }),
        to: `/market?listing=${encodeURIComponent(String(d.listing_id ?? ''))}`,
      };
    }
    if (n.kind === 'watch_finished') {
      return {
        text: t('notif.finished', { reader: String(d.reader ?? ''), title }),
        to: `/books?book=${encodeURIComponent(String(d.work_key ?? ''))}`,
      };
    }
    if (n.kind === 'wanted_by') {
      const author = d.author ? `&author=${encodeURIComponent(String(d.author))}` : '';
      return {
        text: t('notif.wanted', { title, n: Number(d.n ?? 1) }),
        to: `/market?sell=${encodeURIComponent(String(d.volume_key ?? ''))}&title=${encodeURIComponent(title)}${author}`,
      };
    }
    return { text: title, to: '/books' };
  };
}

/**
 * The header bell: what happened with the books the reader watches
 * («Следить за книгой») and who is looking for the books they finished.
 * On the site only for now; the app will push the same things.
 */
export function Bell({ className = '' }: { className?: string }) {
  const { t, locale } = useI18n();
  const { isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  const words = useWords();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SiteNotification[] | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await apiGet<{ count: number }>('/notifications/unread-count', { requireAuth: true });
    if (data) setCount(data.count);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    void refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [isAuthenticated, pathname, refresh]);

  const show = async () => {
    setOpen(true);
    const { data } = await apiGet<SiteNotification[]>('/notifications', { requireAuth: true });
    setItems(data ?? []);
    if (count > 0) {
      await apiPost('/notifications/read', {}, { requireAuth: true });
      setCount(0);
    }
  };

  if (!isAuthenticated) return null;

  return (
    <>
      <button type="button" className={`${styles.bell} ${className}`} onClick={show} aria-label={t('notif.title')} title={t('notif.title')}>
        <Icon name="bell" size="sm" aria-hidden="true" />
        {count > 0 && <span className={styles.badge}>{count > 9 ? '9+' : count}</span>}
      </button>
      {/* Over the whole page: the header is its own layer, and a sheet left inside it slides under the tab bar. */}
      {open && createPortal(
        <Sheet label={t('notif.title')} onClose={() => setOpen(false)}>
          {!items && <p className={styles.note}>{t('chat.loading')}</p>}
          {items && items.length === 0 && (
            <div className={styles.empty}>
              <Icon name="bell" size="em" aria-hidden="true" />
              <p>{t('notif.empty')}</p>
              <Link to="/books" onClick={() => setOpen(false)}>{t('notif.emptyLink')}</Link>
            </div>
          )}
          {items && items.length > 0 && (
            <ul className={styles.list}>
              {items.map((n) => {
                const { text, to } = words(n);
                return (
                  <li key={n.id} className={n.read ? '' : styles.unread}>
                    <Link
                      to={to}
                      onClick={() => {
                        track('notification_open', { kind: n.kind });
                        setOpen(false);
                      }}
                    >
                      <Icon name={n.kind === 'watch_listing' ? 'tag' : n.kind === 'wanted_by' ? 'users' : 'book'} size="em" aria-hidden="true" />
                      <span>
                        {text}
                        <small>{formatDay(n.created_at, locale)}</small>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Sheet>,
        document.body
      )}
    </>
  );
}
