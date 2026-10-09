import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { apiGet, apiPost, apiPut, track, useAuth, useI18n, type NotificationSettings, type SiteNotification } from '@/shared/lib';
import { Icon, type IconName } from '@/shared/ui';
import { formatDay, formatPrice, Sheet } from '@/pages/books/bookUi';
import styles from './Bell.module.css';

// How often the bell asks; it also asks on every page change.
const POLL_MS = 60_000;

// The switches, in the order the server lists them.
const KINDS = ['new_review', 'watch_listing', 'watch_finished', 'wanted_by'] as const;

const ICONS: Record<string, IconName> = { new_review: 'chat', watch_listing: 'tag', wanted_by: 'users' };

/** Where a notification leads, and what it says. */
function useWords() {
  const { t, locale } = useI18n();
  return (n: SiteNotification): { text: string; to: string; quote?: string } => {
    const d = n.data as Record<string, string | number | null>;
    const title = String(d.title ?? '');
    if (n.kind === 'new_review') {
      return {
        text: t(d.gender === 'male' ? 'notif.reviewM' : 'notif.reviewF', { reader: String(d.reader ?? ''), title, rating: Number(d.rating ?? 0) }),
        quote: d.quote ? String(d.quote) : undefined,
        to: `/books?book=${encodeURIComponent(String(d.work_key ?? ''))}&review=${encodeURIComponent(String(d.review_id ?? ''))}`,
      };
    }
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
 * The header bell: new reviews of books, what happened with the books the
 * reader watches («Следить за книгой») and who is looking for the books
 * they finished. Each kind can be switched off here; the app will push the
 * same things and follow the same switches.
 */
export function Bell({ className = '' }: { className?: string }) {
  const { t, locale } = useI18n();
  const { isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  const words = useWords();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SiteNotification[] | null>(null);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [tuning, setTuning] = useState(false);

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
    setTuning(false);
    const { data } = await apiGet<SiteNotification[]>('/notifications', { requireAuth: true });
    setItems(data ?? []);
    if (count > 0) {
      await apiPost('/notifications/read', {}, { requireAuth: true });
      setCount(0);
    }
  };

  const tune = async () => {
    setTuning(true);
    if (settings) return;
    const { data } = await apiGet<NotificationSettings>('/notifications/settings', { requireAuth: true });
    if (data) setSettings(data);
  };

  const toggle = async (kind: string, enabled: boolean) => {
    setSettings((prev) => (prev ? { ...prev, [kind]: enabled } : prev));
    const { data } = await apiPut<NotificationSettings>('/notifications/settings', { settings: { [kind]: enabled } }, { requireAuth: true });
    if (data) setSettings(data);
    else setSettings((prev) => (prev ? { ...prev, [kind]: !enabled } : prev));
    track('notification_setting', { kind, enabled });
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
          {tuning && (
            <div className={styles.settings}>
              <button type="button" className={styles.back} onClick={() => setTuning(false)}>
                ← {t('notif.back')}
              </button>
              <p className={styles.note}>{t('notif.settingsNote')}</p>
              {!settings && <p className={styles.note}>{t('chat.loading')}</p>}
              {settings && (
                <ul className={styles.switches}>
                  {KINDS.map((kind) => (
                    <li key={kind}>
                      <label>
                        <span>
                          {t(`notif.pref.${kind}`)}
                          <small>{t(`notif.pref.${kind}.d`)}</small>
                        </span>
                        <input
                          type="checkbox"
                          role="switch"
                          checked={settings[kind] !== false}
                          onChange={(e) => toggle(kind, e.target.checked)}
                        />
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {!tuning && !items && <p className={styles.note}>{t('chat.loading')}</p>}
          {!tuning && items && items.length === 0 && (
            <div className={styles.empty}>
              <Icon name="bell" size="em" aria-hidden="true" />
              <p>{t('notif.empty')}</p>
              <Link to="/books" onClick={() => setOpen(false)}>{t('notif.emptyLink')}</Link>
            </div>
          )}
          {!tuning && items && items.length > 0 && (
            <ul className={styles.list}>
              {items.map((n) => {
                const { text, to, quote } = words(n);
                return (
                  <li key={n.id} className={n.read ? '' : styles.unread}>
                    <Link
                      to={to}
                      onClick={() => {
                        track('notification_open', { kind: n.kind });
                        setOpen(false);
                      }}
                    >
                      <Icon name={ICONS[n.kind] ?? 'book'} size="em" aria-hidden="true" />
                      <span>
                        {text}
                        {quote && <q className={styles.quote}>{quote}</q>}
                        <small>{formatDay(n.created_at, locale)}</small>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {!tuning && items && (
            <button type="button" className={styles.tune} onClick={tune}>
              <Icon name="gear" size="em" aria-hidden="true" />
              {t('notif.settings')}
            </button>
          )}
        </Sheet>,
        document.body
      )}
    </>
  );
}
