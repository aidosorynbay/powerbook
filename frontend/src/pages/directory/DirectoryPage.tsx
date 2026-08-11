import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n, apiGet, type DirectoryEntry } from '@/shared/lib';
import { Container, PageTransition, Avatar, BookCard } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import styles from './DirectoryPage.module.css';

export function DirectoryPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.display_name.toLowerCase().includes(q) ||
        e.username.toLowerCase().includes(q) ||
        (e.telegram_id ?? '').toLowerCase().includes(q)
    );
  }, [entries, query]);

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container>
            <h1 className={styles.title}>{t('directory.title')}</h1>
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
                    className={styles.readerCard}
                    onClick={() => navigate(`/readers/${entry.user_id}`)}
                  >
                    <div className={styles.readerTop}>
                      <Avatar src={entry.avatar_data} name={entry.display_name} size="md" />
                      <div className={styles.readerIdentity}>
                        <div className={styles.readerName}>{entry.display_name}</div>
                        {entry.archetype_title && (
                          <div className={styles.readerArchetype}>{entry.archetype_title}</div>
                        )}
                      </div>
                      {entry.badges_earned > 0 && (
                        <div className={styles.badgePill}>
                          <span>&#127942;</span>
                          {entry.badges_earned}
                        </div>
                      )}
                    </div>

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
