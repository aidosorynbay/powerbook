import type { ReactNode } from 'react';
import { colorFromSeed, pinCutUrl, useWornPin } from '@/shared/lib';
import styles from './Avatar.module.css';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Worn on the picture, tucked under it (the league's bookmark tail). */
  badge?: ReactNode;
  /** The reader's id: their worn award pin then stands at the picture's right (see shared/lib/wornPins). */
  userId?: string | null;
  /** The pin by hand instead (a button on one's own profile); `null` = none even if they wear one. */
  pin?: ReactNode;
}

export function Avatar({ src, name, size = 'md', badge, userId, pin }: AvatarProps) {
  const worn = useWornPin(pin === undefined ? userId : null);
  const side = pin !== undefined ? pin : worn ? <img src={pinCutUrl(worn)} alt="" draggable={false} /> : null;
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
  const dressed = badge ? (
    <span className={styles.worn}>
      {face}
      {badge}
    </span>
  ) : (
    face
  );
  if (!side) return dressed;
  return (
    <span className={styles.withPin}>
      {dressed}
      <span className={`${styles.pinSide} ${styles[`pin_${size}`]} ${pin !== undefined ? styles.pinLive : ''}`}>{side}</span>
    </span>
  );
}
