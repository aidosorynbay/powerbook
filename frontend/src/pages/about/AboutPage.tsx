import { useEffect } from 'react';
import { useI18n } from '@/shared/lib';
import { PageTransition } from '@/shared/ui';
import { About, Footer, Header, RoundsShowcase } from '@/widgets';
import styles from './AboutPage.module.css';

/** Who we are and how we grew: the story, every year's readers, every circle's days. */
export function AboutPage() {
  const { t } = useI18n();
  useEffect(() => {
    document.title = `${t('aboutPage.title')} · PowerBook`;
  }, [t]);
  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <About />
          <RoundsShowcase />
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
}
