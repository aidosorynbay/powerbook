import { SVGAttributes } from 'react';
import styles from './Icon.module.css';

export type IconName =
  | 'logo'
  | 'arrow-right'
  | 'telegram'
  | 'email'
  | 'user'
  | 'users'
  | 'clock'
  | 'refresh'
  | 'check'
  | 'star'
  | 'trophy'
  | 'book'
  | 'calendar'
  | 'gift'
  | 'pen'
  | 'flame'
  | 'medal'
  | 'bolt'
  | 'rocket'
  | 'gem'
  | 'bulb'
  | 'hourglass'
  | 'flag'
  | 'alarm'
  | 'candle'
  | 'tag'
  | 'chat'
  | 'sparkle'
  | 'camera'
  | 'bell'
  | 'lock'
  | 'unlock'
  | 'play'
  | 'party'
  | 'gear';

interface IconProps extends SVGAttributes<SVGElement> {
  name: IconName;
  /** 'em' follows the surrounding text, for an icon standing in a line of words. */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'em';
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
  'user': (
    <>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M5 21v-1.5A5.5 5.5 0 0110.5 14h3a5.5 5.5 0 015.5 5.5V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
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
  'calendar': (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </>
  ),
  'gift': (
    <>
      <rect x="3.5" y="8.5" width="17" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M5 12.5v7a1 1 0 001 1h12a1 1 0 001-1v-7M12 8.5v12" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M12 8.5C10.5 5 7 4.5 7 6.5S10 8.5 12 8.5zM12 8.5c1.5-3.5 5-4 5-2s-3 2-5 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
    </>
  ),
  'pen': (
    <>
      <path d="M15.5 4.5l4 4L9 19H5v-4L15.5 4.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M13.5 6.5l4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
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
  'star': (
    <path
      d="M12 2.5l2.9 6.16 6.6.75-4.9 4.55 1.3 6.54L12 17.5l-5.9 3-1.3-6.54-4.9-4.55 6.6-.75L12 2.5z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      fill="none"
    />
  ),
  'book': (
    <>
      <path d="M4 4.5A1.5 1.5 0 015.5 3H19a1 1 0 011 1v14a1 1 0 01-1 1H5.5A1.5 1.5 0 004 20.5v-16z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M4 17.5A1.5 1.5 0 015.5 16H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </>
  ),
  'flame': (
    <>
      <path d="M12 2.5c.5 3.2 3.4 4.7 4.8 7.6.8 1.6 1 3.3.5 5A5.5 5.5 0 0112 21a5.5 5.5 0 01-5.4-5.6c.1-2.4 1.4-4.1 2.7-5.4.2 1.5.9 2.6 1.9 3.1-.5-3.3-.3-6.5.8-10.6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M12 21a2.6 2.6 0 01-2.6-2.7c0-1.3.8-2.2 1.7-3 .2.8.7 1.4 1.4 1.6.3-.8.4-1.6.2-2.6 1.1.9 1.9 2.1 1.9 3.6A2.6 2.6 0 0112 21z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
    </>
  ),
  'medal': (
    <>
      <path d="M8 3l3.2 6.6M16 3l-3.2 6.6M6.5 3h3M14.5 3h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <circle cx="12" cy="15" r="5.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="12" cy="15" r="2.4" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </>
  ),
  'bolt': (
    <path d="M13.5 2.5L5 13.5h6.2L10.5 21.5 19 10.5h-6.2l.7-8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
  ),
  'rocket': (
    <>
      <path d="M12 2.5c2.9 2.1 4.5 5.6 4.5 9.5v3.5h-9V12c0-3.9 1.6-7.4 4.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <circle cx="12" cy="9.5" r="1.7" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M7.5 12.5L5 15v3.5l2.5-1.5M16.5 12.5L19 15v3.5l-2.5-1.5M10.5 18.5l1.5 3 1.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  'gem': (
    <>
      <path d="M6.5 3.5h11l4 5.2L12 20.5 2.5 8.7l4-5.2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M2.5 8.7h19M9.5 3.5L8 8.7l4 11.8 4-11.8-1.5-5.2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
    </>
  ),
  'bulb': (
    <>
      <path d="M12 3a6 6 0 00-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v.6h5v-.6c0-.8.4-1.6 1.1-2.1A6 6 0 0012 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M9.5 19h5M10.5 21.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </>
  ),
  'hourglass': (
    <path d="M6.5 3h11M6.5 21h11M7.5 3c0 4.3 4.5 5.4 4.5 9s-4.5 4.7-4.5 9M16.5 3c0 4.3-4.5 5.4-4.5 9s4.5 4.7 4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  ),
  'flag': (
    <path d="M5.5 21V3.5M5.5 4h11.5l-2.4 3.7L17 11.5H5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  ),
  'alarm': (
    <>
      <circle cx="12" cy="13" r="7.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M12 9v4.3l2.6 1.6M3.8 6L6.6 3.4M20.2 6l-2.8-2.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  'candle': (
    <>
      <rect x="9" y="10" width="6" height="10.5" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M12 10V8.3M7 20.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M12 2.5c1.3 1.5 2 2.6 2 3.5a2 2 0 01-4 0c0-.9.7-2 2-3.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
    </>
  ),
  'tag': (
    <>
      <path d="M3.5 12.6V4.5a1 1 0 011-1h8.1c.3 0 .5.1.7.3l7.4 7.4a1 1 0 010 1.4l-8.1 8.1a1 1 0 01-1.4 0l-7.4-7.4a1 1 0 01-.3-.7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <circle cx="8" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </>
  ),
  'chat': (
    <path d="M5.5 4h13A1.5 1.5 0 0120 5.5v9a1.5 1.5 0 01-1.5 1.5H10l-4 3.5V16h-.5A1.5 1.5 0 014 14.5v-9A1.5 1.5 0 015.5 4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
  ),
  'sparkle': (
    <>
      <path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8L11 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
    </>
  ),
  'camera': (
    <>
      <path d="M4 8.5A1.5 1.5 0 015.5 7h2.3l1.5-2.2h5.4L16.2 7h2.3A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5v-9z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <circle cx="12" cy="13" r="3.4" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </>
  ),
  'bell': (
    <>
      <path d="M6 16.5V11a6 6 0 0112 0v5.5l1.5 2h-15l1.5-2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M10 21a2 2 0 004 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </>
  ),
  'lock': (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </>
  ),
  'unlock': (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M8 11V8a4 4 0 017.6-1.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </>
  ),
  'play': (
    <path d="M8 5.2v13.6a.6.6 0 00.9.5l10.4-6.8a.6.6 0 000-1L8.9 4.7a.6.6 0 00-.9.5z" fill="currentColor" />
  ),
  'party': (
    <>
      <path d="M4 20.5l4.8-12.2 7.4 7.4L4 20.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M13.5 3.5l.4 2.2M20.5 10.5l-2.2-.4M16.8 7.2l2.4-2.4M11 9.5c1.6-1.8 1.2-3.6.2-4.6M14.5 13c1.8-1.6 3.6-1.2 4.6-.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </>
  ),
  'gear': (
    <>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  'trophy': (
    <>
      <path d="M7 4h10v5a5 5 0 01-10 0V4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M7 5H4a2 2 0 002 4h1M17 5h3a2 2 0 01-2 4h-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M12 14v3M9 20h6M10 17h4v3h-4v-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
    </>
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
