import type { ReactNode } from 'react';
import styles from './TelegramGuide.module.css';

/**
 * Generic phone-screen diagrams for the three taps that create a Telegram
 * username. Deliberately schematic: no logo, no real name, avatar and rows
 * are blank placeholders, so nothing here belongs to any one person and the
 * drawing does not pass itself off as a screenshot of the app.
 *
 * The green arrow points at the one control the step is about.
 */

const FRAME = { w: 160, h: 300 };

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg
      className={styles.mock}
      viewBox={`0 0 ${FRAME.w} ${FRAME.h}`}
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width={FRAME.w - 2} height={FRAME.h - 2} rx="18" className={styles.mockFrame} />
      {/* Status bar: two blank slabs, not a clock and not a carrier. */}
      <rect x="16" y="12" width="22" height="6" rx="3" className={styles.mockFaint} />
      <rect x="122" y="12" width="22" height="6" rx="3" className={styles.mockFaint} />
      {children}
    </svg>
  );
}

/** Blank avatar and two placeholder bars where a name and number would be. */
function ProfileHead() {
  return (
    <>
      <circle cx="80" cy="52" r="18" className={styles.mockAvatar} />
      <circle cx="80" cy="47" r="6" className={styles.mockFaint} />
      <path d="M70 60a10 10 0 0 1 20 0z" className={styles.mockFaint} />
      <rect x="52" y="78" width="56" height="8" rx="4" className={styles.mockBar} />
      <rect x="62" y="92" width="36" height="6" rx="3" className={styles.mockFaint} />
    </>
  );
}

function Row({ y, highlighted = false }: { y: number; highlighted?: boolean }) {
  return (
    <>
      <rect
        x="14"
        y={y}
        width="132"
        height="24"
        rx="8"
        className={highlighted ? styles.mockRowOn : styles.mockRow}
      />
      <rect x="22" y={y + 7} width="10" height="10" rx="3" className={styles.mockFaint} />
      <rect x="38" y={y + 9} width="52" height="6" rx="3" className={styles.mockFaint} />
    </>
  );
}

/** Arrow drawn from (x1,y1) to a head at (x2,y2). */
function Arrow({ d, head }: { d: string; head: string }) {
  return (
    <g className={styles.arrow}>
      <path d={d} fill="none" strokeWidth="7" strokeLinecap="round" />
      <path d={head} />
    </g>
  );
}

/** Step 1 — the Settings tab in the bottom bar. */
export function MockSettingsTab() {
  return (
    <Frame>
      <ProfileHead />
      <Row y={110} />
      <Row y={140} />
      <Row y={170} />
      <rect x="14" y="252" width="132" height="30" rx="15" className={styles.mockRow} />
      <circle cx="42" cy="267" r="5" className={styles.mockFaint} />
      <circle cx="68" cy="267" r="5" className={styles.mockFaint} />
      <circle cx="94" cy="267" r="5" className={styles.mockFaint} />
      <circle cx="120" cy="267" r="7" className={styles.mockTarget} />
      <Arrow d="M120 218 L120 244" head="M120 256 l-7 -12 h14 z" />
    </Frame>
  );
}

/** Step 2 — the Edit button, top right. */
export function MockEditButton() {
  return (
    <Frame>
      <rect x="108" y="26" width="38" height="18" rx="9" className={styles.mockTargetBox} />
      <rect x="116" y="32" width="22" height="6" rx="3" className={styles.mockFaint} />
      <ProfileHead />
      <Row y={120} />
      <Row y={150} />
      <Row y={180} />
      <Arrow d="M127 84 L127 60" head="M127 48 l-7 12 h14 z" />
    </Frame>
  );
}

/** Step 3 — the username field on the edit screen. */
export function MockUsernameField() {
  return (
    <Frame>
      <rect x="14" y="34" width="132" height="24" rx="8" className={styles.mockRow} />
      <rect x="22" y="42" width="40" height="8" rx="4" className={styles.mockFaint} />
      <rect x="14" y="64" width="132" height="24" rx="8" className={styles.mockRow} />
      <rect x="22" y="72" width="30" height="8" rx="4" className={styles.mockFaint} />

      <rect x="14" y="110" width="132" height="28" rx="8" className={styles.mockRowOn} />
      <text x="24" y="128" className={styles.mockText}>@</text>
      <rect x="38" y="119" width="58" height="9" rx="4" className={styles.mockTypedBar} />
      {/* A caret, so the field reads as one you type into. */}
      <rect x="100" y="116" width="2" height="16" rx="1" className={styles.mockCaret} />

      <rect x="14" y="150" width="90" height="6" rx="3" className={styles.mockFaint} />
      <rect x="14" y="162" width="70" height="6" rx="3" className={styles.mockFaint} />
      <Arrow d="M124 210 L124 152" head="M124 140 l-7 12 h14 z" />
    </Frame>
  );
}
