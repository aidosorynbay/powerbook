import { useState, useEffect } from 'react';
import { useI18n, apiGet, type PublicStats } from '@/shared/lib';
import { useScrollReveal, useCountUp } from '@/shared/hooks';
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

const MINUTES_PER_YEAR = 365 * 24 * 60;

/**
 * One headline number. The raw figure means little on its own — "3.17M
 * minutes" is hard to feel — so each cell carries a second line that
 * translates it into something human ("about six years of non-stop
 * reading"). The number counts up once the block scrolls into view.
 */
function EpicCell({
    target,
    format,
    caption,
    sell,
    active,
}: {
    target: number;
    format: (n: number) => string;
    caption: string;
    sell?: string;
    active: boolean;
}) {
    const value = useCountUp(target, active);
    return (
        <div className={styles.epicCell}>
            <span className={styles.epicValue}>{format(value)}</span>
            <span className={styles.epicCaption}>{caption}</span>
            {sell && <span className={styles.epicSell}>{sell}</span>}
        </div>
    );
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

    // Derived "so what" figures, all straight from the real numbers.
    const years = stats ? (stats.total_minutes_read / MINUTES_PER_YEAR).toFixed(1) : '0';
    const yearsRunning = stats ? Math.max(1, Math.round(stats.total_rounds / 12)) : 0;
    const avgRounds =
        stats && stats.total_participants > 0
            ? (stats.total_participations / stats.total_participants).toFixed(1)
            : '0';

    const fill = (key: string, n: string | number) => t(key).replace('{n}', String(n));

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
                        <EpicCell
                            target={stats.total_minutes_read}
                            format={formatEpic}
                            caption={t('stats.minutesReadCaption')}
                            sell={fill('stats.sellYears', years)}
                            active={isVisible}
                        />
                        <EpicCell
                            target={stats.total_rounds}
                            format={(n) => String(n)}
                            caption={t('stats.circlesRunCaption')}
                            sell={fill('stats.sellNoGaps', yearsRunning)}
                            active={isVisible}
                        />
                        <EpicCell
                            target={stats.total_participations}
                            format={formatNumber}
                            caption={t('stats.participationsCaption')}
                            sell={fill('stats.sellReturn', avgRounds)}
                            active={isVisible}
                        />
                        <EpicCell
                            target={stats.total_participants}
                            format={formatNumber}
                            caption={t('stats.distinctPeopleCaption')}
                            sell={t('stats.sellStart')}
                            active={isVisible}
                        />
                    </Card>
                )}
            </Container>
        </section>
    );
}
