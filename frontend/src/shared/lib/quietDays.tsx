/**
 * Decoration for days that fall outside a round's window.
 *
 * A mini-round covers only part of the month, so the leading days aren't
 * "missed" — they simply aren't part of the round. Rendering them as empty
 * grey squares reads like failure, so they get a book/art sticker instead,
 * and tapping one shows a short line about reading.
 *
 * Quotes are one-line aphorisms from long-public-domain authors, each shown
 * with its author so the attribution travels with the words.
 */
import type { ReactNode } from 'react';

export const QUIET_DAY_COUNT = 14;

/** Simple line icons — currentColor so they inherit the cell's tint. */
const ICONS: ReactNode[] = [
  // book
  <><path d="M3 4.5A1.5 1.5 0 0 1 4.5 3H9a3 3 0 0 1 3 3v9a2.5 2.5 0 0 0-2.5-2H3z" /><path d="M21 4.5A1.5 1.5 0 0 0 19.5 3H15a3 3 0 0 0-3 3v9a2.5 2.5 0 0 1 2.5-2H21z" /></>,
  // quill
  <><path d="M4 20c6-1 10-4 13-9" /><path d="M20 3c-6 0-12 4-13 11l3 3c7-1 10-8 10-14z" /></>,
  // inkwell
  <><path d="M6 10h12v6a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z" /><path d="M9 10V6h6v4" /><path d="M12 3v3" /></>,
  // lamp
  <><path d="M9 18h6" /><path d="M10 21h4" /><path d="M12 3a6 6 0 0 0-3 11v2h6v-2a6 6 0 0 0-3-11z" /></>,
  // scroll
  <><path d="M6 4h10a2 2 0 0 1 2 2v12a2 2 0 0 0 2 2H8a2 2 0 0 1-2-2z" /><path d="M6 4a2 2 0 0 0-2 2v2h2" /></>,
  // glasses
  <><circle cx="6.5" cy="14" r="3.5" /><circle cx="17.5" cy="14" r="3.5" /><path d="M10 14h4" /><path d="M3 11l2-4" /><path d="M21 11l-2-4" /></>,
  // bookmark
  <><path d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1z" /></>,
  // stack of books
  <><rect x="3" y="15" width="18" height="5" rx="1" /><rect x="5" y="10" width="14" height="5" rx="1" /><rect x="7" y="5" width="10" height="5" rx="1" /></>,
  // candle
  <><rect x="9" y="9" width="6" height="12" rx="1" /><path d="M12 9V7" /><path d="M12 3c1.5 1.5 1.5 3 0 4-1.5-1-1.5-2.5 0-4z" /></>,
  // page with text
  <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M9 12h6" /><path d="M9 16h6" /></>,
  // pen nib
  <><path d="M12 3l7 7-7 11-7-11z" /><path d="M12 10v4" /></>,
  // star
  <><path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z" /></>,
  // leaf
  <><path d="M4 20c0-8 6-14 16-15 0 10-6 16-14 16" /><path d="M4 20c4-3 7-6 9-10" /></>,
  // open book with heart
  <><path d="M3 5h6a3 3 0 0 1 3 3v11a2.5 2.5 0 0 0-2.5-2H3z" /><path d="M21 5h-6a3 3 0 0 0-3 3v11a2.5 2.5 0 0 1 2.5-2H21z" /></>,
];

export function quietDayIcon(day: number): ReactNode {
  return ICONS[(day - 1) % ICONS.length];
}

/** i18n keys for the quote shown when a decorative day is tapped. */
export function quietDayQuoteKeys(day: number): { text: string; author: string } {
  const n = ((day - 1) % QUIET_DAY_COUNT) + 1;
  return { text: `quiet.q${n}`, author: `quiet.a${n}` };
}


/** Checkered finish flag — the round's closing day, not a reading day. */
export function finishFlagIcon(): ReactNode {
  return (
    <>
      <path d="M6 21V3" />
      <path d="M6 4h13l-2.5 4L19 12H6z" />
      <path d="M6 8h4v4H6z" />
      <path d="M13 4h3.5v4H13z" />
    </>
  );
}
