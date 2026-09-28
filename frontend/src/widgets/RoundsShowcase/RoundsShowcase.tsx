import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, apiGet, useResolvedTheme } from '@/shared/lib';
import { useScrollReveal } from '@/shared/hooks';
import { Container, Button } from '@/shared/ui';
import anim from '@/shared/styles/animations.module.css';
import styles from './RoundsShowcase.module.css';

type PublicCalendar = {
  year: number;
  days: Record<string, number>;
  peak: number;
  active_days: number;
};

const STEP_KEYS = [
  'showcase.step1',
  'showcase.step2',
  'showcase.step3',
  'showcase.step4',
] as const;

/** Same power curve the archive uses, so both views read alike. */
function intensity(count: number, max: number): number {
  if (count <= 0) return 0;
  const eased = Math.pow(count / Math.max(max, 1), 1.6);
  return 0.08 + 0.92 * Math.min(eased, 1);
}

// The ramp is resolved here rather than with nested color-mix() in CSS:
// a full year is ~365 cells, and five chained mixes each was enough to make
// scrolling stutter on phones. Plain rgb() costs the compositor nothing.
// The stops come from the theme (--heat-ramp-1…6 in theme.css), so the
// preview matches the archive in the dark and on paper alike.
const DARK_RAMP = ['#2E1B45', '#5C2A6E', '#9B3172', '#D2443F', '#F26430', '#F5B72E'];

function readRamp(): string[] {
  const css = getComputedStyle(document.documentElement);
  const stops = [1, 2, 3, 4, 5, 6].map((i) => css.getPropertyValue(`--heat-ramp-${i}`).trim());
  return stops.every((c) => /^#[0-9a-f]{6}$/i.test(c)) ? stops : DARK_RAMP;
}

function rampColor(t: number, ramp: string[]): string {
  const clamped = Math.min(Math.max(t, 0), 1);
  const seg = clamped * (ramp.length - 1);
  const i = Math.min(Math.floor(seg), ramp.length - 2);
  const f = seg - i;
  const a = ramp[i];
  const b = ramp[i + 1];
  const mix = (o: number) => {
    const av = parseInt(a.slice(o, o + 2), 16);
    const bv = parseInt(b.slice(o, o + 2), 16);
    return Math.round(av + (bv - av) * f);
  };
  return `rgb(${mix(1)},${mix(3)},${mix(5)})`;
}

export function RoundsShowcase() {
  const { t } = useI18n();
  const { ref, isVisible } = useScrollReveal<HTMLElement>();
  const theme = useResolvedTheme();
  const ramp = useMemo(readRamp, [theme]);
  const [cal, setCal] = useState<PublicCalendar | null>(null);
  const [year, setYear] = useState<number>(() => new Date().getFullYear());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await apiGet<PublicCalendar>(`/stats/public/calendar?year=${year}`);
      if (!cancelled && data) setCal(data);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [year]);

  // If the current year is barely started, the grid looks empty and sells
  // nothing — fall back to the previous year automatically.
  useEffect(() => {
    if (cal && cal.active_days < 30 && year === new Date().getFullYear()) {
      setYear(y => y - 1);
    }
  }, [cal, year]);

  const months = useMemo(() => {
    const out: Array<{ month: number; cells: Array<{ day: number; date: string; count: number } | null> }> = [];
    for (let m = 1; m <= 12; m++) {
      const first = new Date(year, m - 1, 1);
      let lead = first.getDay() - 1;
      if (lead < 0) lead = 6;
      const dim = new Date(year, m, 0).getDate();
      const cells: Array<{ day: number; date: string; count: number } | null> = [];
      for (let i = 0; i < lead; i++) cells.push(null);
      for (let d = 1; d <= dim; d++) {
        const date = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        cells.push({ day: d, date, count: cal?.days[date] ?? 0 });
      }
      out.push({ month: m, cells });
    }
    return out;
  }, [cal, year]);

  const peak = cal?.peak ?? 1;
  const revealClass = `${anim.scrollReveal} ${isVisible ? anim.scrollRevealVisible : ''}`;

  return (
    <section ref={ref} className={`${styles.showcase} ${revealClass}`}>
      <Container>
        <div className={styles.header}>
          <h2 className={styles.title}>{t('showcase.title')}</h2>
          <p className={styles.subtitle}>{t('showcase.subtitle')}</p>
        </div>

        {/* One flowing line rather than four boxes — the steps are a
            sentence, not four separate things to compare. */}
        <p className={styles.stepsLine}>
          {STEP_KEYS.map((key, i) => (
            <span key={key}>
              {i > 0 && <span className={styles.stepSep}>&nbsp;→&nbsp;</span>}
              <span className={styles.stepPhrase}>{t(key)}</span>
            </span>
          ))}
        </p>

        <div className={styles.calendarCard}>
          <div className={styles.calHead}>
            <span className={styles.calTitle}>
              {t('showcase.calTitle')} <span className={styles.calYear}>{year}</span>
            </span>
            <span className={styles.calLegend}>
              <span className={styles.calLegendLabel}>{t('showcase.calLegend')}</span>
              <span className={styles.calScaleEnd}>1</span>
              <span className={styles.calScale} />
              <span className={styles.calScaleEnd}>{peak}</span>
            </span>
          </div>

          <div className={styles.monthsGrid}>
            {months.map(({ month, cells }) => (
              <div key={month} className={styles.monthBlock}>
                <div className={styles.monthName}>{t(`month.${month}`)}</div>
                <div className={styles.calendar}>
                  {cells.map((cell, idx) =>
                    cell === null ? (
                      <div key={`e-${idx}`} className={styles.emptyCell} />
                    ) : (
                      <div
                        key={cell.date}
                        className={styles.dayCell}
                        style={
                          cell.count > 0
                            ? ({ background: rampColor(intensity(cell.count, peak), ramp) } as CSSProperties)
                            : undefined
                        }
                        title={`${cell.date} — ${cell.count}`}
                      />
                    )
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.calFoot}>
            <span className={styles.calFootText}>{t('showcase.calFoot')}</span>
            <Link to="/archive" className={styles.calLink}>
              <Button variant="secondary" size="md">{t('showcase.openArchive')}</Button>
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
