/** «Битва кланов»: two teams, «Маяк» and «Парус», 14 days. Every member who
 * logs 30+ minutes before 00:00 brings a point; at midnight each point becomes a
 * book in the team's shared library. Open to anyone; only team numbers are public
 * (app/services/clan_war.py). Lives as the second tab of «Круг».
 * Layout after the council of 2026-10-17: one subtitle line, the pictures as the
 * hero, each team in its own colour, one status line, one strip; nothing twice. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, getApiBaseUrl, track, useAuth, useI18n } from '@/shared/lib';
import { Container, PageTransition } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import { Sheet } from '@/widgets/RoundToday';
import { LeagueGlyph, loadLeagueFonts } from '@/widgets/League';
import type { LeagueTierKey } from '@/shared/lib/types';
import { TeamChat } from './TeamChat';
import styles from './WarPage.module.css';

type Person = { user_id: string; display_name: string; avatar: string | null; league?: LeagueTierKey | null };
type Day = { date: string; hits: number | null; size: number; locked: boolean }; // hits: null = the rival's open day, hidden until its 00:00
type Team = { key: 'lighthouse' | 'sail'; size: number; hp: number; bricks: number; bricks_left: number; points: number; shelf: number; fill: number; today: number | null; members: Person[]; days: Day[] };
/** The day that has just closed: both teams' books, for the midnight reveal. */
type Reveal = { date: string; n: number; hits: [number, number]; sizes: [number, number]; final: boolean };
export type War = {
  id: string;
  start_date: string;
  end_date: string;
  status: 'signup' | 'live' | 'done';
  prize: string | null;
  days_total: number;
  day: number;
  joined_count: number;
  signup_until: string;
  starts_at: string;
  is_admin: boolean;
  me: { joined: boolean; team: Team['key'] | null; guest?: boolean; minutes?: number; hits?: number; days?: number; today?: boolean; shelf_today?: Person[]; ask_day?: boolean; minutes_yesterday?: number; room_read?: { date: string; minutes: number } | null };
  joined: Person[];
  teams: Team[];
  reveal?: Reveal;
  winner: Team['key'] | 'draw' | null;
};

/** Seconds left until an ISO moment, ticking each second; 0 once it has passed. */
function useLeft(iso: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return iso ? Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000)) : 0;
}

const clock = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const x = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
};

const ART: Record<Team['key'], string> = { lighthouse: '/leagues/diamond.jpg', sail: '/leagues/bronze.jpg' };

export function useWar() {
  const [war, setWar] = useState<War | null>(null);
  const load = useCallback(() => {
    apiGet<War>('/war', { requireAuth: true }).then(({ data }) => data && setWar(data));
  }, []);
  useEffect(() => {
    load();
    // a page left open across 00:00 moves to the new day by itself (and the locked one shows its books)
    const tick = window.setInterval(() => document.visibilityState === 'visible' && load(), 60000);
    // and at 00:00 sharp (Astana) the page asks again, so the closed day's books fly in front of the reader's eyes
    let midnight = 0;
    const arm = () => {
      const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
      const g = (k: string) => Number(p.find((x) => x.type === k)?.value ?? 0);
      const left = 86400 - (g('hour') * 3600 + g('minute') * 60 + g('second'));
      midnight = window.setTimeout(() => {
        load();
        window.setTimeout(load, 4000); // the server locks the day on its own minute tick: a second look
        arm();
      }, left * 1000 + 1200);
    };
    arm();
    const back = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', back);
    // the circle's dial saved minutes: the card and the page show the book at once
    window.addEventListener('pb:minutes-saved', load);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(midnight);
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('pb:minutes-saved', load);
    };
  }, [load]);
  return { war, setWar, load };
}

/** A face with the reader's league ring and bookmark tail, as everywhere else on the site. */
export function Avatar({ p }: { p: Person }) {
  return (
    <span className={styles.av} title={p.display_name}>
      {p.avatar ? <img src={`${getApiBaseUrl()}/social/avatar/${p.user_id}?v=${p.avatar}`} alt="" loading="lazy" /> : (p.display_name || '?').trim().charAt(0).toUpperCase()}
      {p.league && <LeagueGlyph tier={p.league} onAvatar face={32} />}
    </span>
  );
}

function dateRange(war: War, t: (k: string) => string) {
  const [, m1, d1] = war.start_date.split('-').map(Number);
  const [, m2, d2] = war.end_date.split('-').map(Number);
  return m1 === m2 ? `${d1}–${d2} ${t(`month.gen.${m2}`)}` : `${d1} ${t(`month.gen.${m1}`)} – ${d2} ${t(`month.gen.${m2}`)}`;
}

/** Which of the four pictures a library shows: its shelves fill as the team reads. */
const stage = (fill: number) => (fill < 25 ? 1 : fill < 50 ? 2 : fill < 75 ? 3 : 4);

function useBooks() {
  const { t, locale } = useI18n();
  return (n: number) =>
    locale === 'ru'
      ? `${n} ${t(n % 10 === 1 && n % 100 !== 11 ? 'war.book1' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'war.book2' : 'war.book5')}`
      : `${n} ${t('war.book5')}`;
}

const palette = (k: Team['key'], i: number) => SPINES[k][i % 6];
const SPINES: Record<Team['key'], string[]> = {
  lighthouse: ['#8ec1ea', '#5d9bd0', '#d6e8f7', '#3f7fb8', '#a9d0ee', '#f2f6fa'],
  sail: ['#f0ad6c', '#e2793d', '#f7d08a', '#c85a2a', '#f4b98a', '#fbe6c6'],
};
const MAX_FLYING = 28;
/** The midnight animation is built (clips, sprites, sparks) but switched off until the Flow clips are right (founder 2026-10-18:
 * the blue books fly out instead of in). Meanwhile the day's result is a calm card under the pictures. */
const REVEAL_ANIMATION = false;
const seenKey = (war: War) => `pb.war.reveal.${war.id}`;

