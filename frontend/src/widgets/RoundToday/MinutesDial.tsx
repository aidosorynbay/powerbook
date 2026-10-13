import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/shared/lib';
import { track } from '@/shared/lib/analytics';
import { tick } from './haptics';
import styles from './RoundToday.module.css';

/**
 * Today's minutes on a clock face you wind with a finger (the founder's
 * idea, 2026-10-13): one full turn is 60 minutes, and the hand keeps going
 * round for a second hour and more; back the other way takes minutes off.
 * A tap in the middle types the number instead. Orange until 30, green from
 * 30, the colours of the calendar.
 *
 * A drag that starts in the middle never winds: sideways it is a swipe to
 * the next page of the card (onSwipe), so the two gestures never fight.
 */

const C = 160;
const R = 128;
const MAX = 1440;
const GOAL = 30;
const COACH_KEY = 'pb.dial.coach';

const pt = (m: number) => {
  const a = (m / 60) * Math.PI * 2 - Math.PI / 2;
  return [C + R * Math.cos(a), C + R * Math.sin(a)] as const;
};
const arcPath = (m: number) => {
  if (m <= 0) return '';
  const mm = Math.min(m, 59.999);
  const [x, y] = pt(mm);
  return `M ${C} ${C - R} A ${R} ${R} 0 ${mm > 30 ? 1 : 0} 1 ${x} ${y}`;
};

const TICKS = Array.from({ length: 60 }, (_, i) => {
  const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
  const strong = i % 5 === 0;
  const r2 = strong ? 156 : 152;
  return { x1: C + 148 * Math.cos(a), y1: C + 148 * Math.sin(a), x2: C + r2 * Math.cos(a), y2: C + r2 * Math.sin(a), strong };
});

function seenCoach(): boolean {
  try {
    return localStorage.getItem(COACH_KEY) === '1';
  } catch {
    return true;
  }
}

