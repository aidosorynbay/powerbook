import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { apiGet, useI18n } from '@/shared/lib';
import { HALLS, charFor, createRoomEngine, seatChar, type HallKey, type RoomEngine } from './engine';
import styles from './ReadingRoom.module.css';
import own from './LiveRoom.module.css';

/** The room through a window (GET /reading-room/{hall}/public): no names, no ids. */
export type PublicReader = {
  key: string;
  seat: number;
  gender: string;
  status: 'reading' | 'paused';
  elapsed_seconds: number;
  book: string;
};
export type PublicRoom = { seats: number; readers: PublicReader[]; today: { readers: number; minutes: number }; guest_seats_left?: number };
export type PublicHall = 'round' | 'library';

const PHONE = '(max-width: 759px)';
const HALL_KEY: Record<PublicHall, HallKey> = { round: 'a', library: 'b' };
const PHONE_HALL: Record<PublicHall, HallKey> = { round: 'mr', library: 'ml' };
const pad = (n: number) => String(n).padStart(2, '0');
export const clock = (s: number) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};

type Props = {
  hall: PublicHall;
  /** What sits over the photo at its foot: the front page's words and buttons, or the visitor's dock. */
  children?: ReactNode;
  /** Free chairs get a ring to tap (the visitor's room). */
  onSeat?: (seat: number) => void;
  /** The visitor's own sitting, shown as «Вы». */
  mineKey?: string | null;
  /** Called with each fresh look at the room, and the free chairs this screen actually draws. */
  onRoom?: (room: PublicRoom, drawableFree: number[]) => void;
  /** A bump re-reads the room now (after sitting down or getting up). */
  refresh?: number;
  /** The still photo shown until the living one is ready. */
  poster?: ReactNode;
  className?: string;
  /** Phones: slide the photo so the chairs (and the readers in them) stay in the open between the header and the
   *  words at the photo's foot, instead of showing the ceiling. */
  keepChairsClear?: boolean;
  /** Extra class for the overlay at the photo's foot (e.g. the front page's left-side shade). */
  uiClassName?: string;
  style?: CSSProperties;
};

/**
 * The living reading room, whole and at once: the same photo engine as /round
 * (breathing, blinking readers, lamps), the readers sitting in it right now —
 * each with a timer and the book on their knees, never a name.
 */