/** The midnight reveal: once per reader per closed day, the day's books fly from the middle onto the two
 * libraries' shelves while the points count up, rival's included (it was hidden all day). */
function useReveal(war: War | null) {
  const [playing, setPlaying] = useState(false);
  const rv = war?.reveal;
  useLayoutEffect(() => {
    if (!REVEAL_ANIMATION || !war || !rv) return;
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(seenKey(war));
    } catch {
      /* private mode: the reveal simply plays again next time */
    }
    if (seen === rv.date && !new URLSearchParams(window.location.search).has('replay')) return; // ?replay: for the founder's review
    try {
      localStorage.setItem(seenKey(war), rv.date);
    } catch {
      /* ignore */
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    if (rv.hits[0] + rv.hits[1] === 0) return;
    setPlaying(true);
  }, [war?.id, rv?.date]); // eslint-disable-line react-hooks/exhaustive-deps
  return { playing, rv, end: () => setPlaying(false) };
}

/** Where the books stand in the two pictures (600×670): each shelf board as a segment [x0, x1] whose top edge runs from
 * y0 at the left to y1 at the right (the pictures are drawn in perspective). Read off the empty-shelf stage; the
 * rows nearest the middle come first, the low ones under the team's name last. */
type Board = [number, number, number, number];
const SHELVES: Record<Team['key'], Board[]> = {
  lighthouse: [
    [52, 205, 328, 335], [226, 358, 330, 335],
    [52, 205, 257, 262], [226, 358, 262, 268],
    [72, 205, 408, 412], [226, 358, 400, 405],
    [52, 205, 175, 185], [226, 358, 187, 195],
    [52, 205, 98, 115], [226, 358, 118, 130],
  ],
  sail: [
    [54, 200, 347, 352], [230, 350, 347, 352],
    [54, 200, 412, 418], [230, 350, 408, 414],
    [54, 200, 280, 283], [230, 350, 287, 290],
    [54, 200, 215, 220], [230, 350, 220, 230],
    [62, 200, 478, 483], [230, 350, 472, 478],
  ],
};
const SPINE_ASPECT = [0.2, 0.237, 0.269]; // width / height of the spine sprites, by thickness

/** Flow-made clips (Veo, from the pictures themselves): shelf stage k → k+1, 8 seconds each, 540×960. The shelf's fill
 * (25% per stage) maps onto a clip's timeline, so a team's day plays exactly the piece of film it earned, then
 * melts into the still picture. A stage without its clip keeps the 3D books. Add a clip here as it is made
 * (public/war-art/clips/<name>.mp4). */
const CLIPS: Record<Team['key'], Partial<Record<1 | 2 | 3, string>>> = {
  lighthouse: { 1: 'lighthouse-1', 2: 'lighthouse-2' },
  sail: { 1: 'sail-1' },
};
const CLIP_SEC = 8;
type ClipSeg = { name: string; from: number; to: number };

/** The pieces of film a team's day plays, or null when any stage it crosses has no clip yet. */
function planClips(team: Team, hits: number): ClipSeg[] | null {
  if (!team.shelf || hits <= 0) return null;
  const to = team.fill;
  let a = (100 * (team.points - hits)) / team.shelf;
  const segs: ClipSeg[] = [];
  while (a < to - 0.01) {
    const k = Math.min(3, Math.floor(a / 25) + 1) as 1 | 2 | 3;
    const name = CLIPS[team.key][k];
    if (!name) return null;
    const end = Math.min(to, 25 * k);
    segs.push({ name, from: Math.max(0, (a - 25 * (k - 1)) / 25), to: Math.min(1, (end - 25 * (k - 1)) / 25) });
    if (k === 3 && end >= 75) break;
    a = end;
  }
  return segs.length ? segs : null;
}

type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; c: string };

/** Two cozy library corners, each in its team's colour; a tap opens the team. While the day's reveal plays, the
 * books leave the VS disc in a burst of light, flip through the air and settle in rows on their own shelves
 * (sparks where each lands, the shelf glowing); a tap on the field skips to the end. */
