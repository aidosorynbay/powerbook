import { Button, Badge, ProgressBar, Container, Icon } from '@/shared/ui';
import styles from './Hero.module.css';

interface RoundStats {
  status: 'active' | 'upcoming' | 'closed';
  participants: number;
  daysRemaining: number;
  progressPercent: number;
}

interface HeroProps {
  roundStats?: RoundStats;
  onJoinClick?: () => void;
  onLearnMoreClick?: () => void;
}

export function Hero({ roundStats, onJoinClick, onLearnMoreClick }: HeroProps) {
  const defaultStats: RoundStats = {
    status: 'active',
    participants: 12487,
    daysRemaining: 14,
    progressPercent: 54,
  };

  const stats = roundStats || defaultStats;

  return (
    <section className={styles.hero}>
      <Container>
        <div className={styles.content}>
          <div className={styles.textContent}>
            <h1 className={styles.title}>
              <span className={styles.titleWhite}>Читай каждый день.</span>
              <span className={styles.titleAccent}>Выигрывай книги.</span>
            </h1>
            
            <p className={styles.subtitle}>
              Ежемесячный челлендж по чтению с реальными результатами.
              <br />
              Формируй привычку, соревнуйся с другими читателями.
            </p>
            
            <div className={styles.actions}>
              <Button 
                variant="primary" 
                size="lg" 
                icon={<Icon name="arrow-right" size="sm" />}
                onClick={onJoinClick}
              >
                Присоединиться
              </Button>
              <button className={styles.learnMoreBtn} onClick={onLearnMoreClick}>
                Узнать больше
              </button>
            </div>
          </div>
          
          <div className={styles.statsCard}>
            <div className={styles.statsHeader}>
              <span className={styles.statsLabel}>Текущий круг</span>
              <Badge variant={stats.status === 'active' ? 'accent' : 'default'}>
                {stats.status === 'active' ? 'Активен' : stats.status === 'upcoming' ? 'Скоро' : 'Завершён'}
              </Badge>
            </div>
            
            <div className={styles.statsRow}>
              <span className={styles.statLabel}>Участников</span>
              <span className={styles.statValue}>{stats.participants.toLocaleString('ru-RU')}</span>
            </div>
            
            <div className={styles.divider} />
            
            <div className={styles.statsRow}>
              <span className={styles.statLabel}>Осталось дней</span>
              <span className={styles.statValue}>{stats.daysRemaining}</span>
            </div>
            
            <div className={styles.divider} />
            
            <div className={styles.progressSection}>
              <span className={styles.statLabel}>Прогресс круга</span>
              <ProgressBar value={stats.progressPercent} showLabel size="md" />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
