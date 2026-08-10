import { useEffect, useState } from 'react';
import { useI18n, apiGet, type HallOfFame } from '@/shared/lib';
import { Card, Container, PageTransition, Icon } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import styles from './HallOfFamePage.module.css';

const MEDALS = ['🥇', '🥈', '🥉'];

export function HallOfFamePage() {
  const { t } = useI18n();
  const [data, setData] = useState<HallOfFame | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: res } = await apiGet<HallOfFame>('/insights/hall-of-fame');
      if (!cancelled && res) setData(res);
      if (!cancelled) setIsLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container>
            <div className={styles.hero}>
              <div className={styles.heroIcon}>
                <Icon name="trophy" size="lg" />
              </div>
              <h1 className={styles.title}>{t('hallOfFame.title')}</h1>
              <p className={styles.subtitle}>{t('hallOfFame.subtitle')}</p>
            </div>

            {isLoading ? (
              <div className={styles.loading}>{t('dashboard.loading')}</div>
            ) : (
              <div className={styles.categoriesGrid}>
                {data?.categories.map((cat) => (
                  <Card key={cat.key} variant="default" padding="lg" className={styles.categoryCard}>
                    <h2 className={styles.categoryTitle}>{t(`hallOfFame.category.${cat.key}`)}</h2>
                    {cat.entries.length === 0 ? (
                      <div className={styles.empty}>{t('hallOfFame.empty')}</div>
                    ) : (
                      <ol className={styles.entryList}>
                        {cat.entries.map((e, i) => (
                          <li key={i} className={styles.entryRow}>
                            <span className={styles.entryRank}>{MEDALS[i] ?? i + 1}</span>
                            <span className={styles.entryInfo}>
                              <span className={styles.entryName}>{e.display_name}</span>
                              {e.badge_title && <span className={styles.entryBadge}>{e.badge_title}</span>}
                            </span>
                            <span className={styles.entryValue}>
                              {e.value} {cat.unit}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </Card>
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
