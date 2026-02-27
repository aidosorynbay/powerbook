import { Link } from 'react-router-dom';
import styles from './Logo.module.css';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

export function Logo({ size = 'md', showText = true, className = '' }: LogoProps) {
  const classNames = [
    styles.logo,
    styles[size],
    className,
  ].filter(Boolean).join(' ');

  return (
    <Link to="/" className={classNames}>
      <img src="/logo-icon.png" alt="PowerBook" className={styles.icon} />
      {showText && <span className={styles.text}>PowerBook</span>}
    </Link>
  );
}
