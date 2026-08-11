import { colorFromSeed } from '@/shared/lib';
import styles from './Avatar.module.css';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Avatar({ src, name, size = 'md' }: AvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const classNames = [styles.avatar, styles[size]].join(' ');

  if (src) {
    return <img className={classNames} src={src} alt={name} />;
  }

  const color = colorFromSeed(name);
  return (
    <div className={classNames} style={{ background: `${color}26`, color, borderColor: `${color}55` }}>
      {initial}
    </div>
  );
}
