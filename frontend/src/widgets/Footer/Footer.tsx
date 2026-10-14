import { Link } from 'react-router-dom';
import { useI18n } from '@/shared/lib';
import { Container, Logo, Icon } from '@/shared/ui';
import styles from './Footer.module.css';

/** The site's foot. Phones hide it (the tab bar is the way around there) — except where a page asks for it with
 *  `onPhone`: the front page keeps its contacts and the legal links at the very bottom for a visitor without the bar. */
export function Footer({ onPhone = false }: { onPhone?: boolean } = {}) {
  const { t } = useI18n();
  const currentYear = new Date().getFullYear();

  return (
    <footer className={`${styles.footer} ${onPhone ? styles.onPhone : ''}`}>
      <Container>
        <div className={styles.content}>
          <div className={styles.brand}>
            <Logo size="md" />
            <p className={styles.description}>
              {t('footer.description')}
            </p>
          </div>

          <div className={styles.column}>
            <h4 className={styles.columnTitle}>{t('footer.navigation')}</h4>
            <nav className={styles.nav}>
              <a href="/about" className={styles.link}>
                {t('header.about')}
              </a>
            </nav>
          </div>

          <div className={styles.column}>
            <h4 className={styles.columnTitle}>{t('footer.contact')}</h4>
            <nav className={styles.nav}>
              <a
                href="https://t.me/+ZSmueLtmT8Y1MDBi"
                className={styles.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="telegram" size="sm" />
                <span>Telegram</span>
              </a>
              {/* the address the privacy and terms pages give (LegalPage), not a made-up domain mailbox */}
              <a href="mailto:madik.orynbay@gmail.com" className={styles.link}>
                <Icon name="email" size="sm" />
                <span>Email</span>
              </a>
            </nav>
          </div>
        </div>

        <div className={styles.bottom}>
          <span className={styles.copyright}>
            {t('footer.copyright', { year: currentYear })}
          </span>

          <nav className={styles.legal}>
            <span className={styles.legalItem}>
              <Link to="/privacy" className={styles.legalLink}>
                {t('footer.privacy')}
              </Link>
              <span className={styles.separator} />
            </span>
            <span className={styles.legalItem}>
              <Link to="/terms" className={styles.legalLink}>
                {t('footer.terms')}
              </Link>
            </span>
          </nav>
        </div>
      </Container>
    </footer>
  );
}

