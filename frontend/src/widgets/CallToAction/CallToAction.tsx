import { useI18n } from '@/shared/lib';
import { useScrollReveal } from '@/shared/hooks';
import { Container, Button, Icon } from '@/shared/ui';
import anim from '@/shared/styles/animations.module.css';
import styles from './CallToAction.module.css';

interface CallToActionProps {
  onJoinClick?: () => void;
}

export function CallToAction({ onJoinClick }: CallToActionProps) {
  const { t } = useI18n();
  const { ref, isVisible } = useScrollReveal<HTMLElement>();

  const features = [
    t('cta.freeRegistration'),
    t('cta.startAnytime'),
    t('cta.noHiddenFees'),
  ];

  return (
    <section ref={ref} className={`${styles.cta} ${anim.scrollReveal} ${isVisible ? anim.scrollRevealVisible : ''}`}>
      <Container>
        <div className={styles.content}>
          <h2 className={styles.title}>{t('cta.title')}</h2>

          <p className={styles.subtitle}>
            {t('cta.subtitle')}
          </p>

          <Button
            variant="primary"
            size="lg"
            icon={<Icon name="arrow-right" size="sm" />}
            onClick={onJoinClick}
            className={styles.button}
          >
            {t('cta.joinButton')}
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
