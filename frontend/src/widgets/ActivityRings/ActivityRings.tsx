import { useEffect, useState } from 'react';
import styles from './ActivityRings.module.css';

export type ActivityRing = {
  key: string;
  /** Short name of what the ring measures, e.g. "Today" */
  label: string;
  value: number;
  /** What closing the ring takes. Never pass 0 — the caller clamps it. */
  target: number;
  unit: string;
  /** Any CSS color; a theme token is what callers normally pass. */
  color: string;
};

/** A plain running tally shown under the rings — no goal, no arc. */
export type RingTotal = {
  key: string;
  label: string;
  value: string;
};

const SIZE = 180;
const STROKE = 15;
/** Bare space between two rings, so they read as separate arcs. */
const GAP = 9;

/**
 * Concentric progress rings, Apple-Fitness style: one arc per goal, all
 * starting at twelve o'clock, with the numbers spelled out beside them.
 * A ring that is over its target stays closed rather than overshooting,
 * but the legend still shows what was actually done.
 */
export function ActivityRings({ rings, totals = [] }: { rings: ActivityRing[]; totals?: RingTotal[] }) {
  // The arcs grow from empty on the first paint. Drawing them full and
  // animating backwards would flash the finished state first.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const center = SIZE / 2;

  return (
    <div className={styles.block}>
      <div className={styles.wrap}>
        <svg
          className={styles.svg}
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={rings.map(r => `${r.label}: ${r.value} / ${r.target} ${r.unit}`).join('. ')}
        >
          {rings.map((ring, i) => {
            const radius = (SIZE - STROKE) / 2 - i * (STROKE + GAP);
            const circumference = 2 * Math.PI * radius;
            const filled = ring.target > 0 ? Math.min(Math.max(ring.value / ring.target, 0), 1) : 0;
            return (
              <g key={ring.key} transform={`rotate(-90 ${center} ${center})`}>
                <circle
                  className={styles.track}
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  strokeWidth={STROKE}
                />
                {/* Nothing logged draws nothing. A zero-length dash with a
                    round cap still paints both caps, which showed up as a
                    stray dot floating at twelve o'clock. */}
                {filled > 0 && (
                  <circle
                    className={styles.arc}
                    cx={center}
                    cy={center}
                    r={radius}
                    fill="none"
                    stroke={ring.color}
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    strokeDasharray={`${circumference * (drawn ? filled : 0)} ${circumference}`}
                  />
                )}
              </g>
            );
          })}
        </svg>

        <dl className={styles.legend}>
          {rings.map(ring => (
            <div key={ring.key} className={styles.legendRow}>
              <dt className={styles.legendLabel}>{ring.label}</dt>
              <dd className={styles.legendValue}>
                <span className={styles.legendNumbers} style={{ color: ring.color }}>
                  {ring.value}
                  <span className={styles.legendSlash}>/</span>
                  {ring.target}
                </span>
                <span className={styles.legendUnit}>{ring.unit}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Totals run the full width below the rings rather than beside them:
          they are a tally with nothing to close, so an arc would promise a
          goal that does not exist — but they are the numbers people quote,
          so they get the room to be read at a glance. */}
      {totals.length > 0 && (
        <div className={styles.totals}>
          {totals.map(total => (
            <div key={total.key} className={styles.total}>
              <span className={styles.totalLabel}>{total.label}</span>
              <span className={styles.totalValue}>{total.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
