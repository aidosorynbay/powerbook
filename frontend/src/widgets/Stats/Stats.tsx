import { Container, Card, Icon } from '@/shared/ui';
import type { IconName } from '@/shared/ui';
import styles from './Stats.module.css';

interface StatItem {
    icon: IconName;
    value: string;
    label: string;
}

interface StatsProps {
    stats?: StatItem[];
}

const defaultStats: StatItem[] = [
    {
        icon: 'users',
        value: '12487',
        label: 'активных участников',
    },
    {
        icon: 'clock',
        value: '178432',
        label: 'часов прочитано вместе',
    },
    {
        icon: 'refresh',
        value: '36',
        label: 'проведённых кругов',
    },
];

export function Stats({ stats = defaultStats }: StatsProps) {
    return (
        <section className={styles.stats}>
            <Container>
                <div className={styles.header}>
                    <h2 className={styles.title}>Платформа в цифрах</h2>
                    <p className={styles.subtitle}>Живая статистика сообщества читателей</p>
                </div>

                <div className={styles.grid}>
                    {stats.map((stat, index) => (
                        <Card key={index} variant="gradient" padding="lg" className={styles.card}>
                            <div className={styles.iconWrapper}>
                                <Icon name={stat.icon} size="lg" />
                            </div>
                            <span className={styles.value}>{stat.value}</span>
                            <span className={styles.label}>{stat.label}</span>
                        </Card>
                    ))}
                </div>
            </Container>
        </section>
    );
}
