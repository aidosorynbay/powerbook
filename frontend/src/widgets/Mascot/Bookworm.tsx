import { useMemo, useState } from 'react';
import { useI18n } from '@/shared/lib';
import { LivingWorm, reducedMotion, wormPicture } from './LivingWorm';
import type { WormStage, WormState } from './LivingWorm';
import styles from './Bookworm.module.css';

export type { WormStage, WormState } from './LivingWorm';

/**
 * The bookworm, PowerBook's mascot (the founder's pick, 2026-10-13): a
 * fluffy caterpillar in round glasses that is orange while today's 30
 * minutes are still ahead and green once they are in. From the 25th day
 * of a circle it is a butterfly, the same two colours.
 *
 * He is the founder's own renders, alive: WebGL warps the picture itself
 * (breath, a nod, a lean toward the reader, blinks with lids of his own fur),
 * the green runs through the orange render when the minutes land, and on the
 * 25th day his pixels fly apart and come together as the butterfly. The
 * Flow films before this drifted from the renders and lost the glasses.
 *
 * Never a guilt trip: no hunger, no sadness, no «you left me».
 */

/** A butterfly from the 25th day of the circle; a caterpillar before. */
export function wormStage(dayOfRound: number): WormStage {
  return dayOfRound >= 25 ? 'butterfly' : 'caterpillar';
}

export function Bookworm({
  stage,
  state,
  turn = false,
  fly = false,
  hello = false,
  size = 112,
  still = false,
  onTurnEnd,
  onFlightEnd,
  className = '',
}: {
  stage: WormStage;
  state: WormState;
  /** Play the orange → green change once, then settle into green. */
  turn?: boolean;
  /** Play the change into the butterfly once. */
  fly?: boolean;
  /** A bounce and a blink when he appears. */
  hello?: boolean;
  size?: number;
  /** A picture instead of the living worm: tiny sizes and quiet corners. */
  still?: boolean;
  onTurnEnd?: () => void;
  onFlightEnd?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const label = t(state === 'green' ? 'worm.labelGreen' : 'worm.labelOrange');
  const box = { width: size, height: size };
  if (still) {
    return <img src={wormPicture(stage, state)} alt={label} width={size} height={size} className={`${styles.worm} ${className}`} style={box} draggable={false} />;
  }
  return <LivingWorm stage={stage} state={state} turn={turn} fly={fly} hello={hello} size={size} label={label} onTurnEnd={onTurnEnd} onFlightEnd={onFlightEnd} className={className} />;
}

/** `?worm=` on the page: a way to see each of his moments without waiting for them. */
function preview(): { stage?: WormStage; state?: WormState; turn?: boolean; fly?: boolean } {
  if (typeof window === 'undefined') return {};
  const v = new URLSearchParams(window.location.search).get('worm');
  switch (v) {
    case 'orange':
      return { stage: 'caterpillar', state: 'orange' };
    case 'green':
      return { stage: 'caterpillar', state: 'green' };
    case 'turn':
      return { stage: 'caterpillar', state: 'green', turn: true };
    case 'butterfly':
      return { stage: 'butterfly', state: 'green' };
    case 'butterfly-orange':
      return { stage: 'butterfly', state: 'orange' };
    case 'fly':
      return { stage: 'butterfly', state: 'green', fly: true };
    default:
      return {};
  }
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
  const pv = useMemo(preview, []);
  const done = todayMinutes >= 30;
  const stage = pv.stage ?? wormStage(dayOfRound);
  const state: WormState = pv.state ?? (done ? 'green' : 'orange');
  const flyKey = `pb.worm.cocoon.${roundKey}`;
  // The flight into the butterfly: once per circle, the first time the page
  // opens on or after the 25th day (a tap on him replays it any time).
  const [fly, setFly] = useState(() => {
    if (pv.stage) return !!pv.fly;
    if (stage !== 'butterfly' || reducedMotion()) return false;
    try {
      return localStorage.getItem(flyKey) !== '1';
    } catch {
      return false;
    }
  });
  const flown = () => {
    try {
      localStorage.setItem(flyKey, '1');
    } catch {
      /* it may play again next time, which is no harm */
    }
    setFly(false);
  };
  const size = stage === 'butterfly' ? 132 : 112;
  return (
    <div className={styles.card}>
      <div className={styles.stand} style={{ width: size, height: size }}>
        <Bookworm stage={stage} state={state} turn={pv.turn ?? turn} fly={fly} onFlightEnd={flown} size={size} />
      </div>
      <div className={styles.text}>
        <p className={styles.line}>{done ? t('worm.green') : t('worm.orange')}</p>
        <small className={styles.hint}>{stage === 'butterfly' ? t('worm.butterfly') : t('worm.untilButterfly', { n: Math.max(0, 25 - dayOfRound) })}</small>
      </div>
    </div>
  );
}

/** For a visitor on the front page: the worm says hello and how it works. */
export function BookwormIntro() {
  const { t } = useI18n();
  return (
    <div className={styles.intro}>
      <div className={styles.stand} style={{ width: 96, height: 96 }}>
        <Bookworm stage="caterpillar" state="orange" hello size={96} />
      </div>
      <p>{t('worm.meet')}</p>
    </div>
  );
}
