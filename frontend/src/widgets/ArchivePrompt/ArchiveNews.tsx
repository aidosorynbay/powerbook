import { useState } from 'react';
import { Link } from 'react-router-dom';
import { track, useI18n } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import styles from './ArchiveNews.module.css';

const key = (userId: string) => `pb.archiveNews.v1.${userId}`;

function seen(userId: string): boolean {
  try {
    return localStorage.getItem(key(userId)) !== null;
  } catch {
    return false;
  }
}

function markSeen(userId: string, how: 'linked' | 'hidden') {
  try {
    localStorage.setItem(key(userId), how);
  } catch {
    /* storage blocked: the card may come back */
  }
}

/**
 * The announcement for everyone in the circle: old nicknames can be linked
 * now, and the archive's circles, minutes and streaks come with them. Unlike
 * the «Вы раньше участвовали?» dialog it asks nothing and stops nothing — a
 * card on the round page, until the reader opens it or hides it.
 */
export function ArchiveNews({ userId }: { userId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(() => !seen(userId));
  if (!open) return null;

  const close = (how: 'linked' | 'hidden') => {
    markSeen(userId, how);
    track('archive_news', { answer: how });
    setOpen(false);
  };

  return (
    <aside className={styles.card} aria-labelledby="archive-news-title">
      <span className={styles.mark} aria-hidden="true">
        <Icon name="users" size="md" />
      </span>
      <div className={styles.body}>
        <h2 id="archive-news-title" className={styles.title}>{t('archiveNews.title')}</h2>
        <p className={styles.text}>{t('archiveNews.text')}</p>
        <Link to="/insights#claim" className={styles.go} onClick={() => close('linked')}>
          {t('archiveNews.go')}
          <Icon name="arrow-right" size="em" aria-hidden="true" />
        </Link>
      </div>
      <button
        type="button"
        className={styles.hide}
        onClick={() => close('hidden')}
        aria-label={t('archiveNews.hide')}
        title={t('archiveNews.hide')}
      >
        ×
      </button>
    </aside>
  );
}
