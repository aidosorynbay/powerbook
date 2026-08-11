import { colorFromSeed } from '@/shared/lib';
import styles from './BookCard.module.css';

interface BookCardProps {
  title: string;
  cover?: string | null;
  meta?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function BookCard({ title, cover, meta, size = 'md' }: BookCardProps) {
  const color = colorFromSeed(title);
  const classNames = [styles.card, styles[size]].join(' ');

  return (
    <div className={classNames}>
      <div
        className={styles.cover}
        style={
          cover
            ? { backgroundImage: `url(${cover})` }
            : { background: `linear-gradient(160deg, ${color} 0%, ${color}99 100%)` }
        }
      >
        {!cover && (
          <>
            <span className={styles.coverSpine} />
            <span className={styles.coverTitle}>{title}</span>
          </>
        )}
      </div>
      <div className={styles.label}>
        <span className={styles.title}>{title}</span>
        {meta && <span className={styles.meta}>{meta}</span>}
      </div>
    </div>
  );
}
