import { Link } from 'react-router-dom';
import { LogoLockup } from './LogoLockup';
import styles from './Logo.module.css';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

/** The logo as the way home: the brand kit's lockup, or its mark alone when there is no room for the word. */
export function Logo({ size = 'md', showText = true, className = '' }: LogoProps) {
  const classNames = [
    styles.logo,
    styles[size],
    className,
  ].filter(Boolean).join(' ');

  return (
    <Link to="/" className={classNames} aria-label="PowerBook">
      <LogoLockup mark={!showText} />
    </Link>
  );
}
