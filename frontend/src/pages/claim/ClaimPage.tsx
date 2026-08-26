import { Link } from 'react-router-dom';
import { useAuth, useI18n } from '@/shared/lib';
import { Button, Card, Container, Logo, PageTransition } from '@/shared/ui';
import { Header, Footer, ClaimPicker } from '@/widgets';
import styles from './ClaimPage.module.css';

/**
 * Reclaiming a reading history from before the site existed.
 *
 * The archive holds a placeholder account per historical nickname. This is
 * where a reader points at the ones that were theirs; an admin approves,
 * and the statistics move over. Signed-out visitors get the pitch and a way
 * in rather than a locked door.
 */
export function ClaimPage() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();

  return (
    <PageTransition>
      <Header />
      <main className={styles.page}>
        <Container size="sm">
          <div className={styles.intro}>
            <Logo size="lg" />
            <h1 className={styles.title}>{t('claimPage.title')}</h1>
            <p className={styles.lede}>{t('claimPage.lede')}</p>
          </div>

          {isAuthenticated ? (
            <Card variant="default" padding="lg">
              <ClaimPicker />
            </Card>
          ) : (
            <Card variant="default" padding="lg">
              <p className={styles.gate}>{t('claimPage.signInFirst')}</p>
              <div className={styles.gateActions}>
                <Link to="/login?redirect=%2Fclaim" className={styles.gateLink}>
                  <Button variant="primary" size="md">{t('header.login')}</Button>
                </Link>
                <Link to="/register" className={styles.gateLink}>
                  <Button variant="secondary" size="md">{t('header.register')}</Button>
                </Link>
              </div>
            </Card>
          )}

          <p className={styles.note}>{t('claimPage.note')}</p>
        </Container>
      </main>
      <Footer />
    </PageTransition>
  );
}
