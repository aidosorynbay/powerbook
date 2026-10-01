import type { CSSProperties } from 'react';
import styles from './Barys.module.css';

/**
 * Барыс, PowerBook's snow leopard cub (the founder's pick, 2026-10-01):
 * fed by reading minutes the way Duolingo's owl is fed by lessons.
 *
 * Drawn in code so it stays sharp at any size and weighs nothing. Moods:
 * asleep (night, or no reading for days), hungry (today under 30 minutes),
 * happy (30 done), celebrating (30 just done), sad (yesterday was missed),
 * reading (in the reader's Lock in). He grows with all-time minutes: a
 * scarf, then reading glasses.
 */

export type BarysMood = 'sleep' | 'hungry' | 'happy' | 'celebrate' | 'sad' | 'reading';
export type BarysStage = 1 | 2 | 3;

const FUR = '#EDE9E1';
const FUR_EDGE = '#C9C1B2';
const BELLY = '#FBF9F4';
const SPOT = '#4F4A44';
const SPOT_IN = '#A39682';
const NOSE = '#E8A0A0';
const INK = '#38332E';
const ACCENT = '#F26430';

/** A rosette: the snow leopard's broken ring of spots. */
function Rosette({ x, y, r = 5 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r * 0.55} fill={SPOT_IN} opacity={0.55} />
      <circle cx={x} cy={y} r={r} fill="none" stroke={SPOT} strokeWidth={r * 0.42} strokeDasharray={`${r * 1.5} ${r * 0.7}`} strokeLinecap="round" />
    </g>
  );
}

function Eyes({ mood }: { mood: BarysMood }) {
  if (mood === 'sleep') {
    return (
      <g stroke={INK} strokeWidth={2.8} strokeLinecap="round" fill="none">
        <path d="M73 93 Q82 100 91 93" />
        <path d="M109 93 Q118 100 127 93" />
      </g>
    );
  }
  if (mood === 'happy' || mood === 'celebrate') {
    return (
      <g stroke={INK} strokeWidth={3} strokeLinecap="round" fill="none">
        <path d="M73 95 Q82 85 91 95" />
        <path d="M109 95 Q118 85 127 95" />
      </g>
    );
  }
  const down = mood === 'reading' ? 3 : 0;
  return (
    <g className={styles.eyes}>
      <ellipse cx={82} cy={91 + down} rx={7.8} ry={9.2} fill={INK} />
      <ellipse cx={118} cy={91 + down} rx={7.8} ry={9.2} fill={INK} />
      <circle cx={84.8} cy={87.4 + down} r={2.8} fill="#fff" />
      <circle cx={120.8} cy={87.4 + down} r={2.8} fill="#fff" />
      <circle cx={80} cy={94.5 + down} r={1.2} fill="#fff" opacity={0.7} />
      <circle cx={116} cy={94.5 + down} r={1.2} fill="#fff" opacity={0.7} />
      {mood === 'reading' && (
        // heavy lids, eyes down on the page
        <g fill={FUR}>
          <path d="M72 84 Q82 80 92 84 L92 89 Q82 86 72 89Z" />
          <path d="M108 84 Q118 80 128 84 L128 89 Q118 86 108 89Z" />
        </g>
      )}
      {mood === 'sad' && (
        <g stroke={INK} strokeWidth={2.2} strokeLinecap="round" fill="none">
          <path d="M72 78 L90 74" />
          <path d="M128 78 L110 74" />
        </g>
      )}
    </g>
  );
}

function Mouth({ mood }: { mood: BarysMood }) {
  if (mood === 'happy' || mood === 'celebrate') {
    return (
      <g>
        <path d="M91 114 Q100 126 109 114 Z" fill="#7A3E3E" />
        <path d="M95 119 Q100 123 105 119 Q100 117 95 119Z" fill="#E87F7F" />
      </g>
    );
  }
  if (mood === 'sad') {
    return <path d="M93 120 Q100 114 107 120" stroke={INK} strokeWidth={1.9} fill="none" strokeLinecap="round" />;
  }
  if (mood === 'sleep') {
    return <path d="M96 115 Q100 117 104 115" stroke={INK} strokeWidth={1.7} fill="none" strokeLinecap="round" />;
  }
  return <path d="M100 110 Q100 115 94 117 M100 110 Q100 115 106 117" stroke={INK} strokeWidth={1.8} fill="none" strokeLinecap="round" />;
}

