import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useI18n, apiGet, type DirectoryEntry } from '@/shared/lib';
import { Container, PageTransition, Avatar, BookCard, Icon } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import styles from './DirectoryPage.module.css';

export function DirectoryPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');
  // Registered members first by default — the archive is much larger and
  // would otherwise bury the people who are actually here.
  const [showArchive, setShowArchive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await apiGet<DirectoryEntry[]>('/social/directory', { requireAuth: true });
      if (!cancelled && data) setEntries(data);
      if (!cancelled) setIsLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const members = useMemo(() => entries.filter((e) => !e.is_archive), [entries]);
  const archive = useMemo(() => entries.filter((e) => e.is_archive), [entries]);

  const filtered = useMemo(() => {
    const pool = showArchive ? archive : members;
    const q = query.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter(
      (e) =>
        e.display_name.toLowerCase().includes(q) ||
        e.username.toLowerCase().includes(q) ||
        e.archive_usernames.some((u) => u.toLowerCase().includes(q)) ||
        (e.telegram_id ?? '').toLowerCase().includes(q)
    );
  }, [members, archive, query, showArchive]);

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container>
            <h1 className={styles.title}>{t('directory.title')}</h1>

            <div className={styles.tabs} role="group">
              <button
                type="button"
                className={`${styles.tab} ${!showArchive ? styles.tabActive : ''}`}
                aria-pressed={!showArchive}
                onClick={() => setShowArchive(false)}
              >
                {t('directory.tabMembers')} ({members.length})
              </button>
              <button
                type="button"
                className={`${styles.tab} ${showArchive ? styles.tabActive : ''}`}
                aria-pressed={showArchive}
                onClick={() => setShowArchive(true)}
              >
                {t('directory.tabArchive')} ({archive.length})
              </button>
            </div>

            {showArchive && (
              <p className={styles.archiveNote}>
                {t('directory.archiveNote')}{' '}
                <Link to="/claim" className={styles.archiveLink}>{t('directory.archiveClaim')}</Link>
              </p>
            )}
            <p className={styles.subtitle}>{t('directory.subtitle')}</p>

            <input
              className={styles.search}
              type="text"
              placeholder={t('directory.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            {isLoading ? (
              <div className={styles.loading}>{t('dashboard.loading')}</div>
            ) : (
              <div className={styles.grid}>
                {filtered.map((entry) => (
                  <button
                    key={entry.user_id}
                    className={`${styles.readerCard} ${entry.is_archive ? styles.archiveCard : ''}`}
                    onClick={() =>
                      entry.is_archive ? navigate('/claim') : navigate(`/readers/${entry.user_id}`)
                    }
                  >
                    <div className={styles.readerTop}>
                      <Avatar src={entry.avatar_data} name={entry.display_name} size="md" />
                      <div className={styles.readerIdentity}>
                        <div className={styles.readerName}>{entry.display_name}</div>
                        {entry.archetype_key && (
                          <div className={styles.readerArchetype}>
                            {t(
                              `archetype.${entry.archetype_key}.title`,
                              entry.archetype_weekday !== null
                                ? { weekday: t(`weekday.long.${entry.archetype_weekday}`) }
                                : undefined
                            )}
                          </div>
                        )}
                      </div>
                      {entry.is_archive && (
                        <div className={styles.archivePill}>{t('directory.archiveTag')}</div>
                      )}
                      {entry.badges_earned > 0 && (
                        <div className={styles.badgePill}>
                          <Icon name="trophy" size="sm" aria-hidden="true" />
                          {entry.badges_earned}
                        </div>
                      )}
                    </div>

                    {entry.is_archive && (
                      <>
                        <div className={styles.archiveStats}>
                          <span><b>{entry.rounds_count}</b> {t('directory.statRounds')}</span>
                          <span><b>{Math.round(entry.total_minutes / 60)}</b> {t('directory.statHours')}</span>
                          {entry.books_count > 0 && (
                            <span><b>{entry.books_count}</b> {t('directory.statBooks')}</span>
                          )}
                        </div>
                        {entry.archive_usernames.length > 1 && (
                          <div className={styles.archiveAliases}>
                            {t('directory.alsoKnownAs')} {entry.archive_usernames.join(', ')}
                          </div>
                        )}
                      </>
                    )}

                    {entry.recent_books.length > 0 && (
                      <div className={styles.miniLibrary}>
                        {entry.recent_books.slice(0, 3).map((title, i) => (
                          <div key={i} className={styles.miniLibraryItem}>
                            <BookCard title={title} size="sm" />
                          </div>
                        ))}
                      </div>
                    )}

                    {entry.recommendation_text && (
                      <div className={styles.readerRec}>&ldquo;{entry.recommendation_text}&rdquo;</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </Container>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
}

