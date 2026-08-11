import { useEffect, useState } from 'react';
import { useAuth, useI18n, apiGet, type Suggestion } from '@/shared/lib';
import { Container, PageTransition } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import styles from './AdminSuggestionsPage.module.css';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function AdminSuggestionsPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.system_role === 'admin' || user?.system_role === 'superadmin';

  useEffect(() => {
    if (!isAdmin) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      const { data, error: err } = await apiGet<Suggestion[]>('/suggestions', { requireAuth: true });
      if (cancelled) return;
      if (data) setSuggestions(data);
      if (err) setError(err);
      setIsLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container size="md">
            <h1 className={styles.title}>{t('suggestionsAdmin.title')}</h1>
            <p className={styles.subtitle}>{t('suggestionsAdmin.subtitle')}</p>

            {!isAdmin ? (
              <div className={styles.denied}>{t('suggestionsAdmin.denied')}</div>
            ) : isLoading ? (
              <div className={styles.loading}>{t('dashboard.loading')}</div>
            ) : error ? (
              <div className={styles.denied}>{error}</div>
            ) : suggestions.length === 0 ? (
              <div className={styles.empty}>{t('suggestionsAdmin.empty')}</div>
            ) : (
              <div className={styles.list}>
                {suggestions.map((s) => (
                  <div key={s.id} className={styles.row}>
                    <div className={styles.rowHeader}>
                      <span className={styles.rowAuthor}>
                        {s.author_display_name ?? s.name ?? t('suggestionsAdmin.anonymous')}
                      </span>
                      <span className={styles.rowDate}>{formatDate(s.created_at)}</span>
                    </div>
                    <div className={styles.rowMessage}>{s.message}</div>
                  </div>
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
