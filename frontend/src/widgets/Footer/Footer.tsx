import { Container, Logo, Icon } from '@/shared/ui';
import styles from './Footer.module.css';

const navigationLinks = [
  { label: 'О нас', href: '#about' },
];

const contactLinks = [
  { label: 'Telegram', href: 'https://t.me/+ZSmueLtmT8Y1MDBi', icon: 'telegram' as const },
  { label: 'Email', href: 'mailto:hello@powerbook.ru', icon: 'email' as const },
];

const legalLinks = [
  { label: 'Конфиденциальность', href: '/privacy' },
  { label: 'Условия', href: '/terms' },
];

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <Container>
        <div className={styles.content}>
          <div className={styles.brand}>
            <Logo size="md" />
            <p className={styles.description}>
              Ежемесячный челлендж по чтению с реальными результатами.
              Читай каждый день, соревнуйся и выигрывай книги.
            </p>
          </div>
          
          <div className={styles.column}>
            <h4 className={styles.columnTitle}>Навигация</h4>
            <nav className={styles.nav}>
              {navigationLinks.map((link) => (
                <a key={link.href} href={link.href} className={styles.link}>
                  {link.label}
                </a>
              ))}
            </nav>
          </div>
          
          <div className={styles.column}>
            <h4 className={styles.columnTitle}>Связь</h4>
            <nav className={styles.nav}>
              {contactLinks.map((link) => (
                <a 
                  key={link.href} 
                  href={link.href} 
                  className={styles.link}
                  target={link.href.startsWith('http') ? '_blank' : undefined}
                  rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                >
                  <Icon name={link.icon} size="sm" />
                  <span>{link.label}</span>
                </a>
              ))}
            </nav>
          </div>
        </div>
        
        <div className={styles.bottom}>
          <span className={styles.copyright}>
            © {currentYear} PowerBook. Все права защищены.
          </span>
          
          <nav className={styles.legal}>
            {legalLinks.map((link, index) => (
              <span key={link.href} className={styles.legalItem}>
                <a href={link.href} className={styles.legalLink}>
                  {link.label}
                </a>
                {index < legalLinks.length - 1 && <span className={styles.separator} />}
              </span>
            ))}
          </nav>
        </div>
      </Container>
    </footer>
  );
}
