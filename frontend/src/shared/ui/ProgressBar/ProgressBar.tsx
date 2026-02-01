import { HTMLAttributes } from 'react';
import styles from './ProgressBar.module.css';

interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}

export function ProgressBar({
  value,
  max = 100,
  showLabel = false,
  size = 'md',
  className = '',
  ...props
}: ProgressBarProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  const classNames = [
    styles.container,
    styles[size],
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={classNames} {...props}>
      <div className={styles.track}>
        <div 
          className={styles.fill} 
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showLabel && (
        <span className={styles.label}>{Math.round(percentage)}% завершено</span>
      )}
    </div>
  );
}
