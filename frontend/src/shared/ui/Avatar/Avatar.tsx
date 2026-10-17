import type { ReactNode } from 'react';
import { colorFromSeed } from '@/shared/lib';
import styles from './Avatar.module.css';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Worn on the picture, tucked under it (the league's bookmark tail). */
  badge?: ReactNode;
  /** An award pin worn at the lower right, cut out of its cloth. */
  pin?: ReactNode;
}

export function Avatar({ src, name, size = 'md', badge, pin }: AvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const classNames = [styles.avatar, styles[size]].join(' ');

  let face: ReactNode;
  if (src) {
    face = <img className={classNames} src={src} alt={name} />;
  } else {
    const color = colorFromSeed(name);
    face = (
      <div className={classNames} style={{ background: `${color}26`, color, borderColor: `${color}55` }}>
        {initial}
      </div>
    );
  }
  if (!badge && !pin) return face;
  return (
    <span className={styles.worn}>
      {face}
      {badge}
      {pin && <span className={styles.pinSlot}>{pin}</span>}
    </span>
  );
}
