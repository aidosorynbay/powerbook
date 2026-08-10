import { useState, useEffect, useCallback, useMemo, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useI18n, apiGet, type YearlyArchiveResponse } from '@/shared/lib';
import { Container, PageTransition } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import styles from './ArchivePage.module.css';

const INTENSITY_CAP_MINUTES = 120;

type DayCell = {
  day: number;
  date: string;
  minutes: number;
  comment: string | null;
  book_finished: boolean;
};

function isFutureDay(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr + 'T00:00:00') > today;
}

function getDayCell(minutes: number, dateStr: string, participated: boolean): { className: string; style?: CSSProperties } {
  if (isFutureDay(dateStr)) return { className: styles.future };
  if (minutes >= 30) {
    const intensity = 0.35 + 0.65 * Math.min(minutes / INTENSITY_CAP_MINUTES, 1);
    return { className: styles.green, style: { '--intensity': intensity } as CSSProperties };
  }
  if (minutes >= 2) return { className: styles.yellow };
  // If user didn't participate in this month's round, show gray instead of red
  if (!participated) return { className: styles.future };
  return { className: styles.red };
}

const MIN_YEAR = 2021;

export function ArchivePage() {
  const { t } = useI18n();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [archive, setArchive] = useState<YearlyArchiveResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<DayCell | null>(null);

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
      grid: Array<DayCell | null>;
    }> = [];

    for (let m = 1; m <= 12; m++) {
      const firstDay = new Date(year, m - 1, 1);
      let startDayOfWeek = firstDay.getDay() - 1;
      if (startDayOfWeek < 0) startDayOfWeek = 6;

      const daysInMonth = new Date(year, m, 0).getDate();

      const monthDays = archive?.months[String(m)] ?? [];
      const dayMap = new Map(monthDays.map(d => [d.date, d]));

      const grid: Array<DayCell | null> = [];

      for (let i = 0; i < startDayOfWeek; i++) {
        grid.push(null);
      }

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const found = dayMap.get(dateStr);
        grid.push({
          day: d,
          date: dateStr,
          minutes: found?.minutes ?? 0,
          comment: found?.comment ?? null,
          book_finished: found?.book_finished ?? false,
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

  const formattedSelectedDate = useMemo(() => {
    if (!selectedDay) return '';
    const d = new Date(selectedDay.date + 'T00:00:00');
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  }, [selectedDay]);

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
            <div>
              <div className={styles.legend}>
                <span className={styles.legendItem}>
                  <span className={styles.legendGradient}>
                    <span className={styles.legendDot} style={{ '--intensity': 0.35 } as CSSProperties} />
                    <span className={styles.legendDot} style={{ '--intensity': 0.6 } as CSSProperties} />
                    <span className={styles.legendDot} style={{ '--intensity': 1 } as CSSProperties} />
                  </span>
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
                <span className={styles.legendItem}>
                  <span className={styles.legendSymbol}>&#9733;</span>
                  {t('dashboard.legendStar')}
                </span>
                <span className={styles.legendItem}>
                  <span className={styles.legendCommentDot} />
                  {t('dashboard.legendComment')}
                </span>
              </div>

              <div className={styles.monthsGrid}>
                {months.map(({ month, participated, grid }) => (
                  <div key={month} className={styles.monthBlock}>
                    <div className={styles.monthName}>{t(`month.${month}`)}</div>
                    <div className={styles.calendar}>
                      {weekdays.map(wd => (
                        <div key={wd} className={styles.weekdayHeader}>{wd}</div>
                      ))}
                      {grid.map((cell, idx) => {
                        if (cell === null) return <div key={`e-${idx}`} className={styles.emptyCell} />;
                        const { className, style } = getDayCell(cell.minutes, cell.date, participated);
                        const clickable = !isFutureDay(cell.date);
                        return (
                          <div
                            key={cell.date}
                            className={`${styles.dayCell} ${className} ${clickable ? styles.dayCellClickable : ''}`}
                            style={style}
                            title={`${cell.date}: ${cell.minutes} min`}
                            onClick={clickable ? () => setSelectedDay(cell) : undefined}
                          >
                            <span className={styles.dayNum}>{cell.day}</span>
                            {cell.book_finished && <span className={styles.dayStar}>&#9733;</span>}
                            {cell.comment && <span className={styles.dayCommentDot} />}
                          </div>
                        );
                      })}
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

      {selectedDay && createPortal(
        <div className={styles.modal} onClick={() => setSelectedDay(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>{formattedSelectedDate}</div>
            <div className={styles.modalMinutes}>
              {selectedDay.minutes} {t('results.minutes').toLowerCase()}
            </div>
            {selectedDay.book_finished && (
              <div className={styles.modalBookFinished}>
                &#9733; {t('dashboard.bookFinished')}
              </div>
            )}
            {selectedDay.comment ? (
              <div className={styles.modalComment}>{selectedDay.comment}</div>
            ) : (
              <div className={styles.modalNoComment}>{t('archive.noComment')}</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </PageTransition>
  );
}
