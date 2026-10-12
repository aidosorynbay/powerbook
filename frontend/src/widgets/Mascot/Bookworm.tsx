import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/shared/lib';
import styles from './Bookworm.module.css';

/**
 * The bookworm, PowerBook's mascot (the founder's pick, 2026-10-13): a
 * fluffy caterpillar in round glasses that is orange while today's 30
 * minutes are still ahead and green once they are in. From the 25th day
 * of a circle it is a butterfly, the same two colours.
 *
 * Rendered from the founder's own clips (Google Flow, keyed to alpha):
 * one 8-second film per stage, orange at the start, the colour change in
 * the middle, green at the end. The orange and green states loop their
 * own stretch of the film; «turn» plays the change through once.
 *
 * Never a guilt trip: no hunger, no sadness, no «you left me».
 */

export type WormStage = 'caterpillar' | 'butterfly';
export type WormState = 'orange' | 'green';

// Where each stretch sits inside the 8-second films.
const ORANGE_END = 3.4;
const GREEN_START = 5.6;
const BASE = '/mascot';

/** A butterfly from the 25th day of the circle; a caterpillar before. */
export function wormStage(dayOfRound: number): WormStage {
  return dayOfRound >= 25 ? 'butterfly' : 'caterpillar';
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function Bookworm({
  stage,
  state,
  turn = false,
  size = 112,
  still = false,
  film,
  onFilmEnd,
  className = '',
}: {
  stage: WormStage;
  state: WormState;
  /** Play the orange → green change once, then settle into green. */
  turn?: boolean;
  size?: number;
  /** A picture instead of the film: tiny sizes and quiet corners. */
  still?: boolean;
  /** Another film of the worm: «hello» waves and loops; «cocoon» is the change into the butterfly, played once. */
  film?: 'hello' | 'cocoon';
  /** For a film played once: it is over. */
  onFilmEnd?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  // The loop the film is in right now; «turn» runs to the end, then becomes green.
  const [mode, setMode] = useState<WormState | 'turn'>(state);
  const label = t(state === 'green' ? 'worm.labelGreen' : 'worm.labelOrange');
  const reel = film ?? stage;
  const poster = film ? `${BASE}/${film}-first.png` : `${BASE}/${stage}-${state === 'green' ? 'last' : 'first'}.png`;
  const picture = still || reducedMotion();

  useEffect(() => {
    setMode(turn ? 'turn' : state);
  }, [turn, state]);

  // Keep the film inside its stretch. timeupdate fires a few times a second,
  // enough for an 8-second loop and far cheaper than requestAnimationFrame.
  useEffect(() => {
    const v = video.current;
    if (!v || picture || film) return;
    const onTime = () => {
      if (mode === 'orange' && v.currentTime >= ORANGE_END) v.currentTime = 0;
      if (mode === 'green' && v.currentTime >= v.duration - 0.08) v.currentTime = GREEN_START;
    };
    const onEnded = () => {
      if (mode === 'turn') setMode('green');
      v.currentTime = GREEN_START;
      void v.play().catch(() => {});
    };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnded);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnded);
    };
  }, [mode, picture, film]);

  // Entering a mode: jump to its start and play.
  useEffect(() => {
    const v = video.current;
    if (!v || picture || film) return;
    const start = () => {
      v.currentTime = mode === 'green' ? GREEN_START : 0;
      void v.play().catch(() => {});
    };
    if (v.readyState >= 1) start();
    else v.addEventListener('loadedmetadata', start, { once: true });
    return () => v.removeEventListener('loadedmetadata', start);
  }, [mode, stage, picture]);

  const sources = useMemo(
    () => [
      // Safari (iPhone) plays HEVC with alpha; Chrome skips it and takes the WebM.
      { src: `${BASE}/${reel}.mov`, type: 'video/quicktime; codecs="hvc1"' },
      { src: `${BASE}/${reel}.webm`, type: 'video/webm' },
    ],
    [reel],
  );

  const box = { width: size, height: size };
  if (picture) {
    return <img src={poster} alt={label} width={size} height={size} className={`${styles.worm} ${className}`} style={box} />;
  }
  return (
    <video
      key={reel}
      ref={video}
      className={`${styles.worm} ${className}`}
      style={box}
      width={size}
      height={size}
      muted
      playsInline
      preload="auto"
      autoPlay={!!film}
      loop={film === 'hello'}
      onEnded={film === 'cocoon' ? onFilmEnd : undefined}
      poster={poster}
      aria-label={label}
    >
      {sources.map((s) => (
        <source key={s.src} src={s.src} type={s.type} />
      ))}
    </video>
  );
}

/**
 * On the round page beside «Сегодня»: the worm and one line about today.
 * Green with today's 30 minutes in; the change plays once when they land.
 */
export function BookwormCard({
  todayMinutes,
  dayOfRound,
  turn,
  roundKey,
}: {
  todayMinutes: number;
  dayOfRound: number;
  turn: boolean;
  /** The circle this is, so the change into the butterfly plays once per circle. */
  roundKey: string;
}) {
  const { t } = useI18n();
  const done = todayMinutes >= 30;
  const stage = wormStage(dayOfRound);
  const cocoonKey = `pb.worm.cocoon.${roundKey}`;
  const [cocoon, setCocoon] = useState(() => {
    if (stage !== 'butterfly' || reducedMotion()) return false;
    try {
      return localStorage.getItem(cocoonKey) !== '1';
    } catch {
      return false;
    }
  });
  const cocoonOver = () => {
    try {
      localStorage.setItem(cocoonKey, '1');
    } catch {
      /* it may play again next time, which is no harm */
    }
    setCocoon(false);
  };
  // The butterfly's film is wider than it is tall, so it gets more room.
  const size = stage === 'butterfly' ? 132 : 112;
  return (
    <div className={styles.card}>
      <div className={styles.stand} style={{ width: size, height: size }}>
        {cocoon ? (
          <Bookworm stage="butterfly" state="green" film="cocoon" onFilmEnd={cocoonOver} size={size} />
        ) : (
          <Bookworm stage={stage} state={done ? 'green' : 'orange'} turn={turn} size={size} />
        )}
      </div>
      <div className={styles.text}>
        <p className={styles.line}>{done ? t('worm.green') : t('worm.orange')}</p>
        <small className={styles.hint}>{stage === 'butterfly' ? t('worm.butterfly') : t('worm.untilButterfly', { n: Math.max(0, 25 - dayOfRound) })}</small>
      </div>
    </div>
  );
}

/** For a visitor on the front page: the worm waves hello and says how it works. */
export function BookwormIntro() {
  const { t } = useI18n();
  return (
    <div className={styles.intro}>
      <div className={styles.stand} style={{ width: 96, height: 96 }}>
        <Bookworm stage="caterpillar" state="orange" film="hello" size={96} />
      </div>
      <p>{t('worm.meet')}</p>
    </div>
  );
}
