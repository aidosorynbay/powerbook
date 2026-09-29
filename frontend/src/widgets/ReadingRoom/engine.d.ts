export type HallKey = 'a' | 'b';
export type Variant = 'day' | 'night';

export interface HallChar {
  seat: number;
  g: 'm' | 'f';
  head: [number, number];
  ring?: [number, number];
}

export interface Hall {
  files: string;
  seats: [number, number, number][];
  chars: Record<number, HallChar>;
}

export const HALLS: Record<HallKey, Hall>;

/** The render's reader who shows a person of this gender in this seat, or 0 when the seat has none. */
export function charFor(hall: HallKey, seat: number, gender: string): number;
/** The render's reader in this seat, whoever it is. */
export function seatChar(hall: HallKey, seat: number): (HallChar & { id: number }) | null;

export interface Occupant {
  key: string;
  seat: number;
  /** the render's reader shown in the chair, 0 for none (only a name tag and a lamp) */
  char: number;
  status: 'reading' | 'paused';
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
  onFlip?: (key: string) => void;
  onReady?: () => void;
}

export function createRoomEngine(opts: RoomEngineOptions): RoomEngine;