export function MinutesDial({
  value,
  onChange,
  readOnly = false,
  onSwipe,
}: {
  value: number;
  onChange: (minutes: number) => void;
  /** Several books: the total is their sum and is changed book by book. */
  readOnly?: boolean;
  onSwipe?: (dir: 1 | -1) => void;
}) {
  const { t } = useI18n();
  const wrap = useRef<HTMLDivElement>(null);
  const total = useRef(value);
  const lastStep = useRef(Math.floor(value / 5));
  const [dragging, setDragging] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [coach, setCoach] = useState(false);
  const [ghost, setGhost] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // the mark the hand just crossed glows a moment (the detent you see)
  const [lit, setLit] = useState<number | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const drag = useRef<{ a: number; x: number; y: number; moved: boolean; ring: boolean } | null>(null);

  useEffect(() => {
    if (!dragging) total.current = value;
  }, [value, dragging]);

  const set = useCallback(
    (m: number, haptic: boolean) => {
      const v = Math.max(0, Math.min(MAX, Math.round(m)));
      if (haptic) {
        // a tick for every 5 minutes crossed, a strong one at 30 and on each full hour
        const step = Math.floor(v / 5);
        if (step !== lastStep.current) {
          const crossed = Math.max(step, lastStep.current) * 5;
          tick(crossed === GOAL || crossed % 60 === 0);
          setLit(crossed % 60);
          window.setTimeout(() => setLit(null), 120);
        }
        lastStep.current = step;
      }
      if (v !== value) onChange(v);
    },
    [onChange, value],
  );

  const angleAt = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    return { a: Math.atan2(y, x), d: Math.hypot(x, y) / (r.width / 2) };
  };

  const onDown = (e: React.PointerEvent) => {
    if (typing) return;
    const { a, d } = angleAt(e);
    const ring = d > 0.55 && !readOnly;
    drag.current = { a, x: e.clientX, y: e.clientY, moved: false, ring };
    wrap.current?.setPointerCapture(e.pointerId);
    if (ring) {
      total.current = value;
      lastStep.current = Math.floor(value / 5);
      // nothing wound yet: a touch on the ring puts the hand there
      if (value === 0) {
        let m = ((a + Math.PI / 2) / (Math.PI * 2)) * 60;
        if (m < 0) m += 60;
        if (m < 50) {
          total.current = m;
          set(m, true);
        }
      }
      setDragging(true);
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    if (!g.ring) {
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (Math.hypot(dx, dy) > 6) g.moved = true;
      if (onSwipe && Math.abs(dx) > 24 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
        drag.current = null;
        onSwipe(dx < 0 ? 1 : -1);
      }
      return;
    }
    const { a } = angleAt(e);
    let da = a - g.a;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    g.a = a;
    g.moved = true;
    total.current = Math.max(0, Math.min(MAX, total.current + (da / (Math.PI * 2)) * 60));
    set(total.current, true);
  };

  const onUp = () => {
    const g = drag.current;
    drag.current = null;
    setDragging(false);
    if (g && !g.ring && !g.moved && !readOnly) {
      setDraft(value ? String(value) : '');
      setTyping(true);
    }
    if (g?.ring && g.moved) track('dial_wound', { minutes: value });
  };

  const commitTyped = () => {
    const v = parseInt(draft, 10);
    setTyping(false);
    if (Number.isFinite(v)) {
      total.current = v;
      set(v, false);
      track('dial_typed', { minutes: v });
    }
  };

  // First visit: the face is lit, a ghost hand winds to 32 and back, one card explains.
  useEffect(() => {
    if (readOnly || seenCoach()) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setTimeout(() => {
      // the dial in the middle of the screen first, so the light and the card both fit
      wrap.current?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
      setCoach(true);
      track('hint_shown', { el: 'dial_coach', visit_n: 1 });
    }, 700);
    return () => window.clearTimeout(id);
  }, [readOnly]);
  useEffect(() => {
    if (!coach) return;
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      // measured every frame: the page may still be settling (fonts, the calendar loading above)
      if (wrap.current) setRect(wrap.current.getBoundingClientRect());
      const s = ((now - t0) / 1000) % 4.2;
      const m = s < 2.2 ? 32 * (1 - (1 - s / 2.2) ** 2) : s < 2.8 ? 32 : s < 3.6 ? 32 * (1 - (s - 2.8) / 0.8) : 0;
      setGhost(m);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [coach]);
  const endCoach = () => {
    setCoach(false);
    setGhost(null);
    try {
      localStorage.setItem(COACH_KEY, '1');
    } catch {
      /* the hint may come back next time */
    }
  };

  const shown = ghost !== null ? Math.round(ghost) : value;
  const done = shown >= GOAL;
  const laps = Math.floor(shown / 60);
  const rest = shown - laps * 60;
  const full = laps > 0 && rest === 0;
  const d = full ? arcPath(59.999) : arcPath(rest);
  const [kx, ky] = pt(full ? 60 : rest);
  const tone = done ? styles.ok : styles.todo;
  const lapLabel = laps + (rest > 0 ? 1 : 0);

  const box = coach ? rect : null;
  // the card under the dial if it fits, else over it, else at the foot of the screen
  const cardH = card.current?.offsetHeight ?? 170;
  const cardTop = box
    ? box.bottom + 16 + cardH <= window.innerHeight - 8
      ? box.bottom + 16
      : box.top - 16 - cardH >= 8
        ? box.top - 16 - cardH
        : window.innerHeight - cardH - 12
    : undefined;

  return (
    <>
      <div
        ref={wrap}
        className={`${styles.dial} ${tone} ${dragging ? styles.dragging : ''} ${readOnly ? styles.dialRead : ''}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="slider"
        aria-label={t('dial.label')}
        aria-valuemin={0}
        aria-valuemax={MAX}
        aria-valuenow={value}
        aria-valuetext={t('dial.valueText', { n: value })}
        tabIndex={0}
        onKeyDown={(e) => {
          if (readOnly) return;
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); set(value + (e.shiftKey ? 10 : 1), false); }
          if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); set(value - (e.shiftKey ? 10 : 1), false); }
          if (e.key === 'Enter' && !typing) { e.preventDefault(); setDraft(value ? String(value) : ''); setTyping(true); }
        }}
      >
        <svg viewBox="0 0 320 320" aria-hidden="true">
          <defs>
            <filter id="dialGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
          </defs>
          {TICKS.map((k, i) => (
            <line
              key={i}
              x1={k.x1}
              y1={k.y1}
              x2={k.x2}
              y2={k.y2}
              className={lit !== null && i === lit ? styles.tickLit : k.strong ? styles.tickStrong : styles.tick}
              strokeWidth={lit !== null && i === lit ? 4 : k.strong ? 2 : 1.2}
            />
          ))}
          <circle className={styles.track} cx={C} cy={C} r={R} strokeWidth={18} fill="none" />
          {laps > 0 && <circle className={styles.lapDone} cx={C} cy={C} r={R} strokeWidth={18} fill="none" />}
          {d && <path className={styles.arcGlow} d={d} strokeWidth={18} filter="url(#dialGlow)" />}
          {d && <path className={styles.arc} d={d} strokeWidth={18} />}
          <path className={styles.goalMark} d={`M ${C - 5} ${C + R - 18} L ${C + 5} ${C + R - 18} L ${C} ${C + R - 11} Z`} />
          {!readOnly && (
            <g transform={`translate(${kx} ${ky})`}>
              <circle className={styles.knobHalo} r={dragging ? 26 : 20} />
              <circle className={styles.knobDot} r={7} />
            </g>
          )}
        </svg>
        {shown > 60 && <span className={styles.lap}>{t('dial.lap', { n: lapLabel })}</span>}
        <div className={styles.center}>
          <div>
            <div className={styles.todayLabel}>{t('dial.today')}</div>
            {typing ? (
              <input
                className={styles.dialInput}
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX}
                autoFocus
                value={draft}
                placeholder="0"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitTyped}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commitTyped();
                  if (e.key === 'Escape') setTyping(false);
                }}
              />
            ) : (
              <div className={styles.num}>{shown}</div>
            )}
            <div className={styles.unit}>{t('dial.min')}</div>
            <div className={`${styles.left} ${done ? styles.leftOk : ''}`}>
              {done ? (
                t('dial.counted')
              ) : shown === 0 ? (
                <>
                  {t('dial.wind')}
                  {!readOnly && <span className={styles.orType}>{t('dial.orType')}</span>}
                </>
              ) : (
                t('dial.toGo', { n: GOAL - shown })
              )}
            </div>
          </div>
        </div>
      </div>

      {coach && createPortal(
        <div className={styles.coach} onPointerDown={(e) => { if (e.target === e.currentTarget) endCoach(); }}>
          {box && (
            <div
              className={styles.coachSpot}
              style={{ left: box.left - 10, top: box.top - 10, width: box.width + 20, height: box.height + 20 }}
            />
          )}
          {box && ghost !== null && (() => {
            const a = (ghost / 60) * Math.PI * 2 - Math.PI / 2;
            const rr = (R / 320) * box.width;
            return <div className={styles.coachFinger} style={{ transform: `translate(${box.left + box.width / 2 + rr * Math.cos(a)}px, ${box.top + box.height / 2 + rr * Math.sin(a)}px)` }} />;
          })()}
          <div ref={card} className={styles.coachCard} style={box ? { top: cardTop, left: Math.max(16, Math.min(box.left + box.width / 2 - 200, window.innerWidth - 416)), right: 'auto', width: Math.min(400, window.innerWidth - 32) } : { visibility: 'hidden' }}>
            <b>{t('dial.coachTitle')}</b>
            <p>{t('dial.coachText')}</p>
            <button type="button" onClick={endCoach}>{t('dial.coachOk')}</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
