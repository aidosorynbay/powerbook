import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useI18n, apiGet, type Buddy, type DirectoryEntry } from '@/shared/lib';
import { Container, PageTransition, Avatar, BookCard, Icon } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import styles from './DirectoryPage.module.css';
import { LeagueGlyph } from '@/widgets/League';

export function DirectoryPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');
  // Registered members first by default — the archive is much larger and
  // would otherwise bury the people who are actually here.
  // «Мои друзья» (reading friends) moved here from Настройки: the people you follow sit with everyone else
  const [view, setView] = useState<'members' | 'friends' | 'archive'>(() => (window.location.hash === '#friends' ? 'friends' : 'members'));
  const showArchive = view === 'archive';
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    apiGet<Buddy[]>('/social/buddies/mine', { requireAuth: true }).then(({ data }) => {
      if (data) setFriendIds(new Set(data.map((b) => b.user_id)));
    });
  }, []);

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
    const pool = showArchive ? archive : view === 'friends' ? members.filter((e) => friendIds.has(e.user_id)) : members;
    const q = query.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter(
      (e) =>
        e.display_name.toLowerCase().includes(q) ||
        e.username.toLowerCase().includes(q) ||
        e.archive_usernames.some((u) => u.toLowerCase().includes(q)) ||
        (e.telegram_id ?? '').toLowerCase().includes(q)
    );
  }, [members, archive, query, showArchive, view, friendIds]);

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container>
            <Link to="/insights" className={styles.back}>‹ {t('set2.back')}</Link>
            <h1 className={styles.title}>{t('directory.title')}</h1>

            <div className={styles.tabs} role="group">
              <button
                type="button"
                className={`${styles.tab} ${view === 'members' ? styles.tabActive : ''}`}
                aria-pressed={view === 'members'}
                onClick={() => setView('members')}
              >
                {t('directory.tabMembers')} ({members.length})
              </button>
              <button
                type="button"
                className={`${styles.tab} ${view === 'friends' ? styles.tabActive : ''}`}
                aria-pressed={view === 'friends'}
                onClick={() => setView('friends')}
              >
                {t('dir2.friends')} ({friendIds.size})
              </button>
              <button
                type="button"
                className={`${styles.tab} ${view === 'archive' ? styles.tabActive : ''}`}
                aria-pressed={view === 'archive'}
                onClick={() => setView('archive')}
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
            ) : view === 'friends' && filtered.length === 0 ? (
              <p className={styles.subtitle}>{t('dir2.friendsEmpty')}</p>
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
                      <Avatar src={entry.avatar_data} name={entry.display_name} size="md" badge={entry.league && <LeagueGlyph tier={entry.league} onAvatar px={14} face={48} />} />
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

