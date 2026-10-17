import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { apiGet, useAuth, useI18n } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import styles from './Bell.module.css';

export const READ_EVENT = 'pb:messages-read';

/** Parked (2026-10-17): the founder took the messages function off the interface until it is built properly. */
const MESSAGES_ICON = false;

/**
 * Beside the bell: the way back to the conversation with the founder («Хей, как вы?»). A reader sees it once there
 * is a conversation; the founder always, with how many answers wait for him.
 */
function MessagesIcon({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  const [state, setState] = useState<{ count: number; has_thread: boolean } | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    let live = true;
    const load = () =>
      apiGet<{ count: number; has_thread: boolean }>('/messages/unread', { requireAuth: true }).then(({ data }) => {
        if (live && data) setState(data);
      });
    void load();
    // the conversation page says when it has read something, so the count is never one behind
    window.addEventListener(READ_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(READ_EVENT, load);
    };
  }, [isAuthenticated, pathname]);

  if (!isAuthenticated || !state?.has_thread) return null;
  return (
    <Link to="/messages" className={`${styles.bell} ${className}`} aria-label={t('msg.title')} title={t('msg.title')}>
      <Icon name="chat" size="sm" aria-hidden="true" />
      {state.count > 0 && <span className={styles.badge}>{state.count > 9 ? '9+' : state.count}</span>}
    </Link>
  );
}

export function MessagesLink({ className = '' }: { className?: string }) {
  return MESSAGES_ICON ? <MessagesIcon className={className} /> : null;
}
