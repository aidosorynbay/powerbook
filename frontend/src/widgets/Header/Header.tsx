import { Logo, Button, Icon, Container } from '@/shared/ui';
import styles from './Header.module.css';

interface HeaderProps {
  onRegisterClick?: () => void;
  onLoginClick?: () => void;
}

export function Header({ onRegisterClick, onLoginClick }: HeaderProps) {
  return (
    <header className={styles.header}>
      <Container>
        <div className={styles.inner}>
          <Logo size="md" />
          
          <nav className={styles.nav}>
            <a href="#about" className={styles.navLink}>О нас</a>
            <a href="#reviews" className={styles.navLink}>Отзывы</a>
            <a href="#faq" className={styles.navLink}>FAQ</a>
            <a href="https://t.me/powerbook" className={styles.navLink} target="_blank" rel="noopener noreferrer">
              <Icon name="telegram" size="sm" />
              <span>Telegram</span>
            </a>
          </nav>
          
          <div className={styles.actions}>
            <button className={styles.loginBtn} onClick={onLoginClick}>
              Вход
            </button>
            <Button variant="primary" size="sm" onClick={onRegisterClick}>
              Регистрация
            </Button>
          </div>
        </div>
      </Container>
    </header>
  );
}
