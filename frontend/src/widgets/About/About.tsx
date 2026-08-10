import { useI18n } from '@/shared/lib';
import { useScrollReveal } from '@/shared/hooks';
import { Container } from '@/shared/ui';
import anim from '@/shared/styles/animations.module.css';
import styles from './About.module.css';

export function About() {
  const { t } = useI18n();
  const { ref, isVisible } = useScrollReveal<HTMLElement>();
  const revealClass = `${anim.scrollReveal} ${isVisible ? anim.scrollRevealVisible : ''}`;

  return (
    <section id="about" ref={ref} className={`${styles.about} ${revealClass}`}>
      <Container size="sm">
        <div className={styles.kicker}>{t('about.kicker')}</div>
        <h2 className={styles.title}>{t('about.title')}</h2>

        <p className={styles.paragraph}>{t('about.p1')}</p>
        <p className={styles.paragraph}>{t('about.p2')}</p>
        <p className={styles.paragraph}>{t('about.p3')}</p>

        <div className={styles.timeline}>
          <div className={styles.timelineItem}>
            <span className={styles.timelineYear}>2021</span>
            <span className={styles.timelineText}>{t('about.timeline2021')}</span>
          </div>
          <div className={styles.timelineItem}>
            <span className={styles.timelineYear}>2026</span>
            <span className={styles.timelineText}>{t('about.timeline2026')}</span>
          </div>
        </div>
      </Container>
    </section>
  );
}
