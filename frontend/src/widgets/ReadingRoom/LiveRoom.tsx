import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiGet, useI18n } from '@/shared/lib';
import { HALLS, charFor, createRoomEngine, type HallKey, type RoomEngine } from './engine';
import styles from './ReadingRoom.module.css';
import own from './LiveRoom.module.css';

/** The room through the front page's window (GET /reading-room/round/public): no names, no ids. */
type PublicReader = {
  key: string;
  seat: number;
  gender: string;
  status: 'reading' | 'paused';
  elapsed_seconds: number;
  book: string;
};
type PublicRoom = { readers: PublicReader[]; today: { readers: number; minutes: number } };

const PHONE = '(max-width: 759px)';
const pad = (n: number) => String(n).padStart(2, '0');
const clock = (s: number) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};

/**
 * The living reading room for visitors: the camera starts close on the night
 * window and pulls back to the whole hall as the page scrolls (the same
 * engine as /round), with today's readers in their chairs — each with a
 * timer and the book on their knees. `children` is what appears once the
 * hall is whole: the way in.
 */
export function LiveRoom({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  const phone = useMemo(() => window.matchMedia?.(PHONE).matches ?? false, []);
  const hk: HallKey = phone ? 'mr' : 'a';
  const H = HALLS[hk];
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);

  const scrollRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const teaserRef = useRef<HTMLDivElement>(null);
  const uiRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<RoomEngine | null>(null);

  const [room, setRoom] = useState<PublicRoom | null>(null);
  const stamp = useRef(performance.now());
  const [, setTick] = useState(0);
  const [near, setNear] = useState(false);

  // Mount the photo only when the section comes near: the first screen stays light.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setNear(true);
        io.disconnect();
      }
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    let alive = true;
    const load = async () => {
      const { data } = await apiGet<PublicRoom>('/reading-room/round/public');
      if (!alive || !data) return;
      stamp.current = performance.now();
      setRoom(data);
    };
    load();
    const id = window.setInterval(load, 20_000);
    const tick = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.clearInterval(tick);
    };
  }, [near]);

  useEffect(() => {
    const stage = stageRef.current, canvas = cvRef.current, fx = fxRef.current;
    if (!near || !stage || !canvas || !fx) return;
    const small = Math.min(window.innerWidth, window.innerHeight * 1.8) * Math.min(window.devicePixelRatio || 1, 2) < 1900;
    const engine = createRoomEngine({
      hall: hk, base: '/reading-room/', canvas, fx, stage,
      frame: frameRef.current, edge: edgeRef.current, teaser: teaserRef.current, ui: uiRef.current, tags: tagsRef.current,
      scrollEl: scrollRef.current,
      // the front page's room is always the evening one: lamps lit, the window dark
      variant: 'night',
      small, reduced,
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [near, hk, reduced]);

  const readers = useMemo(() => room?.readers ?? [], [room]);
  useEffect(() => {
    engineRef.current?.setOccupants(readers.map((r) => ({
      key: r.key, seat: r.seat, char: charFor(hk, r.seat, r.gender), status: r.status,
      gender: r.gender === 'male' ? 'm' : 'f',
    })));
  }, [readers, hk, near]);

  const since = (performance.now() - stamp.current) / 1000;
  const tags = readers.map((r) => {
    const ch = charFor(hk, r.seat, r.gender);
    const chair = H.seats[r.seat];
    if (!ch && (!chair || chair[0] < 0)) return null;
    const at = ch ? H.chars[ch].head : ([chair[0], chair[1] - 0.03] as [number, number]);
    return (
      <span
        key={r.key}
        className={`${styles.tag} ${own.tag} ${r.status === 'paused' ? styles.tagPaused : ''}`}
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
            <b>{r.status === 'paused' ? t('room.paused') : clock(r.elapsed_seconds + (r.status === 'reading' ? since : 0))}</b>
          </span>
          <i className={styles.tagBook} title={r.book}>{r.book}</i>
        </span>
      </span>
    );
  });

  const n = readers.length;
  return (
    <section className={`${styles.scroll} ${own.room}`} ref={scrollRef} aria-label={t('home.room.title')}>
      <div className={styles.stage} ref={stageRef}>
        <div className={styles.frameEdge} ref={edgeRef} />
        <div className={styles.frame} ref={frameRef}>
          <canvas className={styles.cv} ref={cvRef} aria-hidden="true" />
          <canvas className={styles.fx} ref={fxRef} aria-hidden="true" />
          <div className={styles.tags} ref={tagsRef}>{tags}</div>
          <div className={styles.teaser} ref={teaserRef}>
            <div className={styles.teaserK}>{t('home.room.kicker')}</div>
            <div className={styles.teaserT}>{n ? t('home.room.now', { n }) : t('home.room.quiet')}</div>
            <div className={styles.teaserH}>
              <span className={styles.chev} aria-hidden="true"><i /><i /><i /></span>
              {t('home.room.scroll')}
            </div>
          </div>
          <div className={own.ui} ref={uiRef}>{children}</div>
        </div>
      </div>
    </section>
  );
}
