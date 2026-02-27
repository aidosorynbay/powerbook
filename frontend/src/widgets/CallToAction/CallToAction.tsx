import { useScrollReveal } from '@/shared/hooks';
import { Container, Button, Icon } from '@/shared/ui';
import anim from '@/shared/styles/animations.module.css';
import styles from './CallToAction.module.css';

interface CallToActionProps {
  onJoinClick?: () => void;
}

const features = [
  'Бесплатная регистрация',
  'Начни в любой момент',
  'Без скрытых платежей',
];

export function CallToAction({ onJoinClick }: CallToActionProps) {
  const { ref, isVisible } = useScrollReveal<HTMLElement>();

  return (
    <section ref={ref} className={`${styles.cta} ${anim.scrollReveal} ${isVisible ? anim.scrollRevealVisible : ''}`}>
      <Container>
        <div className={styles.content}>
          <h2 className={styles.title}>Начни читать сегодня</h2>
          
          <p className={styles.subtitle}>
            Присоединяйся к текущему кругу и формируй привычку читать каждый день
          </p>
          
          <Button
            variant="primary"
            size="lg"
            icon={<Icon name="arrow-right" size="sm" />}
            onClick={onJoinClick}
            className={styles.button}
          >
            Присоединиться к кругу
          </Button>
          
          <div className={styles.features}>
            {features.map((feature, index) => (
              <span key={index} className={styles.feature}>
                {feature}
                {index < features.length - 1 && <span className={styles.dot}>•</span>}
              </span>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
