import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { track, useAuth, useI18n } from '@/shared/lib';
import { Container, PageTransition } from '@/shared/ui';
import { Footer, Header } from '@/widgets';
import { InstallGuideBody } from '@/widgets/InstallGuide';
import styles from './GetPage.module.css';

/**
 * /get: where the QR code and the «send to my phone» links land. The page
 * is the install guide for whatever opened it, and ?source= says which
 * way the person came (qr, telegram, whatsapp, copy, inapp…).
 */
export function GetPage() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const source = params.get('source') || 'direct';

  useEffect(() => {
    track('get_page_view', { channel: source });
  }, [source]);

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container>
            <div className={styles.card}>
              <h1 className={styles.title}>{t('install.title')}</h1>
              <p className={styles.lead}>{t('install.lead')}</p>
              <InstallGuideBody source={source} onDone={() => navigate(isAuthenticated ? '/round' : '/join')} />
            </div>
          </Container>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
}
