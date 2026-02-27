import { useState, useEffect } from 'react';
import { useI18n, apiGet, type PublicStats } from '@/shared/lib';
import { useScrollReveal } from '@/shared/hooks';
import { Container, Card, Icon, ProgressBar } from '@/shared/ui';
import anim from '@/shared/styles/animations.module.css';
import styles from './Stats.module.css';

function formatNumber(num: number): string {
    return num.toLocaleString('ru-RU');
}

export function Stats() {
    const { t } = useI18n();
    const { ref, isVisible } = useScrollReveal<HTMLElement>();
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

    const revealClass = `${anim.scrollReveal} ${isVisible ? anim.scrollRevealVisible : ''}`;

    return (
        <section ref={ref} className={`${styles.stats} ${revealClass}`}>
            <Container>
                <div className={styles.header}>
                    <h2 className={styles.title}>{t('stats.title')}</h2>
                    <p className={styles.subtitle}>{t('stats.subtitle')}</p>
                </div>

                {isLoading || !stats ? (
                    <div className={styles.loading}>{t('dashboard.loading')}</div>
                ) : (
                    <div className={styles.grid}>
                        {/* Total participants */}
                        <Card variant="gradient" padding="lg" className={`${styles.card} ${anim.scrollReveal} ${isVisible ? anim.scrollRevealVisible : ''} ${anim.scrollRevealDelay1}`}>
                            <div className={styles.iconWrapper}>
                                <Icon name="users" size="lg" />
                            </div>
                            <span className={styles.value}>{formatNumber(stats.total_participants)}</span>
                            <span className={styles.label}>{t('stats.totalParticipants')}</span>
                        </Card>

                        {/* Total hours read */}
                        <Card variant="gradient" padding="lg" className={`${styles.card} ${anim.scrollReveal} ${isVisible ? anim.scrollRevealVisible : ''} ${anim.scrollRevealDelay2}`}>
                            <div className={styles.iconWrapper}>
                                <Icon name="clock" size="lg" />
                            </div>
                            <span className={styles.value}>{formatNumber(stats.total_hours_read)}</span>
                            <span className={styles.label}>{t('stats.hoursRead')}</span>
                        </Card>

                        {/* Total rounds */}
                        <Card variant="gradient" padding="lg" className={`${styles.card} ${anim.scrollReveal} ${isVisible ? anim.scrollRevealVisible : ''} ${anim.scrollRevealDelay3}`}>
                            <div className={styles.iconWrapper}>
                                <Icon name="refresh" size="lg" />
                            </div>
                            <span className={styles.value}>{stats.total_rounds}</span>
                            <span className={styles.label}>{t('stats.totalRounds')}</span>
                        </Card>
                    </div>
                )}
            </Container>
        </section>
    );
}