export function LiveRoom({ hall, children, onSeat, mineKey, onRoom, refresh = 0, poster, className, uiClassName, keepChairsClear, style }: Props) {
  const { t } = useI18n();
  const phone = useMemo(() => window.matchMedia?.(PHONE).matches ?? false, []);
  const hk: HallKey = phone ? PHONE_HALL[hall] : HALL_KEY[hall];
  const H = HALLS[hk];
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);

  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const uiRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<RoomEngine | null>(null);
  const onRoomRef = useRef(onRoom);
  onRoomRef.current = onRoom;
  const hkRef = useRef(hk);
  hkRef.current = hk;

  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [ready, setReady] = useState(false);
  // bumped when the browser takes the GPU context away (a phone under memory pressure): a fresh canvas and engine
  const [glKey, setGlKey] = useState(0);
  const stamp = useRef(performance.now());
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await apiGet<PublicRoom>(`/reading-room/${hall}/public`);
      if (!alive || !data) return;
      stamp.current = performance.now();
      setRoom(data);
      const taken = new Set(data.readers.map((r) => r.seat));
      const drawable = HALLS[hkRef.current].seats
        .map((s, i) => (s[0] >= 0 && seatChar(hkRef.current, i) && !taken.has(i) ? i : -1))
        .filter((i) => i >= 0);
      onRoomRef.current?.(data, drawable);
    };
    load();
    const id = window.setInterval(load, 15_000);
    const tick = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.clearInterval(tick);
    };
  }, [hall, refresh]);

  useEffect(() => {
    const stage = stageRef.current, canvas = cvRef.current, fx = fxRef.current;
    if (!stage || !canvas || !fx) return;
    const small = Math.min(window.innerWidth, window.innerHeight * 1.8) * Math.min(window.devicePixelRatio || 1, 2) < 1900;
    const engine = createRoomEngine({
      hall: hk, base: '/reading-room/', canvas, fx, stage,
      frame: frameRef.current, ui: uiRef.current, tags: tagsRef.current,
      scrollEl: null,
      // the open band on a phone: below the site's header, above the words at the photo's foot
      band: phone && keepChairsClear ? () => {
        const st = stage.getBoundingClientRect();
        if (!st.height) return null;
        const header = document.querySelector('header')?.getBoundingClientRect();
        const top = Math.max(0, (header?.bottom ?? st.top) - st.top) + 6;
        const words = uiRef.current?.firstElementChild?.getBoundingClientRect();
        const bottom = words && words.height ? words.top - st.top - 6 : st.height;
        return { top, bottom };
      } : null,
      // the evening room: lamps lit, the window dark
      variant: 'night',
      small, reduced,
      onReady: () => setReady(true),
    });
    engineRef.current = engine;
    // until the photo has arrived the canvas is hidden and the still poster shows (an undrawn canvas is black)
    const lost = (e: Event) => {
      e.preventDefault();
      setReady(false);
      setGlKey((k) => k + 1);
    };
    canvas.addEventListener('webglcontextlost', lost);
    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      engine.destroy();
      engineRef.current = null;
    };
  }, [hk, reduced, phone, keepChairsClear, glKey]);

  const readers = useMemo(() => room?.readers ?? [], [room]);
  useEffect(() => {
    engineRef.current?.setOccupants(readers.map((r) => ({
      key: r.key, seat: r.seat, char: charFor(hk, r.seat, r.gender), status: r.status,
      gender: r.gender === 'male' ? 'm' : 'f',
    })));
  }, [readers, hk]);

  const since = (performance.now() - stamp.current) / 1000;
  const taken = new Set(readers.map((r) => r.seat));
  const tags = readers.map((r) => {
    const ch = charFor(hk, r.seat, r.gender);
    const chair = H.seats[r.seat];
    if (!ch && (!chair || chair[0] < 0)) return null;
    const at = ch ? H.chars[ch].head : ([chair[0], chair[1] - 0.03] as [number, number]);
    const mine = mineKey === r.key;
    return (
      <span
        key={r.key}
        className={`${styles.tag} ${own.tag} ${r.status === 'paused' ? styles.tagPaused : ''} ${mine ? styles.tagMe : ''}`}
        data-u={at[0]}
        data-v={at[1]}
        data-tf=" translate(-50%,-100%) translateY(-8px)"
        data-clamp="1"
        data-stack="1"
      >
        <svg className={styles.bk} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" />
          <path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />
        </svg>
        <span className={styles.tagText}>
          <span className={styles.tagRow}>
            {mine && <span>{t('room.you')}</span>}
            <b>{r.status === 'paused' ? t('room.paused') : clock(r.elapsed_seconds + (r.status === 'reading' ? since : 0))}</b>
          </span>
          <i className={styles.tagBook} title={r.book}>{r.book}</i>
        </span>
      </span>
    );
  });

  const rings = onSeat
    ? H.seats.map((s, i) => {
        if (taken.has(i) || s[0] < 0) return null;
        const sc = seatChar(hk, i);
        if (!sc) return null;
        const at = sc.ring ?? sc.head ?? ([s[0], s[1]] as [number, number]);
        return (
          <button
            key={`free-${i}`}
            type="button"
            className={`${styles.free} ${styles.freeOwn}`}
            data-u={at[0]}
            data-v={at[1]}
            data-label="1"
            data-clamp="1"
            aria-label={`${t('room.sitSeen')} · ${i + 1}`}
            onClick={() => onSeat(i)}
          >
            <span>{t('room.sitSeen')}</span>
          </button>
        );
      })
    : null;

  const ghosts = keepChairsClear && phone
    ? H.seats.map((s, i) => {
        if ((onSeat && !taken.has(i)) || s[0] < 0) return null;
        const sc = seatChar(hk, i);
        if (!sc) return null;
        const at = sc.ring ?? sc.head ?? ([s[0], s[1]] as [number, number]);
        return (
          <span key={`ghost-${i}`} className={own.ghost} data-u={at[0]} data-v={at[1]} data-label="1" aria-hidden="true">
            <span />
          </span>
        );
      })
    : null;

  return (
    <section className={`${styles.full} ${own.room} ${className ?? ''}`} style={style} aria-label={t('home.room.title')}>
      <div className={styles.stage} ref={stageRef}>
        <div className={styles.frame} ref={frameRef}>
          {poster && <div className={`${own.poster} ${ready ? own.posterGone : ''}`} aria-hidden="true">{poster}</div>}
          <canvas key={`cv-${glKey}`} className={`${styles.cv} ${poster && !ready ? own.hidden : ''}`} ref={cvRef} aria-hidden="true" />
          <canvas key={`fx-${glKey}`} className={styles.fx} ref={fxRef} aria-hidden="true" />
          <div className={styles.tags} ref={tagsRef}>
            {ghosts}
            {tags}
            {rings}
          </div>
          <div className={`${own.ui} ${uiClassName ?? ''}`} ref={uiRef}>{children}</div>
        </div>
      </div>
    </section>
  );
}
