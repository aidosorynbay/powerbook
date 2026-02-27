import { useState, useEffect, useCallback } from 'react';
import {
  useI18n,
  apiGet,
  type LastCompletedRound,
  type RoundResultsResponse,
} from '@/shared/lib';
import { useScrollReveal } from '@/shared/hooks';
import { Container, Badge, PageTransition } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import anim from '@/shared/styles/animations.module.css';
import styles from './ResultsPage.module.css';

export function ResultsPage() {
  const { t } = useI18n();

  const [lastRound, setLastRound] = useState<LastCompletedRound>(null);
  const [results, setResults] = useState<RoundResultsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    const { data: round } = await apiGet<LastCompletedRound>(
      '/rounds/last-completed',
      { requireAuth: true }
    );
    if (round) {
      setLastRound(round);
      const { data: res } = await apiGet<RoundResultsResponse>(
        `/rounds/${round.id}/results`,
        { requireAuth: true }
      );
      if (res) setResults(res);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const { ref, isVisible } = useScrollReveal<HTMLDivElement>();
  const revealClass = `${anim.scrollReveal} ${isVisible ? anim.scrollRevealVisible : ''}`;

  const monthName = results ? t(`month.${results.month}`) : '';

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />

      <main className={styles.main}>
        <Container>
          {isLoading ? (
            <div className={styles.loading}>{t('dashboard.loading')}</div>
          ) : !lastRound || !results ? (
            <div className={styles.empty}>{t('results.noResults')}</div>
          ) : (
            <div ref={ref}>
              <div className={`${styles.title} ${revealClass}`}>
                {t('results.title')} — {monthName} {results.year}
              </div>

              <div className={styles.sections}>
                <div className={`${styles.section} ${revealClass} ${anim.scrollRevealDelay1}`}>
                  <div className={styles.sectionTitle}>{t('dashboard.leaderboard')}</div>
                  <div className={styles.table}>
                    <div className={styles.tableHeader}>
                      <span className={styles.colRank}>{t('results.rank')}</span>
                      <span className={styles.colName}>{t('results.name')}</span>
                      <span className={styles.colScore}>{t('results.score')}</span>
                      <span className={styles.colGroup}></span>
                    </div>
                    {results.results.map((entry) => (
                      <div
                        key={entry.user_id}
                        className={`${styles.tableRow} ${entry.group === 'winner' ? styles.rowWinner : styles.rowLoser}`}
                      >
                        <span className={styles.colRank}>{entry.rank}</span>
                        <span className={styles.colName}>{entry.display_name}</span>
                        <span className={styles.colScore}>{entry.total_score}</span>
                        <span className={styles.colGroup}>
                          <Badge
                            variant={entry.group === 'winner' ? 'success' : 'default'}
                            size="sm"
                          >
                            {entry.group === 'winner' ? t('results.winner') : t('results.loser')}
                          </Badge>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {results.pairs.length > 0 && (
                  <div className={`${styles.section} ${revealClass} ${anim.scrollRevealDelay2}`}>
                    <div className={styles.sectionTitle}>{t('results.pairs')}</div>
                    <div className={styles.pairs}>
                      {results.pairs.map((pair, idx) => (
                        <div key={idx} className={styles.pairRow}>
                          <span className={styles.pairGiver}>{pair.giver_name}</span>
                          <span className={styles.pairArrow}>{t('results.givesTo')}</span>
                          <span className={styles.pairReceiver}>{pair.receiver_name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </Container>
      </main>

        <Footer />
      </div>
    </PageTransition>
  );
}
