import { useEffect, useRef, useState } from 'react';
import type { WormRig } from './rig/WormRig';
import styles from './Bookworm.module.css';

export type WormStage = 'caterpillar' | 'butterfly';
export type WormState = 'orange' | 'green';

const BASE = '/mascot';

export function wormPicture(stage: WormStage, state: WormState): string {
  return `${BASE}/${stage}-${state}.webp`;
}

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The worm alive: his picture first (it is the fallback too), and over it,
 * once three.js and the textures have arrived, the canvas where he breathes,
 * blinks, looks at the reader and turns green. Nothing moves for a reader who
 * asked for less motion, and nothing is drawn while he is off the screen.
 */
export function LivingWorm({
  stage,
  state,
  turn = false,
  fly = false,
  hello = false,
  size,
  label,
  onTurnEnd,
  onFlightEnd,
  className = '',
}: {
  stage: WormStage;
  state: WormState;
  /** Play the orange → green change once. */
  turn?: boolean;
  /** Play the change into the butterfly once (the picture is the caterpillar until then). */
  fly?: boolean;
  /** A bounce and a blink when he appears. */
  hello?: boolean;
  size: number;
  label: string;
  onTurnEnd?: () => void;
  onFlightEnd?: () => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rigRef = useRef<WormRig | null>(null);
  const [live, setLive] = useState(false);
  // What the picture shows while the canvas is not up: the state as it is, or before the change.
  const pictureStage: WormStage = fly ? 'caterpillar' : stage;
  const pictureState: WormState = turn ? 'orange' : state;
  const still = reducedMotion();

  // The rig lives as long as the component; what it shows first is the
  // picture's state, and every change after that goes through it.
  const startStage: WormStage = fly ? 'caterpillar' : stage;
  const startState: WormState = turn ? 'orange' : state;
  const callbacks = useRef({ onTurnEnd, onFlightEnd });
  callbacks.current = { onTurnEnd, onFlightEnd };
  useEffect(() => {
    if (still) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let rig: WormRig | null = null;
    let gone = false;
    void import('./rig/WormRig').then(({ WormRig, webglAvailable }) => {
      if (gone || !webglAvailable()) return;
      rig = new WormRig(canvas, size, {
        onReady: () => {
          if (gone) return;
          setLive(true);
          if (hello) rig?.sayHello();
        },
        onLost: () => setLive(false),
        onTurnEnd: () => callbacks.current.onTurnEnd?.(),
        onFlightEnd: () => callbacks.current.onFlightEnd?.(),
      });
      rigRef.current = rig;
      // a handle for the review script (marketing/2026-10-mascot/review.mjs)
      (window as unknown as { __pbWorm?: WormRig }).__pbWorm = rig;
      void rig.load(startStage, startState).catch(() => setLive(false));
    });
    return () => {
      gone = true;
      rig?.dispose();
      rigRef.current = null;
      setLive(false);
    };
    // The first state decides the textures; later changes go through the rig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still]);

  useEffect(() => {
    rigRef.current?.resize(size);
  }, [size]);

  // The moments, and the quiet changes of colour.
  useEffect(() => {
    const rig = rigRef.current;
    if (!rig || !live) return;
    if (fly) void rig.fly(state);
    else if (rig.stage !== stage) void rig.setStage(stage, state);
    else if (turn) rig.turn();
    else rig.setColour(state);
  }, [live, turn, fly, stage, state]);

  // Off the screen: no frames.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !live || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => rigRef.current?.setVisible(e.isIntersecting), { threshold: 0.05 });
    io.observe(canvas);
    return () => io.disconnect();
  }, [live]);

  const box = { width: size, height: size };
  return (
    <div className={`${styles.live} ${className}`} style={box} role="img" aria-label={label}>
      <img src={wormPicture(pictureStage, pictureState)} alt="" width={size} height={size} className={styles.worm} style={{ ...box, opacity: live ? 0 : 1 }} draggable={false} />
      {!still && <canvas ref={canvasRef} className={styles.canvas} style={{ ...box, opacity: live ? 1 : 0 }} aria-hidden="true" />}
    </div>
  );
}
