/** a, b: the wide photos of the round and the library; mr, ml: the phones' portrait photo, for the round and the library */
export type HallKey = 'a' | 'b' | 'mr' | 'ml';
export type Variant = 'day' | 'night';

export interface HallChar {
  seat: number;
  g: 'm' | 'f';
  head: [number, number];
  ring?: [number, number];
}

export interface Hall {
  files: string;
  /** the tall photo shown on phones */
  portrait?: boolean;
  seats: [number, number, number][];
  chars: Record<number, HallChar>;
  /** Renders of every chair with a woman and with a man: any reader can take any chair with a character.
   *  eyes: each face's blinking eyes, by time of day, cast and reader; box: each reader's box, fitted to their
   *  figures in every render (casts.js). */
  casts?: {
    eyes: Record<'day' | 'night', Partial<Record<'f' | 'm', Record<number, number[][]>>>>;
    box: Record<number, number[]>;
    pages: Record<number, unknown>;
  };
}

export const HALLS: Record<HallKey, Hall>;

/** The render's reader who shows a person of this gender in this seat (in a hall with casts, the seat's own), or 0 when there is none. */
export function charFor(hall: HallKey, seat: number, gender: string): number;
/** The render's reader in this seat, whoever it is. */
export function seatChar(hall: HallKey, seat: number): (HallChar & { id: number }) | null;

export interface Occupant {
  key: string;
  seat: number;
  /** the render's reader shown in the chair, 0 for none (only a name tag and a lamp) */
  char: number;
  status: 'reading' | 'paused';
  /** which cast draws them, in a hall with both */
  gender?: 'm' | 'f';
}

export interface RoomEngine {
  setVariant(v: Variant): void;
  setOccupants(list: Occupant[]): void;
  /** Turns a page now; false when that reader is not reading or is mid-turn. */
  flip(key: string): boolean;
  /** A fixed reveal (0..1), or null to follow the page's scroll. */
  setReveal(p: number | null): void;
  readonly progress: number;
  destroy(): void;
}

export interface RoomEngineOptions {
  hall: HallKey;
  base: string;
  canvas: HTMLCanvasElement;
  fx: HTMLCanvasElement;
  stage: HTMLElement;
  frame?: HTMLElement | null;
  edge?: HTMLElement | null;
  teaser?: HTMLElement | null;
  ui?: HTMLElement | null;
  tags?: HTMLElement | null;
  scrollEl?: HTMLElement | null;
  variant: Variant;
  small: boolean;
  reduced: boolean;
  /** On phones the photo takes this share of the stage's height (the rest is the chat). */
  phoneShare?: number;
  /** Phones: the stage's open band in px: below top (the site's header) and below each of above ([left, right, bottom]:
   *  the hall's controls, a chair under one stays below its bottom), above bottom (the hall's panel or the site's tab
   *  bar). The photo slides (on a short screen, steps back a little) to keep every chair's ring in the open, and the name
   *  tags as far as the rings leave room. Read every frame; null leaves the photo where it rests. */
  band?: (() => { top: number; above?: number[][]; bottom: number } | null) | null;
  onFlip?: (key: string) => void;
  onReady?: () => void;
}

export function createRoomEngine(opts: RoomEngineOptions): RoomEngine;
