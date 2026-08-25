import { useI18n } from '@/shared/lib';
import { Container, PageTransition } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import styles from './LegalPage.module.css';

/**
 * Privacy policy and terms, rendered from the translation files so both read
 * in the visitor's own language. Both app stores require a reachable policy
 * URL, and Kazakh/Russian readers shouldn't be handed an English-only page to
 * agree to.
 *
 * The section lists are driven by a count key so a locale can't silently drop
 * a clause: if `privacy.sectionCount` says 8, eight sections are rendered.
 */
function LegalSections({ prefix }: { prefix: 'privacy' | 'terms' }) {
  const { t } = useI18n();
  const count = Number(t(`${prefix}.sectionCount`));
  const sections = Number.isFinite(count) ? count : 0;

  return (
    <>
      {Array.from({ length: sections }, (_, i) => i + 1).map((n) => (
        <section key={n} className={styles.section}>
          <h2 className={styles.sectionTitle}>{t(`${prefix}.s${n}.title`)}</h2>
          <p className={styles.sectionBody}>{t(`${prefix}.s${n}.body`)}</p>
        </section>
      ))}
    </>
  );
}

function LegalShell({ prefix }: { prefix: 'privacy' | 'terms' }) {
  const { t } = useI18n();
  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container size="sm">
            <h1 className={styles.title}>{t(`${prefix}.title`)}</h1>
            <p className={styles.updated}>{t(`${prefix}.updated`)}</p>
            <p className={styles.intro}>{t(`${prefix}.intro`)}</p>
            <LegalSections prefix={prefix} />
            <p className={styles.contact}>
              {t('legal.contact')} <a href="mailto:madik.orynbay@gmail.com">madik.orynbay@gmail.com</a>
            </p>
          </Container>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
}

export function PrivacyPage() {
  return <LegalShell prefix="privacy" />;
}

export function TermsPage() {
  return <LegalShell prefix="terms" />;
}
