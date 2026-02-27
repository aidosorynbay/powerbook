import { useState, useEffect, useCallback, useMemo } from 'react';
import { useI18n, apiGet, type YearlyArchiveResponse } from '@/shared/lib';
import { useScrollReveal } from '@/shared/hooks';
import { Container, PageTransition } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import anim from '@/shared/styles/animations.module.css';
import styles from './ArchivePage.module.css';

function getDayColor(minutes: number, dateStr: string, participated: boolean): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(dateStr + 'T00:00:00');

  if (day > today) return styles.future;
  if (minutes >= 30) return styles.green;
  if (minutes >= 2) return styles.yellow;
  // If user didn't participate in this month's round, show gray instead of red
  if (!participated) return styles.future;
  return styles.red;
}

const MIN_YEAR = 2026;

export function ArchivePage() {
  const { t } = useI18n();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [archive, setArchive] = useState<YearlyArchiveResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchArchive = useCallback(async (y: number) => {
    setIsLoading(true);
    const { data } = await apiGet<YearlyArchiveResponse>(
      `/rounds/archive/${y}`,
      { requireAuth: true }
    );
    if (data) setArchive(data);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchArchive(year);
  }, [year, fetchArchive]);

  const participatedMonths = useMemo(() => {
    return new Set(archive?.participated_months ?? []);
  }, [archive]);

  const months = useMemo(() => {
    const result: Array<{
      month: number;
      participated: boolean;
      grid: Array<{ day: number; date: string; minutes: number } | null>;
    }> = [];

    for (let m = 1; m <= 12; m++) {
      const firstDay = new Date(year, m - 1, 1);
      let startDayOfWeek = firstDay.getDay() - 1;
      if (startDayOfWeek < 0) startDayOfWeek = 6;

      const daysInMonth = new Date(year, m, 0).getDate();

      const monthDays = archive?.months[String(m)] ?? [];
      const dayMap = new Map(monthDays.map(d => [d.date, d.minutes]));

      const grid: Array<{ day: number; date: string; minutes: number } | null> = [];

      for (let i = 0; i < startDayOfWeek; i++) {
        grid.push(null);
      }

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        grid.push({
          day: d,
          date: dateStr,
          minutes: dayMap.get(dateStr) ?? 0,
        });
      }

      result.push({ month: m, participated: participatedMonths.has(m), grid });
    }

    return result;
  }, [archive, year, participatedMonths]);

  const weekdays = useMemo(() => [
    t('weekday.mon'), t('weekday.tue'), t('weekday.wed'),
    t('weekday.thu'), t('weekday.fri'), t('weekday.sat'), t('weekday.sun')
  ], [t]);

  const { ref, isVisible } = useScrollReveal<HTMLDivElement>();
  const revealClass = `${anim.scrollReveal} ${isVisible ? anim.scrollRevealVisible : ''}`;

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />

      <main className={styles.main}>
        <Container>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{t('archive.title')}</h1>
            <div className={styles.yearSelector}>
              <button
                className={styles.yearBtn}
                onClick={() => setYear(y => y - 1)}
                disabled={year <= MIN_YEAR}
              >&lt;</button>
              <span className={styles.yearLabel}>{year}</span>
              <button
                className={styles.yearBtn}
                onClick={() => setYear(y => y + 1)}
                disabled={year >= currentYear}
              >&gt;</button>
            </div>
          </div>

          {isLoading ? (
            <div className={styles.loading}>{t('dashboard.loading')}</div>
          ) : (
            <div ref={ref}>
              <div className={`${styles.legend} ${revealClass}`}>
                <span className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.green}`} />
                  30+ min
                </span>
                <span className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.yellow}`} />
                  2-29 min
                </span>
                <span className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.red}`} />
                  &lt;2 min
                </span>
                <span className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.future}`} />
                  —
                </span>
              </div>

              <div className={`${styles.monthsGrid} ${revealClass} ${anim.scrollRevealDelay1}`}>
                {months.map(({ month, participated, grid }) => (
                  <div key={month} className={styles.monthBlock}>
                    <div className={styles.monthName}>{t(`month.${month}`)}</div>
                    <div className={styles.calendar}>
                      {weekdays.map(wd => (
                        <div key={wd} className={styles.weekdayHeader}>{wd}</div>
                      ))}
                      {grid.map((cell, idx) =>
                        cell === null ? (
                          <div key={`e-${idx}`} className={styles.emptyCell} />
                        ) : (
                          <div
                            key={cell.date}
                            className={`${styles.dayCell} ${getDayColor(cell.minutes, cell.date, participated)}`}
                            title={`${cell.date}: ${cell.minutes} min`}
                          >
                            <span className={styles.dayNum}>{cell.day}</span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Container>
      </main>

        <Footer />
      </div>
    </PageTransition>
  );
}
