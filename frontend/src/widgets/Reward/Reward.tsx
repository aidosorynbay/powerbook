import { Container, Badge } from '@/shared/ui';
import styles from './Reward.module.css';

interface RewardProps {
  percentage?: number;
  title?: string;
  description?: string;
}

export function Reward({
  percentage = 50,
  title = 'участников получают книгу бесплатно',
  description = 'Прочитай заданное количество страниц — получи реальную награду. Это не геймификация. Это дисциплина с результатом.',
}: RewardProps) {
  return (
    <section className={styles.reward}>
      <Container>
        <div className={styles.card}>
          <Badge variant="outline" size="md">
            Награда каждый месяц
          </Badge>
          
          <span className={styles.percentage}>{percentage}%</span>
          
          <h3 className={styles.title}>{title}</h3>
          
          <p className={styles.description}>{description}</p>
        </div>
      </Container>
    </section>
  );
}
