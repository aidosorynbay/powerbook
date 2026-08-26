import { useState, useEffect, useMemo } from 'react';
import { useI18n, apiGet, type PublicStats } from '@/shared/lib';
import { useScrollReveal } from '@/shared/hooks';
import { Container } from '@/shared/ui';
import anim from '@/shared/styles/animations.module.css';
import styles from './About.module.css';

export function About() {
  const { t } = useI18n();
  const { ref, isVisible } = useScrollReveal<HTMLElement>();
  const [stats, setStats] = useState<PublicStats | null>(null);
  const revealClass = `${anim.scrollReveal} ${isVisible ? anim.scrollRevealVisible : ''}`;

  useEffect(() => {
    async function load() {
      const { data } = await apiGet<PublicStats>('/stats/public');
      if (data) setStats(data);
    }
    load();
  }, []);

  // Growth is the story here, so show every year rather than two captions.
  // Bars are scaled against the busiest year, and the current (partial) year
  // is marked so a lower bar doesn't read as decline.
  const years = useMemo(() => {
    const list = stats?.yearly ?? [];
    if (!list.length) return [];
    const peak = Math.max(...list.map(y => y.readers), 1);
    const thisYear = new Date().getFullYear();
    return list.map(y => ({
      ...y,
      pct: Math.max(4, Math.round((y.readers / peak) * 100)),
      isCurrent: y.year === thisYear,
      isPeak: y.readers === peak,
    }));
  }, [stats]);

  return (
    <section id="about" ref={ref} className={`${styles.about} ${revealClass}`}>
      <Container size="sm">
        <div className={styles.kicker}>{t('about.kicker')}</div>
        <h2 className={styles.title}>{t('about.title')}</h2>

        <p className={styles.paragraph}>{t('about.p1')}</p>
        <p className={styles.paragraph}>{t('about.p2')}</p>
        <p className={styles.paragraph}>{t('about.p3')}</p>
        <p className={styles.paragraph}>{t('about.p4')}</p>

        {years.length > 0 && (
          <div className={styles.growth}>
            <div className={styles.growthHead}>
              <span className={styles.growthTitle}>{t('about.growthTitle')}</span>
              <span className={styles.growthHint}>{t('about.growthHint')}</span>
            </div>

            <div className={styles.growthChart}>
              {years.map(y => (
                <div key={y.year} className={styles.growthCol}>
                  <span className={styles.growthValue}>{y.readers}</span>
                  <div className={styles.growthBarTrack}>
                    <div
                      className={`${styles.growthBar} ${y.isPeak ? styles.growthBarPeak : ''}`}
                      style={{ height: isVisible ? `${y.pct}%` : '0%' }}
                    />
                  </div>
                  <span className={styles.growthYear}>
                    {y.year}
                    {y.isCurrent && <span className={styles.growthNow}>*</span>}
                  </span>
                </div>
              ))}
            </div>

            <div className={styles.growthFoot}>{t('about.growthFoot')}</div>
          </div>
        )}
      </Container>
    </section>
  );
}
