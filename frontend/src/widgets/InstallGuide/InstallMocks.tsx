import type { ReactNode } from 'react';
import styles from './InstallGuide.module.css';

/**
 * Schematic phone screens for the taps that put PowerBook on the home
 * screen. Like the Telegram guide: no logos, no real text, blank bars for
 * everything that is not the one control the step is about, which gets
 * the orange ring and the arrow.
 */

const W = 160;
const H = 300;

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg className={styles.mock} viewBox={`0 0 ${W} ${H}`} role="img" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width={W - 2} height={H - 2} rx="18" className={styles.mockFrame} />
      <rect x="16" y="12" width="22" height="6" rx="3" className={styles.mockFaint} />
      <rect x="122" y="12" width="22" height="6" rx="3" className={styles.mockFaint} />
      {children}
    </svg>
  );
}

/** Blank page content: a few text bars. */
function PageBars({ from = 40 }: { from?: number }) {
  return (
    <g>
      <rect x="20" y={from} width="120" height="10" rx="5" className={styles.mockBar} />
      <rect x="20" y={from + 20} width="90" height="6" rx="3" className={styles.mockFaint} />
      <rect x="20" y={from + 32} width="110" height="6" rx="3" className={styles.mockFaint} />
      <rect x="20" y={from + 44} width="70" height="6" rx="3" className={styles.mockFaint} />
    </g>
  );
}

function Ring({ x, y, r = 16 }: { x: number; y: number; r?: number }) {
  return <circle cx={x} cy={y} r={r} className={styles.mockRing} />;
}

function Arrow({ x, y, up = true }: { x: number; y: number; up?: boolean }) {
  const d = up ? `M${x} ${y + 30} L${x} ${y} M${x - 7} ${y + 8} L${x} ${y} L${x + 7} ${y + 8}` : `M${x} ${y - 30} L${x} ${y} M${x - 7} ${y - 8} L${x} ${y} L${x + 7} ${y - 8}`;
  return <path d={d} className={styles.mockArrow} />;
}

/** The share glyph: a box with an arrow rising out of it. */
function ShareGlyph({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} className={styles.mockGlyph}>
      <path d="M-6 -1 v10 h12 v-10" />
      <path d="M0 5 v-13 M-4 -8 l4 -4 l4 4" />
    </g>
  );
}

/** iPhone, step 1: Safari's bottom bar, the share button in the middle. */
export function IosShare() {
  return (
    <Frame>
      <PageBars />
      <rect x="1" y="250" width={W - 2} height="49" className={styles.mockBarArea} />
      <rect x="18" y="266" width="14" height="14" rx="3" className={styles.mockFaint} />
      <rect x="48" y="266" width="14" height="14" rx="3" className={styles.mockFaint} />
      <ShareGlyph x={80} y={273} s={1.1} />
      <rect x="98" y="266" width="14" height="14" rx="3" className={styles.mockFaint} />
      <rect x="128" y="266" width="14" height="14" rx="3" className={styles.mockFaint} />
      <Ring x={80} y={273} />
      <Arrow x={80} y={214} up={false} />
    </Frame>
  );
}

/** iPhone, step 2: the share sheet, with the «На экран „Домой“» row. */
export function IosHomeRow() {
  return (
    <Frame>
      <rect x="1" y="110" width={W - 2} height="189" rx="18" className={styles.mockSheet} />
      <rect x="66" y="118" width="28" height="4" rx="2" className={styles.mockFaint} />
      {[0, 1, 2, 3, 4].map((i) => {
        const y = 140 + i * 30;
        const hi = i === 2;
        return (
          <g key={i}>
            <rect x="18" y={y} width="20" height="20" rx="5" className={hi ? styles.mockGlyphBox : styles.mockFaint} />
            {hi && <path d={`M28 ${y + 5} v10 M23 ${y + 10} h10`} className={styles.mockGlyphLine} />}
            <rect x="48" y={y + 6} width={hi ? 76 : 60} height="8" rx="4" className={hi ? styles.mockBar : styles.mockFaint} />
          </g>
        );
      })}
      <Ring x={28} y={210} r={18} />
      <Arrow x={28} y={160} up={false} />
    </Frame>
  );
}

/** iPhone, step 3: the «Добавить» button at the top right. */
export function IosAddButton() {
  return (
    <Frame>
      <rect x="18" y="36" width="34" height="8" rx="4" className={styles.mockFaint} />
      <rect x="104" y="32" width="40" height="16" rx="8" className={styles.mockAccent} />
      <path d="M118 40 l4 4 l8 -8" className={styles.mockCheck} />
      <rect x="20" y="70" width="40" height="40" rx="9" className={styles.mockBar} />
      <rect x="70" y="78" width="70" height="8" rx="4" className={styles.mockBar} />
      <rect x="70" y="94" width="50" height="6" rx="3" className={styles.mockFaint} />
      <rect x="20" y="130" width="120" height="1" className={styles.mockFaint} />
      <Ring x={124} y={40} r={22} />
      <Arrow x={124} y={78} up />
    </Frame>
  );
}

/** Android, step 1: the browser's three-dot menu, top right. */
export function AndroidMenu() {
  return (
    <Frame>
      <rect x="16" y="30" width="104" height="18" rx="9" className={styles.mockFaint} />
      <circle cx="138" cy="34" r="2.2" className={styles.mockDot} />
      <circle cx="138" cy="40" r="2.2" className={styles.mockDot} />
      <circle cx="138" cy="46" r="2.2" className={styles.mockDot} />
      <PageBars from={70} />
      <Ring x={138} y={40} r={14} />
      <Arrow x={138} y={74} up />
    </Frame>
  );
}

/** Android, step 2: the menu list, with the «Добавить на главный экран» row. */
export function AndroidAddRow() {
  return (
    <Frame>
      <rect x="16" y="30" width="104" height="18" rx="9" className={styles.mockFaint} />
      <rect x="44" y="26" width="104" height="190" rx="10" className={styles.mockSheet} />
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const y = 40 + i * 28;
        const hi = i === 3;
        return (
          <g key={i}>
            <rect x="54" y={y} width="14" height="14" rx="3" className={hi ? styles.mockGlyphBox : styles.mockFaint} />
            {hi && <path d={`M61 ${y + 3} v8 M57 ${y + 7} h8`} className={styles.mockGlyphLine} />}
            <rect x="76" y={y + 3} width={hi ? 62 : 48} height="8" rx="4" className={hi ? styles.mockBar : styles.mockFaint} />
          </g>
        );
      })}
      <Ring x={61} y={131} r={16} />
      <Arrow x={61} y={178} up />
    </Frame>
  );
}

/** Android, step 3: the confirm dialog with its «Установить» button. */
export function AndroidInstall() {
  return (
    <Frame>
      <PageBars from={40} />
      <rect x="18" y="150" width="124" height="96" rx="12" className={styles.mockSheet} />
      <rect x="30" y="164" width="28" height="28" rx="7" className={styles.mockBar} />
      <rect x="66" y="168" width="60" height="8" rx="4" className={styles.mockBar} />
      <rect x="66" y="182" width="44" height="6" rx="3" className={styles.mockFaint} />
      <rect x="62" y="212" width="30" height="16" rx="8" className={styles.mockFaint} />
      <rect x="100" y="212" width="34" height="16" rx="8" className={styles.mockAccent} />
      <path d="M112 220 l4 4 l8 -8" className={styles.mockCheck} />
      <Ring x={117} y={220} r={20} />
      <Arrow x={117} y={260} up={false} />
    </Frame>
  );
}
