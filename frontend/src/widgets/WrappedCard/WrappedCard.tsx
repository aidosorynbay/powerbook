import { forwardRef } from 'react';
import { useI18n, type Wrapped } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import styles from './WrappedCard.module.css';

const MONTH_INITIALS_KEYS = [
  'month.1', 'month.2', 'month.3', 'month.4', 'month.5', 'month.6',
  'month.7', 'month.8', 'month.9', 'month.10', 'month.11', 'month.12',
];

interface WrappedCardProps {
  wrapped: Wrapped;
  displayName: string;
}

export const WrappedCard = forwardRef<HTMLDivElement, WrappedCardProps>(function WrappedCard(
  { wrapped, displayName },
  ref
) {
  const { t } = useI18n();
  const maxMonth = Math.max(...wrapped.minutes_by_month, 1);
  const archetype = wrapped.archetype;
  const archetypeTitle = archetype
    ? t(
        `archetype.${archetype.key}.title`,
        archetype.key === 'weekday_loyalist'
          ? { weekday: t(`weekday.long.${archetype.params.weekday}`) }
          : archetype.params
      )
    : '';
  const funFactText =
    archetype && archetype.fun_fact_weekday !== null && archetype.fun_fact_minutes !== null
      ? t('insights.funFact', {
          weekday: t(`weekday.longPlural.${archetype.fun_fact_weekday}`),
          minutes: archetype.fun_fact_minutes,
        })
      : null;

  return (
    <div ref={ref} className={styles.card}>
      <div className={styles.bg} />

      <div className={styles.header}>
        <Icon name="logo" size="sm" />
        <div className={styles.wordmarkGroup}>
          <span className={styles.wordmark}>PowerBook</span>
          <span className={styles.since}>Since 2021</span>
        </div>
        <span className={styles.yearTag}>Wrapped {wrapped.year}</span>
      </div>

      <div className={styles.name}>{displayName}</div>

      {archetype && (
        <div className={styles.archetypeTag}>{archetypeTitle}</div>
      )}

      <div className={styles.hero}>
        <div className={styles.heroValue}>{wrapped.total_hours}</div>
        <div className={styles.heroLabel}>{t('wrapped.hoursRead')}</div>
      </div>

      {funFactText && (
        <div className={styles.funFact}>{funFactText}</div>
      )}

      <div className={styles.chart}>
        {wrapped.minutes_by_month.map((m, i) => (
          <div key={i} className={styles.chartCol}>
            <div className={styles.chartBarTrack}>
              <div
                className={styles.chartBar}
                style={{ height: `${Math.max((m / maxMonth) * 100, m > 0 ? 6 : 0)}%` }}
              />
            </div>
            <span className={styles.chartLabel}>{t(MONTH_INITIALS_KEYS[i]).slice(0, 1)}</span>
          </div>
        ))}
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.stat}>
          <div className={styles.statValue}>{wrapped.longest_streak_days}</div>
          <div className={styles.statLabel}>{t('wrapped.longestStreak')}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statValue}>{wrapped.rounds_participated}</div>
          <div className={styles.statLabel}>{t('wrapped.circles')}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statValue}>{wrapped.books_finished}</div>
          <div className={styles.statLabel}>{t('wrapped.booksFinished')}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statValue}>{wrapped.days_read}/365</div>
          <div className={styles.statLabel}>{t('wrapped.daysRead')}</div>
        </div>
      </div>

      <div className={styles.footer}>powerbook.kz</div>
    </div>
  );
});
