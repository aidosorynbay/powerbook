import { useI18n } from '@/shared/lib';
import { useScrollReveal } from '@/shared/hooks';
import { Container, Badge } from '@/shared/ui';
import anim from '@/shared/styles/animations.module.css';
import styles from './Reward.module.css';

export function Reward() {
  const { t } = useI18n();
  const { ref, isVisible } = useScrollReveal<HTMLElement>();

  return (
    <section ref={ref} className={`${styles.reward} ${anim.scrollReveal} ${isVisible ? anim.scrollRevealVisible : ''}`}>
      <Container>
        <div className={styles.card}>
          <Badge variant="outline" size="md">
            {t('reward.badge')}
          </Badge>

          <span className={styles.percentage}>50%</span>

          <h3 className={styles.title}>{t('reward.title')}</h3>

          <p className={styles.description}>{t('reward.description')}</p>
        </div>
      </Container>
    </section>
  );
}
