import { CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { track, useI18n } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import styles from './MotionReel.module.css';

/**
 * A short motion film of what PowerBook is, made of the site's own parts
 * rather than a video file: it speaks the page's language, weighs nothing,
 * and stays sharp at any size. Nine scenes, about fifty seconds, looping
 * while it is on screen; a tap pauses it, the bars at the top jump to a scene.
 * Once the viewer turns a scene by hand (arrows, bars, a swipe), the film
 * stops turning on its own and waits for them; «Авто» gives the timer back.
 */

type Scene = { key: string; ms: number };

const SCENES: Scene[] = [
  { key: 's1', ms: 5200 },
  { key: 's2', ms: 5600 },
  { key: 's3', ms: 5600 },
  { key: 's4', ms: 6400 },
  { key: 's5', ms: 5600 },
  { key: 's6', ms: 5600 },
  { key: 's7', ms: 6000 },
  { key: 's8', ms: 5800 },
  { key: 's9', ms: 5200 },
];

const d = (s: number): CSSProperties => ({ ['--d' as string]: `${s}s` });

function Intro() {
  const { t } = useI18n();
  return (
    <div className={styles.intro}>
      <div className={`${styles.logo} ${styles.pop}`} style={d(0.2)}>
        <img src="/logo-icon.png" alt="" className={styles.logoImg} />
        <span>PowerBook</span>
      </div>
      <div className={styles.counters}>
        {[
          ['1000+', t('reel.readers')],
          ['64', t('reel.circles')],
          ['30', t('reel.perDay')],
        ].map(([n, label], i) => (
          <div key={label} className={`${styles.counter} ${styles.rise}`} style={d(0.9 + i * 0.3)}>
            <strong>{n}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className={styles.spines} aria-hidden="true">
        {['#c0392b', '#e67e22', '#2e86ab', '#6c5ce7', '#27ae60', '#d35400', '#8e44ad', '#16a085', '#e1b12c'].map((c, i) => (
          <i key={c} style={{ ...d(1.9 + i * 0.07), background: c, height: `${58 + ((i * 37) % 40)}%` }} />
        ))}
      </div>
    </div>
  );
}

function Join() {
  const { t } = useI18n();
  return (
    <div className={styles.join}>
      <div className={styles.month}>
        {Array.from({ length: 30 }, (_, i) => (
          <i
            key={i}
            className={i < 10 ? `${styles.dayOpen} ${styles.glow}` : styles.dayLater}
            style={d(0.2 + (i < 10 ? i * 0.12 : 1.4))}
          >
            {i + 1}
          </i>
        ))}
      </div>
      <div className={styles.joinRow}>
        <span className={`${styles.joinBtn} ${styles.press}`} style={d(2.4)}>
          <span className={styles.joinLabel}>{t('reel.joinBtn')}</span>
          <span className={styles.joinDone}>✓ {t('reel.joined')}</span>
        </span>
        <span className={styles.cursor} style={d(1.9)} aria-hidden="true" />
      </div>
    </div>
  );
}

function Timer() {
  const { t } = useI18n();
  return (
    <div className={styles.timer}>
      <svg viewBox="0 0 120 120" className={styles.ring} aria-hidden="true">
        <circle cx="60" cy="60" r="52" className={styles.ringTrack} />
        <circle cx="60" cy="60" r="52" className={styles.ringFill} />
      </svg>
      <div className={styles.timerText}>
        <strong className={styles.count30} />
        <span>{t('rings.minutesShort')}</span>
      </div>
      <div className={styles.book} aria-hidden="true">
        <i className={styles.pageL} />
        <i className={styles.pageR} />
        <i className={styles.pageFlip} />
      </div>
    </div>
  );
}

// A month's days as they turn out: mostly green, a few short, one missed.
const MONTH = 'ggggyggggggrgggggygggggggggygg';

function Log() {
  const { t } = useI18n();
  return (
    <div className={styles.log}>
      <div className={`${styles.today} ${styles.rise}`} style={d(0.2)}>
        <span className={styles.todayLabel}>{t('rings.today')}</span>
        <span className={styles.todayField}>
          <span className={styles.key} style={d(0.8)}>4</span>
          <span className={styles.key} style={d(1.1)}>5</span>
          <span className={styles.caret} />
          <span className={styles.unit}>{t('rings.minutesShort')}</span>
        </span>
        <span className={`${styles.saveBtn} ${styles.press}`} style={d(1.7)}>{t('reel.save')}</span>
      </div>
      <div className={styles.cal}>
        {MONTH.split('').map((c, i) => (
          <i
            key={i}
            className={`${c === 'g' ? styles.calGreen : c === 'y' ? styles.calYellow : styles.calRed} ${styles.fill}`}
            style={d(2.2 + i * 0.09)}
          />
        ))}
      </div>
    </div>
  );
}

function Leaders() {
  const { t } = useI18n();
  // Where each row stands before and after: the reader climbs from fourth to second.
  const rows = [
    { name: 'Айгерим', days: 27, from: 0, to: 0 },
    { name: 'Ерлан', days: 25, from: 1, to: 2 },
    { name: 'Дана', days: 24, from: 2, to: 3 },
    { name: t('reel.you'), days: 26, from: 3, to: 1, you: true },
    { name: 'Нурбол', days: 21, from: 4, to: 4 },
  ];
  return (
    <div className={styles.board}>
      {rows.map((r, i) => (
        <div
          key={r.name}
          className={`${styles.row} ${r.you ? styles.rowYou : ''}`}
          style={{ ...d(0.15 + i * 0.1), ['--from' as string]: r.from, ['--to' as string]: r.to }}
        >
          <span className={styles.rank}>{r.to + 1}</span>
          <span className={styles.rowName}>{r.name}</span>
          <span className={styles.rowDays}>
            {r.you ? <em className={styles.daysYou} /> : r.days} {t('reel.days')}
          </span>
        </div>
      ))}
    </div>
  );
}

function Room() {
  const seats = ['#e67e22', '#2e86ab', '#27ae60', '#8e44ad'];
  return (
    <div className={styles.room}>
      <div className={styles.lamp} aria-hidden="true" />
      <div className={styles.seats}>
        {seats.map((c, i) => (
          <div key={c} className={`${styles.seat} ${styles.rise}`} style={d(0.3 + i * 0.25)}>
            <span className={styles.avatar} style={{ background: c }}>
              <i />
            </span>
            <span className={styles.seatTimer} style={{ ['--start' as string]: 12 + i * 7 }}>
              <b><Icon name="book" size="em" /></b> <span className={styles.ticking} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Results() {
  const { t } = useI18n();
  return (
    <div className={styles.results}>
      <div className={styles.half}>
        <span className={styles.halfLabel}>{t('reel.top')}</span>
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${styles.resRow} ${styles.rise}`} style={d(0.2 + i * 0.1)}>
            <i />
            <b className={`${styles.gift} ${styles.popIn}`} style={d(2.6 + i * 0.3)}><Icon name="gift" size="em" /></b>
          </div>
        ))}
      </div>
      <div className={styles.divider} />
      <div className={styles.half}>
        <span className={styles.halfLabel}>{t('reel.bottom')}</span>
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${styles.resRow} ${styles.resLow} ${styles.rise}`} style={d(0.6 + i * 0.1)}>
            <i />
            <b className={styles.flyBook} style={d(1.4 + i * 0.3)}><Icon name="book" size="em" /></b>
          </div>
        ))}
      </div>
    </div>
  );
}

function Shelf() {
  const { t } = useI18n();
  const books = ['#c0392b', '#2e86ab', '#e1b12c', '#6c5ce7', '#16a085', '#d35400', '#34495e'];
  return (
    <div className={styles.shelfScene}>
      <div className={styles.shelfBooks}>
        {books.map((c, i) => (
          <i key={c} className={styles.drop} style={{ ...d(0.15 + i * 0.13), background: c, height: `${62 + ((i * 23) % 30)}%` }}>
            {i === 1 && <b className={`${styles.stamp} ${styles.popIn}`} style={d(1.5)}>9.0</b>}
            {i === 4 && <b className={`${styles.stamp} ${styles.popIn}`} style={d(1.8)}>★ 4.3</b>}
          </i>
        ))}
      </div>
      <div className={styles.plank} />
      <div className={styles.chips}>
        {[t('libtabs.books'), t('libtabs.market'), t('libtabs.reading')].map((c, i) => (
          <span key={c} className={`${styles.chip} ${styles.rise}`} style={d(2.3 + i * 0.25)}>
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function Outro() {
  return (
    <div className={styles.outro}>
      <div className={`${styles.logo} ${styles.pop}`} style={d(0.2)}>
        <img src="/logo-icon.png" alt="" className={styles.logoImg} />
        <span>PowerBook</span>
      </div>
      <div className={`${styles.bigNumber} ${styles.rise}`} style={d(0.7)}>
        30<small>′</small>
      </div>
    </div>
  );
}

const VISUALS: Record<string, () => JSX.Element> = {
  s1: Intro,
  s2: Join,
  s3: Timer,
  s4: Log,
  s5: Leaders,
  s6: Room,
  s7: Results,
  s8: Shelf,
  s9: Outro,
};

export function MotionReel() {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  // Turned by hand: the viewer sets the pace now, the timer stays out of it.
  const [manual, setManual] = useState(false);
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const started = useRef(0);
  const elapsedBefore = useRef(0);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const swipedAt = useRef(0);

  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Only while it can be seen: no film running behind the reader's back.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const go = useCallback((next: number) => {
    setIndex((next + SCENES.length) % SCENES.length);
    elapsedBefore.current = 0;
    started.current = performance.now();
    setProgress(0);
  }, []);

  // A scene turned by hand: from here on only the viewer turns them.
  const turn = useCallback((next: number) => {
    setManual(true);
    setPlaying(true);
    go(next);
    track('reel_nav', { scene: ((next + SCENES.length) % SCENES.length) + 1 });
  }, [go]);

  const resumeAuto = () => {
    track('reel_auto');
    elapsedBefore.current = 0;
    setProgress(0);
    setManual(false);
    setPlaying(true);
  };

  // The scene's own motion plays whenever the film is on screen and not paused;
  // only moving on to the next scene waits for the viewer once they have taken over.
  const animating = playing && visible && !reduced;
  const running = animating && !manual;

  const onTouchStart = (e: React.TouchEvent) => {
    const t0 = e.changedTouches[0];
    touch.current = { x: t0.clientX, y: t0.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    // A sideways swipe turns the scene; anything mostly vertical is the page scrolling.
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    swipedAt.current = Date.now();
    turn(dx < 0 ? index + 1 : index - 1);
  };

  useEffect(() => {
    if (!running) return;
    started.current = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = elapsedBefore.current + (now - started.current);
      const dur = SCENES[index].ms;
      if (elapsed >= dur) {
        go(index + 1);
        return;
      }
      setProgress(elapsed / dur);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      elapsedBefore.current += performance.now() - started.current;
    };
  }, [running, index, go]);

  const scene = SCENES[index];
  const Visual = VISUALS[scene.key];

  return (
    <div
      ref={box}
      className={`${styles.reel} ${animating ? '' : styles.paused}`}
      role="region"
      aria-roledescription="video"
      aria-label={t('reel.label')}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') turn(index + 1);
        else if (e.key === 'ArrowLeft') turn(index - 1);
        else return;
        e.preventDefault();
      }}
    >
      <div className={styles.bars}>
        {SCENES.map((s, i) => (
          <button
            key={s.key}
            type="button"
            className={styles.bar}
            onClick={() => turn(i)}
            aria-label={t('reel.scene', { n: i + 1 })}
            aria-current={i === index ? 'step' : undefined}
          >
            <span style={{ transform: `scaleX(${i < index ? 1 : i === index ? (manual ? 1 : progress) : 0})` }} />
          </button>
        ))}
      </div>

      <button
        type="button"
        className={styles.stage}
        onClick={() => {
          // the tap that ends a swipe is not a pause
          if (Date.now() - swipedAt.current < 400) return;
          setPlaying((p) => !p);
        }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        aria-label={playing ? t('reel.pause') : t('reel.play')}
      >
        {/* A new key per scene restarts its animations from the top. */}
        <div key={`${scene.key}-${index}`} className={styles.visual}>
          <Visual />
        </div>
        {!playing && !reduced && visible && (
          <span className={styles.playIcon} aria-hidden="true">
            <Icon name="play" size="em" />
          </span>
        )}
      </button>

      <div className={styles.caption} aria-live="polite">
        <h3 key={`t-${index}`} className={styles.captionTitle}>{t(`reel.${scene.key}.t`)}</h3>
        <p key={`d-${index}`} className={styles.captionText}>{t(`reel.${scene.key}.d`)}</p>
      </div>

      <div className={styles.controls}>
        <button type="button" onClick={() => turn(index - 1)} aria-label={t('reel.prev')}>‹</button>
        <span>
          {index + 1} / {SCENES.length}
        </span>
        <button type="button" onClick={() => turn(index + 1)} aria-label={t('reel.next')}>›</button>
        {manual && !reduced && (
          <button type="button" className={styles.autoBtn} onClick={resumeAuto} title={t('reel.autoHint')}>
            <Icon name="play" size="em" />
            {t('reel.auto')}
          </button>
        )}
      </div>
    </div>
  );
}
