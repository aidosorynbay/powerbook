import { useI18n } from '@/shared/lib';
import { Container, Logo, Icon } from '@/shared/ui';
import styles from './Footer.module.css';

export function Footer() {
  const { t } = useI18n();
  const currentYear = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
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
              <a href="#about" className={styles.link}>
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
              <a href="mailto:hello@powerbook.ru" className={styles.link}>
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
              <a href="/privacy" className={styles.legalLink}>
                {t('footer.privacy')}
              </a>
              <span className={styles.separator} />
            </span>
            <span className={styles.legalItem}>
              <a href="/terms" className={styles.legalLink}>
                {t('footer.terms')}
              </a>
            </span>
          </nav>
        </div>
      </Container>
    </footer>
  );
}
