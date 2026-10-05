import type { DayCard } from '@/shared/lib';
import { dayKind } from './shareText';
import styles from './DayGrid.module.css';

/** The round as squares, a week to a row: the same picture the shared text
 * draws with emoji, here with the days still ahead left empty. */
export function DayGrid({ card }: { card: DayCard }) {
  return (
    <div className={styles.grid} role="img" aria-label={card.days.map((d) => `${d.date}: ${d.minutes}`).join(', ')}>
      {card.days.map((d) => {
        const ahead = d.date > card.day;
        const kind = ahead ? 'ahead' : dayKind(d.minutes);
        return (
          <span
            key={d.date}
            className={`${styles.cell} ${styles[kind]} ${d.date === card.day ? styles.current : ''}`}
            title={ahead ? undefined : `${Number(d.date.slice(8))} · ${d.minutes}`}
          >
            {Number(d.date.slice(8))}
          </span>
        );
      })}
    </div>
  );
}

/** What the colours mean, in the same squares. */
export function DayLegend({ goal, some, none }: { goal: string; some: string; none: string }) {
  return (
    <div className={styles.legend}>
      <span><i className={`${styles.swatch} ${styles.goal}`} />{goal}</span>
      <span><i className={`${styles.swatch} ${styles.some}`} />{some}</span>
      <span><i className={`${styles.swatch} ${styles.none}`} />{none}</span>
    </div>
  );
}