/** The book in his paws: open while reading, closed on his lap while asleep or sad. */
function Book({ mood }: { mood: BarysMood }) {
  if (mood === 'celebrate') return null;
  if (mood === 'sleep' || mood === 'sad') {
    return (
      <g>
        <rect x={74} y={172} width={52} height={13} rx={2} fill={ACCENT} />
        <rect x={77} y={170} width={46} height={4} rx={1} fill="#FFF7EC" />
      </g>
    );
  }
  return (
    <g className={mood === 'reading' ? styles.pageTurn : undefined}>
      <path d="M70 148 L100 154 L130 148 L130 184 L100 190 L70 184Z" fill={ACCENT} />
      <path d="M73 150 L100 155 L100 186 L73 181Z" fill="#FFFDF8" />
      <path d="M127 150 L100 155 L100 186 L127 181Z" fill="#FFF7EC" />
      <g stroke="#C9BBA6" strokeWidth={1.2} strokeLinecap="round">
        <path d="M78 158 L95 161 M78 164 L95 167 M78 170 L95 173" />
        <path d="M105 161 L122 158 M105 167 L122 164 M105 173 L118 170" />
      </g>
    </g>
  );
}

export function Barys({ mood, stage = 1, size = 120, hop = false, className = '' }: {
  mood: BarysMood;
  stage?: BarysStage;
  size?: number;
  /** A one-off jump, for a tap. */
  hop?: boolean;
  className?: string;
}) {
  const grow: CSSProperties = { ['--grow' as string]: stage === 1 ? 0.92 : stage === 2 ? 1 : 1.06 };
  return (
    <svg
      className={`${styles.barys} ${styles[mood]} ${hop ? styles.hop : ''} ${className}`}
      viewBox="0 0 200 212"
      width={size}
      height={size * 1.06}
      style={grow}
      role="img"
      aria-hidden="true"
    >
      <g className={styles.figure}>
        {/* tail, behind everything */}
        <g className={styles.tail}>
          <path d="M138 176 C 180 178 198 146 186 114 C 180 98 160 98 163 114" stroke={FUR_EDGE} strokeWidth={26} strokeLinecap="round" fill="none" />
          <path d="M138 176 C 180 178 198 146 186 114 C 180 98 160 98 163 114" stroke={FUR} strokeWidth={21} strokeLinecap="round" fill="none" />
          <Rosette x={168} y={168} r={4.6} />
          <Rosette x={187} y={140} r={4.4} />
          <circle cx={163} cy={113} r={9.5} fill={SPOT} />
        </g>

        {/* body */}
        <g className={styles.body}>
          <ellipse cx={100} cy={160} rx={52} ry={44} fill={FUR} stroke={FUR_EDGE} strokeWidth={2.2} />
          <ellipse cx={100} cy={168} rx={32} ry={29} fill={BELLY} />
          <Rosette x={60} y={152} r={5.4} />
          <Rosette x={66} y={180} r={4.8} />
          <Rosette x={140} y={152} r={5.4} />
          <Rosette x={134} y={182} r={4.8} />
          <ellipse cx={74} cy={199} rx={18} ry={10.5} fill={FUR} stroke={FUR_EDGE} strokeWidth={2} />
          <ellipse cx={126} cy={199} rx={18} ry={10.5} fill={FUR} stroke={FUR_EDGE} strokeWidth={2} />
          <path d="M68 203 L68 197 M74 204 L74 197 M80 203 L80 197 M120 203 L120 197 M126 204 L126 197 M132 203 L132 197" stroke={FUR_EDGE} strokeWidth={1.6} strokeLinecap="round" />
        </g>

        {/* scarf, from the second stage on; behind the book and paws */}
        {stage >= 2 && (
          <g>
            <path d="M120 142 L132 172 L119 175 L110 146Z" fill="#D9541F" />
            <path d="M58 128 Q100 150 142 128 L144 140 Q100 162 56 140Z" fill={ACCENT} />
          </g>
        )}

        <Book mood={mood} />

        {/* paws: holding the book, or up in the air */}
        {mood === 'celebrate' ? (
          <g className={styles.armsUp}>
            <ellipse cx={46} cy={118} rx={11} ry={13} fill={FUR} stroke={FUR_EDGE} strokeWidth={2} />
            <ellipse cx={154} cy={118} rx={11} ry={13} fill={FUR} stroke={FUR_EDGE} strokeWidth={2} />
          </g>
        ) : (
          <g>
            <ellipse cx={mood === 'sleep' || mood === 'sad' ? 80 : 70} cy={mood === 'sleep' || mood === 'sad' ? 178 : 166} rx={10} ry={9} fill={FUR} stroke={FUR_EDGE} strokeWidth={2} />
            <ellipse cx={mood === 'sleep' || mood === 'sad' ? 120 : 130} cy={mood === 'sleep' || mood === 'sad' ? 178 : 166} rx={10} ry={9} fill={FUR} stroke={FUR_EDGE} strokeWidth={2} />
          </g>
        )}

        {/* head */}
        <g className={styles.head}>
          <circle cx={62} cy={56} r={16} fill={FUR} stroke={FUR_EDGE} strokeWidth={2.2} />
          <circle cx={138} cy={56} r={16} fill={FUR} stroke={FUR_EDGE} strokeWidth={2.2} />
          <circle cx={62} cy={57} r={8.5} fill={SPOT} />
          <circle cx={138} cy={57} r={8.5} fill={SPOT} />
          <circle cx={62} cy={58.5} r={5} fill="#B9A592" />
          <circle cx={138} cy={58.5} r={5} fill="#B9A592" />
          <ellipse cx={100} cy={94} rx={52} ry={47} fill={FUR} stroke={FUR_EDGE} strokeWidth={2.2} />
          {/* forehead spots */}
          <circle cx={100} cy={57} r={3.4} fill={SPOT} />
          <circle cx={87} cy={62} r={2.8} fill={SPOT} />
          <circle cx={113} cy={62} r={2.8} fill={SPOT} />
          <circle cx={94} cy={68} r={2.2} fill={SPOT} />
          <circle cx={106} cy={68} r={2.2} fill={SPOT} />
          <Rosette x={60} y={96} r={4.8} />
          <Rosette x={140} y={96} r={4.8} />
          {/* muzzle */}
          <ellipse cx={100} cy={112} rx={23} ry={16} fill={BELLY} />
          {(mood === 'happy' || mood === 'celebrate') && (
            <g fill="#F2A7A7" opacity={0.55}>
              <ellipse cx={68} cy={110} rx={8} ry={5} />
              <ellipse cx={132} cy={110} rx={8} ry={5} />
            </g>
          )}
          <Eyes mood={mood} />
          <path d="M93 103 Q100 98 107 103 Q104 110 100 111 Q96 110 93 103Z" fill={NOSE} />
          <Mouth mood={mood} />
          <g stroke={FUR_EDGE} strokeWidth={1.3} strokeLinecap="round">
            <path d="M80 110 L60 106 M80 114 L60 116" />
            <path d="M120 110 L140 106 M120 114 L140 116" />
          </g>
          {mood === 'sad' && <path className={styles.tear} d="M86 100 q-4 7 0 10 q4 -3 0 -10Z" fill="#8EC5E8" />}
          {/* reading glasses, at the third stage */}
          {stage >= 3 && mood !== 'sleep' && (
            <g stroke={INK} strokeWidth={2.2} fill="none">
              <circle cx={82} cy={92} r={13} />
              <circle cx={118} cy={92} r={13} />
              <path d="M95 92 Q100 88 105 92" />
            </g>
          )}
        </g>

        {mood === 'sleep' && (
          <g className={styles.zzz} fill="#9FB7CF" fontFamily="inherit" fontWeight={800}>
            <text x={150} y={46} fontSize={18}>z</text>
            <text x={164} y={30} fontSize={14}>z</text>
            <text x={175} y={17} fontSize={11}>z</text>
          </g>
        )}
        {mood === 'celebrate' && (
          <g className={styles.confetti}>
            <rect x={30} y={30} width={8} height={4} rx={1} fill={ACCENT} />
            <rect x={160} y={36} width={8} height={4} rx={1} fill="#F5B72E" />
            <rect x={44} y={10} width={6} height={4} rx={1} fill="#3ECF7A" />
            <rect x={150} y={8} width={6} height={4} rx={1} fill="#2E86AB" />
            <circle cx={100} cy={14} r={3} fill="#F5B72E" />
            <circle cx={22} cy={70} r={2.6} fill="#2E86AB" />
            <circle cx={180} cy={66} r={2.6} fill={ACCENT} />
          </g>
        )}
      </g>
    </svg>
  );
}
