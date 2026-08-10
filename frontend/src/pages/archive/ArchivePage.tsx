import { useState, useEffect, useCallback, useMemo, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useI18n, apiGet, type YearlyArchiveResponse, type YearlyRosterResponse } from '@/shared/lib';
import { Container, PageTransition } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import styles from './ArchivePage.module.css';

const INTENSITY_CAP_MINUTES = 120;

function sharedDayIntensity(count: number, maxCount: number): number {
  if (count <= 0) return 0;
  // Square root curve so mid-range days are still visually distinct instead
  // of everything slamming into full intensity once counts get into the
  // hundreds (which is normal for this community's busiest years).
  const ratio = Math.sqrt(count / Math.max(maxCount, 1));
  return 0.28 + 0.6 * Math.min(ratio, 1);
}

type DayCell = {
  day: number;
  date: string;
  minutes: number;
  comment: string | null;
  book_finished: boolean;
};

type ViewMode = 'personal' | 'shared';

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
  const [viewMode, setViewMode] = useState<ViewMode>('personal');
  const [archive, setArchive] = useState<YearlyArchiveResponse | null>(null);
  const [roster, setRoster] = useState<YearlyRosterResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<DayCell | null>(null);
  const [rosterModalDate, setRosterModalDate] = useState<string | null>(null);

  const fetchArchive = useCallback(async (y: number) => {
    setIsLoading(true);
    const { data } = await apiGet<YearlyArchiveResponse>(
      `/rounds/archive/${y}`,
      { requireAuth: true }
    );
    if (data) setArchive(data);
    setIsLoading(false);
  }, []);

  const fetchRoster = useCallback(async (y: number) => {
    setIsLoading(true);
    const { data } = await apiGet<YearlyRosterResponse>(
      `/rounds/archive/${y}/roster`,
      { requireAuth: true }
    );
    if (data) setRoster(data);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (viewMode === 'personal') {
      fetchArchive(year);
    } else {
      fetchRoster(year);
    }
  }, [year, viewMode, fetchArchive, fetchRoster]);

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

  // Shared/group view: same 12-month grid shape, but each cell just needs
  // day + date — the participant count comes from `roster` at render time.
  const sharedMonths = useMemo(() => {
    const result: Array<{ month: number; grid: Array<{ day: number; date: string } | null> }> = [];
    for (let m = 1; m <= 12; m++) {
      const firstDay = new Date(year, m - 1, 1);
      let startDayOfWeek = firstDay.getDay() - 1;
      if (startDayOfWeek < 0) startDayOfWeek = 6;
      const daysInMonth = new Date(year, m, 0).getDate();

      const grid: Array<{ day: number; date: string } | null> = [];
      for (let i = 0; i < startDayOfWeek; i++) grid.push(null);
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        grid.push({ day: d, date: dateStr });
      }
      result.push({ month: m, grid });
    }
    return result;
  }, [year]);

  const maxSharedCount = useMemo(() => {
    if (!roster) return 1;
    let max = 1;
    for (const entries of Object.values(roster.days)) {
      if (entries.length > max) max = entries.length;
    }
    return max;
  }, [roster]);

  const weekdays = useMemo(() => [
    t('weekday.mon'), t('weekday.tue'), t('weekday.wed'),
    t('weekday.thu'), t('weekday.fri'), t('weekday.sat'), t('weekday.sun')
  ], [t]);

  const formattedSelectedDate = useMemo(() => {
    if (!selectedDay) return '';
    const d = new Date(selectedDay.date + 'T00:00:00');
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  }, [selectedDay]);

  const formattedRosterDate = useMemo(() => {
    if (!rosterModalDate) return '';
    const d = new Date(rosterModalDate + 'T00:00:00');
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  }, [rosterModalDate]);

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

          <div className={styles.viewTabs}>
            <button
              className={`${styles.viewTab} ${viewMode === 'personal' ? styles.viewTabActive : ''}`}
              onClick={() => setViewMode('personal')}
            >
              {t('archive.personal')}
            </button>
            <button
              className={`${styles.viewTab} ${viewMode === 'shared' ? styles.viewTabActive : ''}`}
              onClick={() => setViewMode('shared')}
            >
              {t('archive.shared')}
            </button>
          </div>

          {isLoading ? (
            <div className={styles.loading}>{t('dashboard.loading')}</div>
          ) : viewMode === 'personal' ? (
            <div>
              <div className={styles.legend}>
                <span className={styles.legendItem}>
                  <span className={styles.legendGradient}>
                    <span className={`${styles.legendDot} ${styles.green}`} style={{ '--intensity': 0.35 } as CSSProperties} />
                    <span className={`${styles.legendDot} ${styles.green}`} style={{ '--intensity': 0.65 } as CSSProperties} />
                    <span className={`${styles.legendDot} ${styles.green}`} style={{ '--intensity': 1 } as CSSProperties} />
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
          ) : (
            <div>
              <div className={styles.legend}>
                <span className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.circleDayActive}`} />
                  {t('archive.sharedLegend')}
                </span>
              </div>

              <div className={styles.monthsGrid}>
                {sharedMonths.map(({ month, grid }) => (
                  <div key={month} className={styles.monthBlock}>
                    <div className={styles.monthName}>{t(`month.${month}`)}</div>
                    <div className={styles.calendar}>
                      {weekdays.map(wd => (
                        <div key={`s-${wd}`} className={styles.weekdayHeader}>{wd}</div>
                      ))}
                      {grid.map((cell, idx) => {
                        if (cell === null) return <div key={`se-${idx}`} className={styles.emptyCell} />;
                        const count = roster?.days[cell.date]?.length ?? 0;
                        const clickable = count > 0;
                        return (
                          <div
                            key={cell.date}
                            className={`${styles.dayCell} ${count > 0 ? styles.circleDayActive : styles.future} ${clickable ? styles.dayCellClickable : ''}`}
                            style={count > 0 ? ({ '--intensity': sharedDayIntensity(count, maxSharedCount) } as CSSProperties) : undefined}
                            title={`${cell.date}: ${count} ${t('archive.participantsShort')}`}
                            onClick={clickable ? () => setRosterModalDate(cell.date) : undefined}
                          >
                            <span className={styles.dayNum}>{cell.day}</span>
                            {count > 0 && <span className={styles.circleDayCount}>{count}</span>}
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

      {rosterModalDate && createPortal(
        <div className={styles.modal} onClick={() => setRosterModalDate(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>{formattedRosterDate}</div>
            <ul className={styles.rosterList}>
              {(roster?.days[rosterModalDate] ?? []).map(entry => (
                <li key={entry.user_id} className={styles.rosterRow}>
                  <div className={styles.rosterInfo}>
                    <span className={styles.rosterName}>
                      {entry.book_finished && '★ '}
                      {entry.display_name}
                    </span>
                    {entry.comment && <span className={styles.rosterComment}>{entry.comment}</span>}
                  </div>
                  <span className={styles.rosterMinutes}>{entry.minutes}m</span>
                </li>
              ))}
            </ul>
          </div>
        </div>,
        document.body
      )}
    </PageTransition>
  );
}
