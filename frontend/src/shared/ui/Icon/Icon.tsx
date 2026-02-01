import { SVGAttributes } from 'react';
import styles from './Icon.module.css';

export type IconName = 
  | 'logo'
  | 'arrow-right'
  | 'telegram'
  | 'email'
  | 'users'
  | 'clock'
  | 'refresh'
  | 'check';

interface IconProps extends SVGAttributes<SVGElement> {
  name: IconName;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const icons: Record<IconName, JSX.Element> = {
  'logo': (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" fill="currentColor" />
      <path d="M6 8h4v8H6V8z" fill="var(--color-bg-primary)" />
      <path d="M12 8h6v2h-6V8zM12 12h6v2h-6v-2z" fill="var(--color-bg-primary)" />
    </>
  ),
  'arrow-right': (
    <path 
      d="M5 12h14m-6-6l6 6-6 6" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
      fill="none"
    />
  ),
  'telegram': (
    <path 
      d="M21 5L2 12.5l7 1M21 5l-4 15-7-7.5M21 5L9 13.5m0 0V21l3.5-3.5" 
      stroke="currentColor" 
      strokeWidth="1.5" 
      strokeLinecap="round" 
      strokeLinejoin="round"
      fill="none"
    />
  ),
  'email': (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M2 7l10 6 10-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </>
  ),
  'users': (
    <>
      <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M2 21v-2a4 4 0 014-4h6a4 4 0 014 4v2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="17" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M17 11.5a3 3 0 013 3V16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </>
  ),
  'clock': (
    <>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </>
  ),
  'refresh': (
    <>
      <path d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M21 3v5h-5M3 21v-5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  'check': (
    <path 
      d="M5 12l5 5L20 7" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
      fill="none"
    />
  ),
};

export function Icon({ name, size = 'md', className = '', ...props }: IconProps) {
  const classNames = [
    styles.icon,
    styles[size],
    className,
  ].filter(Boolean).join(' ');

  return (
    <svg 
      className={classNames}
      viewBox="0 0 24 24" 
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {icons[name]}
    </svg>
  );
}
