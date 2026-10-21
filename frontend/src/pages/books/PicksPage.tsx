import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '@/shared/lib';
import { Container } from '@/shared/ui';
import { Header } from '@/widgets';
import { LibraryTabs } from '@/widgets/SectionTabs';
import { Picks } from './Picks';
import { WorkSheet } from './WorkSheet';
import styles from './Store.module.css';

/**
 * «✦ Подобрать»: the AI librarian's own page in the Library (the founder, 2026-10-22: a reader finds it and asks for
 * picks for themselves, in the most natural place). They can say what they want now, or just open it: picks from
 * their taste. A book's card links here with «Похожее на …» (?wish=).
 */
export function PicksPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const openKey = params.get('book');
  const [initialWish] = useState(() => params.get('wish'));

  const open = (key: string | null) => {
    const next = new URLSearchParams(params);
    next.delete('wish');
    if (key) next.set('book', key);
    else next.delete('book');
    setParams(next, { replace: !key });
  };

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <Container>
          <LibraryTabs />
          <div className={styles.head}>
            <div>
              <h1 className={styles.title}>{t('picks.pageTitle')}</h1>
              <p className={styles.subtitle}>{t('picks.pageSubtitle')}</p>
            </div>
          </div>
          <Picks onOpen={open} askable initialWish={initialWish} />
        </Container>
      </main>
      {openKey && <WorkSheet workKey={openKey} onClose={() => open(null)} />}
    </div>
  );
}
