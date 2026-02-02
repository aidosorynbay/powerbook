import { useState, useEffect } from 'react';
import { useI18n, apiGet, type PublicStats } from '@/shared/lib';
import { Container, Card, Icon, ProgressBar } from '@/shared/ui';
import styles from './Stats.module.css';

function formatNumber(num: number): string {
    return num.toLocaleString('ru-RU');
}

export function Stats() {
    const { t } = useI18n();
    const [stats, setStats] = useState<PublicStats | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        async function fetchStats() {
            const { data } = await apiGet<PublicStats>('/stats/public');
            if (data) setStats(data);
            setIsLoading(false);
        }
        fetchStats();
    }, []);

    if (isLoading || !stats) {
        return (
            <section className={styles.stats}>
                <Container>
                    <div className={styles.header}>
                        <h2 className={styles.title}>{t('stats.title')}</h2>
                        <p className={styles.subtitle}>{t('stats.subtitle')}</p>
                    </div>
                    <div className={styles.loading}>{t('dashboard.loading')}</div>
                </Container>
            </section>
        );
    }

    return (
        <section className={styles.stats}>
            <Container>
                <div className={styles.header}>
                    <h2 className={styles.title}>{t('stats.title')}</h2>
                    <p className={styles.subtitle}>{t('stats.subtitle')}</p>
                </div>

                <div className={styles.grid}>
                    {/* Current round status */}
                    <Card variant="gradient" padding="lg" className={styles.card}>
                        <div className={styles.cardHeader}>
                            <span className={styles.cardLabel}>{t('stats.currentRound')}</span>
                            <span className={`${styles.badge} ${stats.is_round_active ? styles.badgeActive : ''}`}>
                                {stats.is_round_active ? t('stats.active') : t('stats.inactive')}
                            </span>
                        </div>
                        <div className={styles.statRow}>
                            <span className={styles.statLabel}>{t('stats.participants')}</span>
                            <span className={styles.statValue}>{formatNumber(stats.current_round_participants)}</span>
                        </div>
                        <div className={styles.statRow}>
                            <span className={styles.statLabel}>{t('stats.daysRemaining')}</span>
                            <span className={styles.statValue}>{stats.days_remaining}</span>
                        </div>
                        <div className={styles.progressSection}>
                            <span className={styles.progressLabel}>{t('stats.roundProgress')}</span>
                            <ProgressBar value={stats.round_progress_percent} />
                            <span className={styles.progressValue}>{stats.round_progress_percent}% {t('stats.completed')}</span>
                        </div>
                    </Card>

                    {/* Total participants */}
                    <Card variant="gradient" padding="lg" className={styles.card}>
                        <div className={styles.iconWrapper}>
                            <Icon name="users" size="lg" />
                        </div>
                        <span className={styles.value}>{formatNumber(stats.total_participants)}</span>
                        <span className={styles.label}>{t('stats.totalParticipants')}</span>
                    </Card>

                    {/* Total hours read */}
                    <Card variant="gradient" padding="lg" className={styles.card}>
                        <div className={styles.iconWrapper}>
                            <Icon name="clock" size="lg" />
                        </div>
                        <span className={styles.value}>{formatNumber(stats.total_hours_read)}</span>
                        <span className={styles.label}>{t('stats.hoursRead')}</span>
                    </Card>

                    {/* Total rounds */}
                    <Card variant="gradient" padding="lg" className={styles.card}>
                        <div className={styles.iconWrapper}>
                            <Icon name="refresh" size="lg" />
                        </div>
                        <span className={styles.value}>{stats.total_rounds}</span>
                        <span className={styles.label}>{t('stats.totalRounds')}</span>
                    </Card>
                </div>
            </Container>
        </section>
    );
}
