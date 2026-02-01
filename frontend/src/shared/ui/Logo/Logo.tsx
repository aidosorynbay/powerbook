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
    <div className={classNames}>
      <div className={styles.iconWrapper}>
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={styles.icon}>
          <rect x="3" y="5" width="18" height="14" rx="2" fill="currentColor" />
          <rect x="6" y="8" width="4" height="8" rx="0.5" fill="var(--color-bg-primary)" />
          <rect x="12" y="8" width="6" height="2" rx="0.5" fill="var(--color-bg-primary)" />
          <rect x="12" y="12" width="6" height="2" rx="0.5" fill="var(--color-bg-primary)" />
        </svg>
      </div>
      {showText && <span className={styles.text}>PowerBook</span>}
    </div>
  );
}
