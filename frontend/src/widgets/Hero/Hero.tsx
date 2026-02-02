import { useState, useEffect } from 'react';
import { useI18n, apiGet, type PublicStats } from '@/shared/lib';
import { Button, Badge, ProgressBar, Container, Icon } from '@/shared/ui';
import styles from './Hero.module.css';

interface HeroProps {
  onJoinClick?: () => void;
  onLearnMoreClick?: () => void;
}

export function Hero({ onJoinClick, onLearnMoreClick }: HeroProps) {
  const { t } = useI18n();
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    async function fetchStats() {
      const { data } = await apiGet<PublicStats>('/stats/public');
      if (data) setStats(data);
    }
    fetchStats();
  }, []);

  return (
    <section className={styles.hero}>
      <Container>
        <div className={styles.content}>
          <div className={styles.textContent}>
            <h1 className={styles.title}>
              <span className={styles.titleWhite}>{t('hero.titleLine1')}</span>
              <span className={styles.titleAccent}>{t('hero.titleLine2')}</span>
            </h1>

            <p className={styles.subtitle}>
              {t('hero.subtitle1')}
              <br />
              {t('hero.subtitle2')}
            </p>

            <div className={styles.actions}>
              <Button
                variant="primary"
                size="lg"
                icon={<Icon name="arrow-right" size="sm" />}
                onClick={onJoinClick}
              >
                {t('hero.joinBtn')}
              </Button>
              <button className={styles.learnMoreBtn} onClick={onLearnMoreClick}>
                {t('hero.learnMore')}
              </button>
            </div>
          </div>

          <div className={styles.statsCard}>
            <div className={styles.statsHeader}>
              <span className={styles.statsLabel}>{t('stats.currentRound')}</span>
              <Badge variant={stats?.is_round_active ? 'accent' : 'default'}>
                {stats?.is_round_active ? t('stats.active') : t('stats.inactive')}
              </Badge>
            </div>

            <div className={styles.statsRow}>
              <span className={styles.statLabel}>{t('stats.participants')}</span>
              <span className={styles.statValue}>
                {stats ? stats.current_round_participants.toLocaleString() : '—'}
              </span>
            </div>

            <div className={styles.divider} />

            <div className={styles.statsRow}>
              <span className={styles.statLabel}>{t('stats.daysRemaining')}</span>
              <span className={styles.statValue}>{stats?.days_remaining ?? '—'}</span>
            </div>

            <div className={styles.divider} />

            <div className={styles.progressSection}>
              <span className={styles.statLabel}>{t('stats.roundProgress')}</span>
              <ProgressBar value={stats?.round_progress_percent ?? 0} showLabel size="md" />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