function Field({ war, live, onTeam, playing, onEnd }: { war: War; live: boolean; onTeam: (k: Team['key']) => void; playing: boolean; onEnd: () => void }) {
  const { t } = useI18n();
  const books = useBooks();
  const rv = war.reveal;
  const fieldRef = useRef<HTMLDivElement>(null);
  const discRef = useRef<HTMLSpanElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const skipRef = useRef<() => void>(() => {});
  const sideRefs = useRef<(HTMLButtonElement | null)[]>([null, null]);
  const [landed, setLanded] = useState<[number, number]>([0, 0]);
  const [stage2, setStage2] = useState<'count' | 'done'>('count');

  useEffect(() => {
    if (!playing || !rv || !fieldRef.current || !discRef.current || !fxRef.current) return;
    const fieldEl = fieldRef.current;
    const field = fieldEl.getBoundingClientRect();
    const disc = discRef.current.getBoundingClientRect();
    const sx = disc.left + disc.width / 2 - field.left;
    const sy = disc.top + disc.height / 2 - field.top;
    const layer = fieldEl.querySelector<HTMLElement>('[data-fly]');
    if (!layer) return;
    let alive = true;
    let sidesLeft = 2;
    const videos: HTMLVideoElement[] = [];
    let skipped = false;
    const timers: number[] = [];
    const anims: Animation[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(() => alive && fn(), ms));

    // sparks on a canvas over the field
    const cv = fxRef.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(field.width * dpr);
    cv.height = Math.round(field.height * dpr);
    const g = cv.getContext('2d');
    const sparks: Spark[] = [];
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      if (g) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, field.width, field.height);
        g.globalCompositeOperation = 'lighter';
        for (let i = sparks.length - 1; i >= 0; i -= 1) {
          const p = sparks[i];
          p.life -= dt;
          if (p.life <= 0) {
            sparks.splice(i, 1);
            continue;
          }
          p.vy += 260 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          const k = p.life / p.max;
          g.globalAlpha = Math.min(1, k * 1.6);
          g.fillStyle = p.c;
          g.beginPath();
          g.arc(p.x, p.y, p.r * (0.4 + k * 0.6), 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }
      if (alive) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const burst = (x: number, y: number, colors: string[], n: number, power: number) => {
      for (let i = 0; i < n; i += 1) {
        const ang = Math.random() * Math.PI * 2;
        const v = power * (0.35 + Math.random() * 0.65);
        sparks.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - power * 0.35, life: 0.5 + Math.random() * 0.5, max: 1, r: 1.4 + Math.random() * 2.2, c: colors[i % colors.length] });
      }
    };

    // the light that opens the day: two rings and a flash from the VS disc
    const ring = (delay: number, size: number) => {
      const el = document.createElement('i');
      el.className = styles.ring;
      el.style.left = `${sx}px`;
      el.style.top = `${sy}px`;
      layer.appendChild(el);
      anims.push(
        el.animate(
          [{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 0.9 }, { transform: `translate(-50%,-50%) scale(${size})`, opacity: 0 }],
          { duration: 900, delay, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' },
        ),
      );
    };
    ring(0, 5.5);
    ring(160, 8);
    anims.push(discRef.current.animate([{ transform: 'translate(-50%,-50%) scale(1)' }, { transform: 'translate(-50%,-50%) scale(1.35)', offset: 0.3 }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 650, delay: 150, easing: 'ease-out' }));
    burst(sx, sy, ['#8ec1ea', '#f0ad6c', '#ffffff'], 26, 190);

    // own team's books leave first
    const teamOrder = war.me.team ? (war.teams[0].key === war.me.team ? [0, 1] : [1, 0]) : [0, 1];
    const counts = [Math.min(rv.hits[0], MAX_FLYING), Math.min(rv.hits[1], MAX_FLYING)];
    const stagger = Math.min(105, 1400 / Math.max(1, counts[0], counts[1]));
    const plans = [0, 1].map((ti) => (counts[ti] > 0 ? planClips(war.teams[ti], rv.hits[ti]) : null));
    const finishAll = () => {
      if (!alive) return;
      window.setTimeout(() => videos.forEach((v) => (v.style.opacity = '0')), 150);
      setLanded([rv.hits[0], rv.hits[1]]);
      setStage2('done');
      anims.push(layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, delay: 1500, fill: 'forwards' }));
      later(() => onEnd(), 3000);
    };
    skipRef.current = () => {
      if (skipped || !alive) return;
      skipped = true;
      videos.forEach((v) => v.remove());
      timers.splice(0).forEach((x) => window.clearTimeout(x));
      anims.splice(0).forEach((x) => x.cancel());
      layer.replaceChildren();
      sparks.length = 0;
      setLanded([rv.hits[0], rv.hits[1]]);
      setStage2('done');
      later(() => onEnd(), 1400);
    };

    // The books are 3D renders in the pictures' own light (public/war-art/books). Each one flies upright, turns on its
    // spine above its own gap on a shelf of the picture and slides down into it.
    const HH = 46; // an upright book's height in the air
    const HW = Math.round(HH * (99 / 168));
    const DUR = 1500;
    const sideDone = () => {
      sidesLeft -= 1;
      if (sidesLeft === 0) finishAll();
    };

    // a team whose stage has its clip plays that piece of film (counters follow it); others get the 3D books
    const playClip = (ti: number, order: number) => {
      const side = sideRefs.current[ti];
      const plan0 = plans[ti];
      const img = side?.querySelector('img');
      if (!side || !plan0 || !img) {
        sprites(ti, order);
        return;
      }
      // A day is a handful of books and a clip is a flurry of them: play a window of the clip at normal speed, long enough
      // for a day's books to be seen (more books, longer), starting at the clip's busy part and moving on as the stage fills.
      const hits0 = rv.hits[ti];
      const win = Math.max(2.8, Math.min(5.5, 0.45 * hits0));
      const t0 = Math.min(Math.max(0.7, plan0[0].from * CLIP_SEC), CLIP_SEC - win - 0.15);
      const plan: ClipSeg[] = [{ name: plan0[0].name, from: t0 / CLIP_SEC, to: (t0 + win) / CLIP_SEC }];
      const vid = document.createElement('video');
      vid.muted = true;
      vid.playsInline = true;
      vid.preload = 'auto';
      vid.setAttribute('muted', '');
      vid.setAttribute('playsinline', '');
      vid.className = styles.sideVideo;
      img.after(vid);
      videos.push(vid);
      const totalSec = plan.reduce((a, x) => a + (x.to - x.from) * CLIP_SEC, 0);
      const rate = 1;
      const hits = rv.hits[ti];
      const glow = side.querySelector<HTMLElement>('[data-glow]');
      let idx = 0;
      let before = 0; // clip seconds played in earlier pieces
      let shown = 0;
      let frame = 0;
      const stop = () => cancelAnimationFrame(frame);
      const end = () => {
        stop();
        vid.pause();
        setLanded((c) => (ti === 0 ? [hits, c[1]] : [c[0], hits]));
        sideDone();
      };
      const tick = () => {
        const s = plan[idx];
        const done = before + Math.max(0, vid.currentTime - s.from * CLIP_SEC);
        const n = Math.min(hits, Math.round((hits * done) / totalSec));
        if (n !== shown) {
          shown = n;
          setLanded((c) => (ti === 0 ? [n, c[1]] : [c[0], n]));
          glow?.animate([{ opacity: 0.6 }, { opacity: 0.15 }], { duration: 500, easing: 'ease-out' });
        }
        if (vid.currentTime >= s.to * CLIP_SEC - 0.03 || vid.ended) {
          before += (s.to - s.from) * CLIP_SEC;
          idx += 1;
          if (idx >= plan.length) {
            end();
            return;
          }
          load();
          return;
        }
        frame = requestAnimationFrame(tick);
      };
      const load = () => {
        const s = plan[idx];
        vid.src = `/war-art/clips/${s.name}.mp4`;
        vid.onloadeddata = () => {
          vid.onloadeddata = null;
          vid.currentTime = s.from * CLIP_SEC;
        };
        vid.onseeked = () => {
          vid.onseeked = null;
          vid.style.opacity = '1';
          vid.playbackRate = rate;
          vid.play().then(() => (frame = requestAnimationFrame(tick))).catch(() => end());
        };
        vid.load();
      };
      vid.onerror = () => {
        stop();
        vid.remove();
        sprites(ti, order);
      };
      later(load, 450 + order * 60);
    };

    const sprites = (ti: number, order: number) => {
      const side = sideRefs.current[ti];
      if (!side) {
        sideDone();
        return;
      }
      const r = side.getBoundingClientRect();
      const n = counts[ti];
      let landedHere = 0;
      const tk = war.teams[ti].key;
      const glow = side.querySelector<HTMLElement>('[data-glow]');
      // the picture sits in the box as object-fit: cover, object-position 50% 30%
      const sc = Math.max(r.width / 600, r.height / 670);
      const ox = r.left - field.left + (r.width - 600 * sc) * 0.5;
      const oy = r.top - field.top + (r.height - 670 * sc) * 0.3;
      // gaps: the left and right cases of a shelf level take turns; when a level is full, the next one up
      const rows = SHELVES[tk];
      const cursors: Record<number, number> = {};
      let pair = 0;
      for (let i = 0; i < n; i += 1) {
        const kind = (i * 5 + ti) % 6;
        const jit = (k: number) => Math.sin((i + 1) * 12.9898 * (k + 1) + ti * 78.233) * 0.5; // steady pseudo-random −0.5…0.5
        const bookH = 50 + (jit(3) + 0.5) * 14; // spine height in picture units
        const bookW = bookH * SPINE_ASPECT[kind % 3];
        let seg = ((pair * 2 + (i % 2)) * 1) % rows.length;
        if ((cursors[seg] ?? rows[seg][0] + 7) + bookW > rows[seg][1] - 5) {
          pair += 1;
          seg = (pair * 2 + (i % 2)) % rows.length;
          delete cursors[seg];
        }
        const [x0, x1, y0, y1] = rows[seg];
        const cursor = cursors[seg] ?? x0 + 7;
        const px = cursor + bookW / 2;
        cursors[seg] = cursor + bookW + 1.4;
        const board = y0 + ((px - x0) / (x1 - x0)) * (y1 - y0);
        const ex = ox + px * sc;
        const eyBottom = oy + board * sc;
        const f = Math.max(0.3, (bookH * sc * 1.45) / HH); // a little larger than the painted ones: the new books are seen
        const ey = eyBottom - (HH * f) / 2; // the book's centre at rest
        const lift = 34 * sc + 14; // the height it hangs above its gap before it slides in
        const rise = 80 + (jit(5) + 0.5) * 90;
        const spin0 = -60 + jit(4) * 140;
        const flip0 = 180 + Math.round(jit(6) * 4) * 90;
        const mx = sx + (ex - sx) * 0.5 + jit(7) * 30;
        const my = Math.min(sy, ey - lift) - rise;
        const delay = 520 + i * stagger + order * 70;
        const el = document.createElement('i');
        el.className = styles.flyBook;
        el.style.width = `${HW}px`;
        el.style.height = `${HH}px`;
        const hero = new Image();
        hero.src = `/war-art/books/${tk}-${kind}-hero.webp`;
        hero.style.height = `${HH}px`;
        hero.style.width = `${HW}px`;
        const spine = new Image();
        spine.src = `/war-art/books/${tk}-${kind}-spine.webp`;
        spine.style.height = `${HH}px`;
        spine.style.width = `${Math.round(HH * SPINE_ASPECT[kind % 3] * 10) / 10}px`;
        el.append(hero, spine);
        layer.appendChild(el);
        const at = (x: number, y: number) => `translate(${x - HW / 2}px, ${y - HH / 2}px)`;
        const a = el.animate(
          [
            { transform: `${at(sx, sy)} rotate(${spin0}deg) rotateY(${flip0}deg) scale(.15)`, opacity: 0, offset: 0 },
            { transform: `${at(sx, sy - 6)} rotate(${spin0}deg) rotateY(${flip0}deg) scale(.95)`, opacity: 1, offset: 0.09, easing: 'cubic-bezier(.2,.8,.3,1)' },
            { transform: `${at(mx, my)} rotate(${spin0 * 0.3}deg) rotateY(${flip0 * 0.4}deg) scale(1.15)`, opacity: 1, offset: 0.4, easing: 'cubic-bezier(.45,0,.55,1)' },
            // above the gap, upright, already shrinking to the size of the painted books
            { transform: `${at(ex, ey - lift)} rotate(0deg) rotateY(0deg) scale(${Math.max(f * 1.5, 0.5)})`, opacity: 1, offset: 0.68, easing: 'cubic-bezier(.4,0,.6,1)' },
            // turns on its spine, then slides down into the shelf, settling softly
            { transform: `${at(ex, ey - lift * 0.9)} rotate(0deg) rotateY(0deg) scale(${f * 1.2})`, opacity: 1, offset: 0.76 },
            { transform: `${at(ex, ey - lift * 0.55)} rotate(0deg) rotateY(0deg) scale(${f * 1.08})`, opacity: 1, offset: 0.86, easing: 'cubic-bezier(.4,0,.2,1)' },
            { transform: `${at(ex, ey + 1.2)} rotate(0deg) rotateY(0deg) scale(${f})`, opacity: 1, offset: 0.96 },
            { transform: `${at(ex, ey)} rotate(0deg) rotateY(0deg) scale(${f})`, opacity: 1, offset: 1 },
          ],
          { duration: DUR, delay, easing: 'linear', fill: 'both' },
        );
        // the cover turns edge-on (scaleX → 0) and the spine takes its place
        const turn = (keyframes: Keyframe[]) => ({ keyframes, opts: { duration: DUR, delay, fill: 'both' as const } });
        const h1 = turn([
          { opacity: 1, transform: 'scaleX(1)', offset: 0 },
          { opacity: 1, transform: 'scaleX(1)', offset: 0.68 },
          { opacity: 1, transform: 'scaleX(.12)', offset: 0.75 },
          { opacity: 0, transform: 'scaleX(.12)', offset: 0.76 },
          { opacity: 0, transform: 'scaleX(.12)', offset: 1 },
        ]);
        const s1 = turn([
          { opacity: 0, transform: 'scaleX(.1)', offset: 0 },
          { opacity: 0, transform: 'scaleX(.1)', offset: 0.74 },
          { opacity: 1, transform: 'scaleX(.1)', offset: 0.75 },
          { opacity: 1, transform: 'scaleX(1)', offset: 0.82 },
          { opacity: 1, transform: 'scaleX(1)', offset: 1 },
        ]);
        anims.push(a, hero.animate(h1.keyframes, h1.opts), spine.animate(s1.keyframes, s1.opts));
        const share = Math.floor(((i + 1) * rv.hits[ti]) / n) - Math.floor((i * rv.hits[ti]) / n); // exact points over ≤28 books
        later(() => {
          setLanded((cur) => (ti === 0 ? [cur[0] + share, cur[1]] : [cur[0], cur[1] + share]));
          burst(ex, eyBottom - (bookH * sc) / 2, [palette(tk, kind), '#ffe6b0'], 6, 55);
          glow?.animate([{ opacity: 0.7 }, { opacity: 0.2 }], { duration: 450, easing: 'ease-out' });
          if (i % 3 === 0) navigator.vibrate?.(8);
          landedHere += 1;
          if (landedHere === n) sideDone();
        }, delay + DUR * 0.95);
      }
    };

    teamOrder.forEach((ti, order) => {
      if (counts[ti] === 0) sideDone();
      else if (plans[ti]) playClip(ti, order);
      else sprites(ti, order);
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      timers.forEach((x) => window.clearTimeout(x));
      anims.forEach((x) => x.cancel());
      videos.forEach((v) => {
        v.pause();
        v.remove();
      });
      layer.replaceChildren();
      g?.clearRect(0, 0, cv.width, cv.height);
      skipRef.current = () => {};
    };
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`${styles.field} ${playing ? styles.playing : ''}`} ref={fieldRef}>
      {war.teams.map((x, ti) => {
        // while the books fly, the numbers are the ones before the day closed, counting up as each lands
        const pts = playing && rv ? x.points - rv.hits[ti] + landed[ti] : x.points;
        const fill = playing && rv && x.shelf ? (100 * pts) / x.shelf : x.fill;
        return (
          <button
            key={x.key}
            ref={(el) => {
              sideRefs.current[ti] = el;
            }}
            type="button"
            className={`${styles.side} ${x.key === 'lighthouse' ? styles.sideA : styles.sideB} ${war.me.team === x.key ? styles.mine : ''}`}
            onClick={() => onTeam(x.key)}
          >
            <img src={`/war-art/${x.key}-${stage(playing && rv && x.shelf && stage2 === 'count' ? (100 * (x.points - rv.hits[ti])) / x.shelf : x.fill)}.jpg`} alt="" />
            {playing && <span className={styles.glow} data-glow />}
            {war.me.team === x.key && <span className={styles.tag}>{t('war.yourTeam')}</span>}
            {playing && rv && landed[ti] > 0 && <span key={landed[ti]} className={styles.plus}>+{landed[ti]}</span>}
            <span className={styles.sideLbl}>
              <b>{t(`war.team.${x.key}`)}</b>
              <span>
                {books(pts)}
                {!playing && live && x.today ? <em> · +{x.today} {t('war.todayShort')}</em> : null}
                {!playing && live && x.today == null ? <em> · {t('war.hiddenToday')}</em> : null}
              </span>
              <i className={styles.fillBar}><i style={{ width: `${Math.max(2, Math.min(100, fill))}%` }} /></i>
              <small>{t('war.squad', { n: x.size })}</small>
            </span>
          </button>
        );
      })}
      <span className={styles.vsDisc} ref={discRef}>VS</span>
      <div className={styles.fly} data-fly aria-hidden="true" />
      <canvas className={styles.fx} ref={fxRef} aria-hidden="true" />
      {playing && rv && (
        <>
          <button type="button" className={styles.skip} onClick={() => skipRef.current()} aria-label={t('war.revealSkip')} />
          <div className={styles.dayBanner} role="status">
            <small>00:00</small>
            <b>{t('war.revealTitle', { n: rv.n })}</b>
            <span>
              {stage2 === 'done'
                ? `${t('war.team.lighthouse')} +${rv.hits[0]} · ${t('war.team.sail')} +${rv.hits[1]}`
                : t('war.revealSub')}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** «Сколько минут ты читал сегодня?» for every member. A circle reader's figure is the circle's own (the dial
 * shows the same number); a guest's stays with the war. Between 00:00 and 04:00 a circle reader first picks the
 * day: yesterday goes to the circle only, the war's day having closed at midnight. */
function MinutesLog({ war, onSaved }: { war: War; onSaved: (w: War) => void }) {
  const { t } = useI18n();
  const ask = !!war.me.ask_day;
  const [day, setDay] = useState<'today' | 'yesterday' | null>(ask ? null : 'today');
  const figure = (d: 'today' | 'yesterday' | null) => (d === 'yesterday' ? war.me.minutes_yesterday : d === 'today' ? war.me.minutes : 0) || 0;
  const [val, setVal] = useState(String(figure(day) || ''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const pick = (d: 'today' | 'yesterday') => {
    setDay(d);
    setVal(String(figure(d) || ''));
  };
  // the war's own today (Astana), not the phone's clock
  const label = (offset: number) => {
    const [y, m, d] = war.start_date.split('-').map(Number);
    const x = new Date(Date.UTC(y, m - 1, d + war.day - 1 - offset));
    // the site's own month names: Chrome has none for kk-KZ and wrote «M10 17»
    return `${x.getUTCDate()} ${t(`month.gen.${x.getUTCMonth() + 1}`)}`;
  };
  const save = async () => {
    const minutes = parseInt(val, 10);
    if (Number.isNaN(minutes) || !day) return;
    setBusy(true);
    setErr(false);
    const { data } = await apiPost<War>('/war/read', { minutes, day }, { requireAuth: true });
    if (data) {
      onSaved(data);
      window.dispatchEvent(new Event('pb:minutes-saved'));
    } else setErr(true);
    track('war_read', { minutes, day, guest: !!war.me.guest });
    setBusy(false);
  };
  return (
    <div className={styles.logBox}>
      {ask && (
        <div className={styles.whichDay}>
          <span>{t('war.whichDay')}</span>
          <div>
            <button type="button" className={day === 'yesterday' ? styles.dayOn : ''} onClick={() => pick('yesterday')}>{t('war.yesterdayChip', { d: label(1) })}</button>
            <button type="button" className={day === 'today' ? styles.dayOn : ''} onClick={() => pick('today')}>{t('war.todayChip', { d: label(0) })}</button>
          </div>
          {day === 'yesterday' && <small>{t('war.yesterdayNote')}</small>}
        </div>
      )}
      <div className={styles.guestLog}>
        <label>
          <span>{day === 'yesterday' ? t('war.minutesQYesterday') : t('war.guestQ')}</span>
          <input type="number" inputMode="numeric" min={0} max={1440} value={val} onChange={(e) => setVal(e.target.value)} placeholder="30" disabled={!day} />
        </label>
        <button type="button" className={styles.go} onClick={save} disabled={busy || val === '' || !day}>{t('war.guestSave')}</button>
      </div>
      {!war.me.guest && <small className={styles.syncNote}>{t('war.syncNote')}</small>}
      {err && <small className={styles.syncNote}>{t('war.saveErr')}</small>}
    </div>
  );
}

/** Last night's chair counted at 00:00 (the reader was still in the reading room, nothing saved): said once, with
 * «Я не читал(а)» for a timer that ran while they were away. */
function RoomRead({ war, onSaved }: { war: War; onSaved: (w: War) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const r = war.me.room_read;
  if (!r) return null;
  const drop = async () => {
    setBusy(true);
    const { data } = await apiPost<War>('/war/not-read', {}, { requireAuth: true });
    if (data) onSaved(data);
    track('war_not_read', { minutes: r.minutes });
    setBusy(false);
  };
  return (
    <div className={styles.roomRead}>
      <span>{t('war.roomRead', { m: r.minutes })}</span>
      <button type="button" onClick={drop} disabled={busy}>{t('war.notRead')}</button>
    </div>
  );
}

/** «Мой круг | Битва»: the war is the second tab of the circle, never the first. */
export function WarSwitch({ active }: { active: 'round' | 'war' }) {
  const { t } = useI18n();
  return (
    <div className={styles.seg} role="tablist">
      <Link to="/round" role="tab" aria-selected={active === 'round'} className={active === 'round' ? styles.segOn : ''}>{t('war.tabRound')}</Link>
      <Link to="/war" role="tab" aria-selected={active === 'war'} className={active === 'war' ? styles.segOn : ''}>{t('war.tabWar')}</Link>
    </div>
  );
}

export function WarPage() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const { war, setWar } = useWar();
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState(false);
  const [roster, setRoster] = useState<Team['key'] | null>(null);
  const [allNames, setAllNames] = useState(false);
  const [hiddenInfo, setHiddenInfo] = useState(false);
  const signupLeft = useLeft(war?.signup_until);
  const startLeft = useLeft(war?.starts_at);
  const books = useBooks();
  const reveal = useReveal(war);
  useEffect(() => {
    loadLeagueFonts();
  }, []);

  const act = async (path: string, event: string) => {
    setBusy(true);
    const { data } = await apiPost<War>(path, {}, { requireAuth: true });
    if (data) setWar(data);
    track(event);
    setBusy(false);
  };

  const rosterTeam = war?.teams.find((x) => x.key === roster);
  const prestart = war?.status === 'live' && startLeft > 0;
  const running = war?.status === 'live' && startLeft === 0;
  const sub = !war
    ? ''
    : war.status === 'signup' || prestart
      ? t('war.subSignup', { dates: dateRange(war, t) })
      : war.status === 'done'
        ? `${dateRange(war, t)} · ${t('war.over')}`
        : t('war.subLive', { dates: dateRange(war, t), n: war.day, total: war.days_total });
  const NAMES = 12;

  const facesEl = !war ? null : (running && war.me.team && (war.me.shelf_today?.length ?? 0) > 0 && (
                        <div className={styles.faces}>
                          <span>{t('war.shelfToday', { team: t(`war.teamGen.${war.me.team}`) })}</span>
                          <ul>
                            {war.me.shelf_today!.map((p) => (
                              <li key={p.user_id}><Link to={`/readers/${p.user_id}`} title={p.display_name}><Avatar p={p} /><small>{p.display_name}</small></Link></li>
                            ))}
                          </ul>
                        </div>
                      ));
  const stripEl = !war ? null : (!prestart && (
                        <div>
                          <h4 className={styles.h4}>{t('war.track')}</h4>
                          <div className={styles.strip}>
                            {war.teams.map((x) => (
                              <div key={x.key} className={`${styles.stripRow} ${x.key === 'lighthouse' ? styles.sideA : styles.sideB}`}>
                                <span>{t(`war.team.${x.key}`)}</span>
                                <div className={styles.cells}>
                                  {Array.from({ length: war.days_total }, (_, i) => {
                                    const d = x.days[i];
                                    const share = d && d.size && d.hits != null ? d.hits / d.size : 0;
                                    if (d && d.hits == null)
                                      return (
                                        <button key={i} type="button" className={`${styles.cellToday} ${styles.cellHidden}`} onClick={() => setHiddenInfo(true)} aria-label={t('war.hiddenToday')}>?</button>
                                      );
                                    return (
                                      <i
                                        key={i}
                                        className={d ? (d.locked ? styles.cellDone : styles.cellToday) : ''}
                                        style={d ? { ['--a' as string]: String(0.4 + 0.6 * share) } : undefined}
                                        title={d ? `${d.date}: ${d.hits}/${d.size}` : undefined}
                                      >
                                        {d ? d.hits : ''}
                                      </i>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                          {running && <p className={styles.note}>{t('war.lockNote')}</p>}
                        </div>
                      ));

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container size="md">
            {!war ? (
              <div className={styles.loading}>{t('dashboard.loading')}</div>
            ) : (
              <div className={styles.stack}>
                {isAuthenticated && <WarSwitch active="war" />}
                <header className={styles.head}>
                  <div>
                    <h1 className={styles.title}>{t('war.title')}</h1>
                    <div className={styles.sub}>{sub}</div>
                  </div>
                  <button type="button" className={styles.rulesLink} onClick={() => setRules(true)}>
                    {t('war.rulesShort')} <span aria-hidden="true">›</span>
                  </button>
                </header>

                {war.status === 'signup' ? (
                  <section className={styles.grid}>
                    <div className={styles.versus}>
                      <div className={styles.vsArt} style={{ backgroundImage: `url(${ART.lighthouse})` }}><span>{t('war.team.lighthouse')}</span></div>
                      <span className={styles.vsDisc}>VS</span>
                      <div className={styles.vsArt} style={{ backgroundImage: `url(${ART.sail})` }}><span>{t('war.team.sail')}</span></div>
                    </div>
                    <div className={styles.col}>
                      <ol className={styles.steps}>
                        <li><i>1</i>{t('war.ann1')}</li>
                        <li><i>2</i>{t('war.ann2')}</li>
                        <li><i>3</i>{t('war.ann3')}</li>
                      </ol>
                      <div className={styles.panel}>
                        {war.me.joined ? (
                          <div className={styles.cardTop}>
                            <b className={styles.ok}>{t('war.youreIn')}</b>
                            <button type="button" className={styles.quiet} onClick={() => act('/war/leave', 'war_leave')} disabled={busy}>{t('war.leave')}</button>
                          </div>
                        ) : signupLeft > 0 ? (
                          isAuthenticated ? (
                            <button type="button" className={styles.primary} onClick={() => act('/war/join', 'war_join')} disabled={busy}>{t('war.join')}</button>
                          ) : (
                            <Link to={`/login?redirect=${encodeURIComponent('/war')}`} className={styles.primary}>{t('war.join')}</Link>
                          )
                        ) : null}
                        {signupLeft > 0 ? (
                          <div className={styles.count}>
                            <span>{t('war.signupLeft')}</span>
                            <b>{clock(signupLeft)}</b>
                            <small>{t('war.autoSplit')}</small>
                          </div>
                        ) : (
                          <div className={styles.count}><span>{t('war.splitting')}</span></div>
                        )}
                      </div>
                      {war.joined.length > 0 && (
                        <div>
                          <h4 className={styles.h4}>{t('war.joinedHead', { n: war.joined_count })}</h4>
                          <ul className={styles.joinedList}>
                            {(allNames ? war.joined : war.joined.slice(0, NAMES)).map((p) => (
                              <li key={p.user_id}><Link to={`/readers/${p.user_id}`}><Avatar p={p} /><span>{p.display_name}</span></Link></li>
                            ))}
                            {!allNames && war.joined.length > NAMES && (
                              <li><button type="button" className={styles.more} onClick={() => setAllNames(true)}>{t('war.more', { n: war.joined.length - NAMES })}</button></li>
                            )}
                          </ul>
                        </div>
                      )}
                      {war.is_admin && (
                        <button type="button" className={styles.admin} onClick={() => window.confirm(t('war.splitConfirm', { n: war.joined_count })) && act('/war/split', 'war_split')} disabled={busy || war.joined_count < 2}>
                          {t('war.split', { n: war.joined_count })}
                        </button>
                      )}
                    </div>
                  </section>
                ) : (
                  <section className={styles.grid}>
                    {/* on a wide screen the faces and the days sit under the pictures; on a phone after today's form */}
                    <div className={styles.col}>
                      <Field war={war} live={running} onTeam={setRoster} playing={reveal.playing} onEnd={reveal.end} />
                      {war.reveal && !prestart && (
                        <div className={styles.dayResult}>
                          <div>
                            <small>00:00</small>
                            <b>{t('war.revealTitle', { n: war.reveal.n })}</b>
                          </div>
                          <span className={`${styles.resA}`}>{t('war.team.lighthouse')} <i>+{war.reveal.hits[0]}</i></span>
                          <span className={`${styles.resB}`}>{t('war.team.sail')} <i>+{war.reveal.hits[1]}</i></span>
                        </div>
                      )}
                      <div className={styles.wide}>{facesEl}{stripEl}</div>
                    </div>
                    <div className={styles.col}>
                      {war.winner && !reveal.playing && (
                        <div className={styles.winner}>{war.winner === 'draw' ? t('war.draw') : t('war.won', { team: t(`war.team.${war.winner}`) })}</div>
                      )}
                      {prestart && (
                        <div className={styles.panel}>
                          <div className={styles.count}>
                            <span>{t('war.startIn')}</span>
                            <b>{clock(startLeft)}</b>
                            <small>{war.me.team ? t('war.getReady') : t('war.closed')}</small>
                          </div>
                        </div>
                      )}
                      {running && war.me.team && (
                        <div className={`${styles.status} ${war.me.today ? '' : styles.statusTodo}`}>
                          <div>
                            <b>
                              {war.me.today
                                ? t('war.meDone', { team: t(`war.team.${war.me.team}`) })
                                : war.me.minutes
                                  ? t('war.meSome', { m: war.me.minutes, left: 30 - war.me.minutes })
                                  : t('war.meNot')}
                            </b>
                            <small>{t('war.contrib', { books: books(war.me.hits ?? 0) })}</small>
                          </div>
                        </div>
                      )}
                      {running && war.me.team && <RoomRead war={war} onSaved={setWar} />}
                      {running && war.me.team && <MinutesLog key={`${war.day}-${war.me.ask_day ? 1 : 0}`} war={war} onSaved={setWar} />}
                      {running && !war.me.team && <p className={styles.note}>{t('war.closed')}</p>}
                      <div className={styles.narrow}>{facesEl}{stripEl}</div>
                      {war.me.team && <TeamChat />}
                    </div>
                  </section>
                )}

                {war.prize && <div className={styles.prize}>{t('war.prize')}: {war.prize}</div>}
              </div>
            )}
          </Container>
        </main>
        <Footer />
      </div>
      <Sheet open={rules} onClose={() => setRules(false)} label={t('war.rules')}>
        <h3 className={styles.sheetTitle}>{t('war.rules')}</h3>
        <ul className={styles.rules}>
          <li>{t('war.rule1')}</li>
          <li>{t('war.rule2')}</li>
          <li>{t('war.rule3')}</li>
          <li>{t('war.rule4')}</li>
        </ul>
        <div className={styles.tip}>
          <p>{t('war.tip')}</p>
          <div className={styles.guides}>
            <a href="/guides/powerbook-iphone.pdf" target="_blank" rel="noopener" onClick={() => track('war_guide', { os: 'ios' })}>{t('war.guideIphone')}</a>
            <a href="/guides/powerbook-android.pdf" target="_blank" rel="noopener" onClick={() => track('war_guide', { os: 'android' })}>{t('war.guideAndroid')}</a>
          </div>
        </div>
        <button type="button" className={styles.close} onClick={() => setRules(false)}>{t('lg.done')}</button>
      </Sheet>
      <Sheet open={hiddenInfo} onClose={() => setHiddenInfo(false)} label={t('war.hiddenToday')}>
        <h3 className={styles.sheetTitle}>{t('war.hiddenTitle')}</h3>
        <p className={styles.hiddenText}>{t('war.hiddenInfo')}</p>
        <button type="button" className={styles.close} onClick={() => setHiddenInfo(false)}>{t('lg.done')}</button>
      </Sheet>
      <Sheet open={!!rosterTeam} onClose={() => setRoster(null)} label={roster ? t(`war.team.${roster}`) : ''}>
        {rosterTeam && (
          <>
            <h3 className={styles.sheetTitle}>{t(`war.team.${rosterTeam.key}`)} · {rosterTeam.size}</h3>
            <ul className={styles.roster}>
              {rosterTeam.members.map((p) => (
                <li key={p.user_id}><Link to={`/readers/${p.user_id}`} onClick={() => setRoster(null)}><Avatar p={p} /><span>{p.display_name}</span></Link></li>
              ))}
            </ul>
            <button type="button" className={styles.close} onClick={() => setRoster(null)}>{t('lg.done')}</button>
          </>
        )}
      </Sheet>
    </PageTransition>
  );
}

/** At the top of «Круг» while a war is on: the switch to its tab. */
export function RoundWarSwitch() {
  const { war } = useWar();
  if (!war || war.status === 'done') return null;
  return <WarSwitch active="round" />;
}

/** On the round tab while sign-up is open: the race announced, with a way in. */
export function WarAnnounce() {
  const { t } = useI18n();
  const { war } = useWar();
  const left = useLeft(war?.signup_until);
  if (!war || war.status !== 'signup' || left <= 0) return null;
  return (
    <Link to="/war" className={styles.ann} onClick={() => track('war_announce')}>
      <span className={styles.annGlow} />
      <span className={styles.annKicker}>{t('war.annKicker', { dates: dateRange(war, t) })}</span>
      <span className={styles.annTitle}>{t('war.title')}</span>
      <span className={styles.annVersus}>
        <span className={styles.annArt} style={{ backgroundImage: `url(${ART.lighthouse})` }}><b>{t('war.team.lighthouse')}</b></span>
        <span className={styles.annVs}>VS</span>
        <span className={styles.annArt} style={{ backgroundImage: `url(${ART.sail})` }}><b>{t('war.team.sail')}</b></span>
      </span>
      <span className={styles.annRules}>
        <span><i>1</i>{t('war.ann1')}</span>
        <span><i>2</i>{t('war.ann2')}</span>
        <span><i>3</i>{t('war.ann3')}</span>
      </span>
      <span className={styles.annCta}>{war.me.joined ? t('war.annIn') : t('war.join')}</span>
      <span className={styles.annCount}>{t('war.joinedCount', { n: war.joined_count })} · {t('war.signupUntil')} {clock(left)}</span>
    </Link>
  );
}

/** On the round tab: the war in one line, a door to its page. */
export function WarCard() {
  const { t } = useI18n();
  const { war } = useWar();
  if (!war || war.status !== 'live') return null;
  const [a, b] = war.teams;
  return (
    <Link to="/war" className={styles.card} onClick={() => track('war_card')}>
      <span className={styles.cardArt} style={{ backgroundImage: `url(${ART.lighthouse})` }} />
      <span className={styles.cardText}>
        <b>{t('war.title')}</b>
        {war.day > 0 && war.me.team && (
          <span className={war.me.today ? styles.cardMeDone : styles.cardMe}>
            {war.me.today
              ? t('war.cardMeDone', { team: t(`war.teamGen.${war.me.team}`) })
              : war.me.minutes
                ? t('war.cardMeSome', { left: 30 - war.me.minutes, team: t(`war.teamGen.${war.me.team}`) })
                : t('war.cardMeNot', { team: t(`war.teamGen.${war.me.team}`) })}
          </span>
        )}
        <small>
          {war.day === 0 ? t('war.cardSoon') : t('war.cardLive', { a: a?.points ?? 0, b: b?.points ?? 0, n: war.day, total: war.days_total })}
        </small>
      </span>
      <span className={styles.cardArt} style={{ backgroundImage: `url(${ART.sail})` }} />
    </Link>
  );
}
