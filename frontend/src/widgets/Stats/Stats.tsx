import { useState, useEffect } from 'react';
import { useI18n, apiGet, type PublicStats } from '@/shared/lib';
import { useScrollReveal } from '@/shared/hooks';
import { Container, Card } from '@/shared/ui';
import anim from '@/shared/styles/animations.module.css';
import styles from './Stats.module.css';

function formatNumber(num: number): string {
    return num.toLocaleString('ru-RU');
}

function formatEpic(num: number): string {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
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
                    <Card variant="default" padding="none" className={`${styles.epicRow} ${anim.scrollReveal} ${isVisible ? anim.scrollRevealVisible : ''}`}>
                        <div className={styles.epicCell}>
                            <span className={styles.epicValue}>{formatEpic(stats.total_minutes_read)}</span>
                            <span className={styles.epicCaption}>{t('stats.minutesReadCaption')}</span>
                        </div>
                        <div className={styles.epicCell}>
                            <span className={styles.epicValue}>{stats.total_rounds}</span>
                            <span className={styles.epicCaption}>{t('stats.circlesRunCaption')}</span>
                        </div>
                        <div className={styles.epicCell}>
                            <span className={styles.epicValue}>{formatNumber(stats.total_participations)}</span>
                            <span className={styles.epicCaption}>{t('stats.participationsCaption')}</span>
                        </div>
                        <div className={styles.epicCell}>
                            <span className={styles.epicValue}>{formatNumber(stats.total_participants)}</span>
                            <span className={styles.epicCaption}>{t('stats.distinctPeopleCaption')}</span>
                        </div>
                    </Card>
                )}
            </Container>
        </section>
    );
}
