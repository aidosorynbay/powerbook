import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, colorFromSeed, useAuth, useI18n, useResolvedTheme, track } from '@/shared/lib';
import { HALLS, charFor, createRoomEngine, seatChar, type HallKey, type RoomEngine } from './engine';
import { Ding, Snd, type SoundChannel } from './sound';
import { ShareDay } from '@/widgets/ShareDay';
import styles from './ReadingRoom.module.css';

/**
 * The reading room: the founder's render of a reading hall, alive, with the readers who are reading right now sitting in
 * its chairs. "round" is the current circle's hall (only its participants sit there, and their minutes go into «Сегодня»),
 * "library" is open to everyone. In the "scroll" layout the hall unfolds as the page scrolls into it (under the round
 * page); in "full" it fills its own page (the library's hall). Phones show the founder's portrait render of the hall,
 * the same picture for both halls, with the readers and the chat in a sheet from below.
 */
export type HallName = 'round' | 'library';

type Reader = {
  session_id: string;
  user_id: string;
  display_name: string;
  username: string;
  gender: string;
  seat: number;
  book: string;
  status: 'reading' | 'paused';
  elapsed_seconds: number;
  today_minutes: number;
  in_round: boolean;
  me: boolean;
};
type Message = { id: string; user_id: string; display_name: string; text: string; created_at: string; me: boolean };
/* the hall's day, for the chat: each reader sitting down with a book and getting up with their minutes */
type RoomEvent = { kind: 'sit' | 'finish'; at: string; user_id: string; display_name: string; gender: string; book: string; minutes?: number };
type HallDay = { date: string; readers: number; names: string[]; minutes: number; events: RoomEvent[] };
/* away_seconds: a stretch the page was silent (a locked screen, another app), waiting for the reader to say whether they read;
   days: last night's and today's reading day when the day turned at 03:00 under the sitting (or it is the small hours), so
   «Закончить» asks which day the minutes go to */
type MySession = { id: string; hall: HallName; seat: number; book: string; status: 'reading' | 'paused'; elapsed_seconds: number; away_seconds: number; days?: string[] };
type RoomState = {
  hall: HallName;
  seats: number;
  can_sit: boolean;
  round: { id: string; year: number; month: number } | null;
  in_round: boolean;
  today_minutes: number;
  readers: Reader[];
  my_session: MySession | null;
  messages: Message[];
  /* the reading day minutes go to: it turns at 03:00 Astana time, so after midnight it is still the day before */
  reading_day: string;
  day: HallDay | null;
};
type Finished = { sessionId: string; minutes: number; credited: boolean; reason: string | null; date: string | null };
type FinishOut = { minutes: number; credited: boolean; reason: string | null; date: string | null; today_minutes: number };

const HALL_KEY: Record<HallName, HallKey> = { round: 'a', library: 'b' };
const PHONE_HALL: Record<HallName, HallKey> = { round: 'mr', library: 'ml' };
const PHONE = '(max-width: 759px)';

function usePhone() {
  const [phone, setPhone] = useState(() => window.matchMedia?.(PHONE).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE);
    if (!mq) return;
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}
const BASE = '/reading-room/';
const GOAL = 30;
const RECENT_KEY = 'pb.room.books';
const SOUND_CHANNELS: SoundChannel[] = ['music', 'fire', 'rain', 'pages'];
/* first-visit hints: small bobbing arrows at the room's controls, each gone once it has been used */
const COACH_KEY = 'pb.room.coach.v1';
type CoachId = 'sit' | 'reader' | 'lock' | 'sound' | 'chat';
const COACH: { id: CoachId; dir: 'above' | 'below' }[] = [
  { id: 'sit', dir: 'above' },
  { id: 'reader', dir: 'above' },
  { id: 'lock', dir: 'below' },
  { id: 'sound', dir: 'below' },
  { id: 'chat', dir: 'below' },
];
function coachSeen() {
  try {
    return localStorage.getItem(COACH_KEY) === '1';
  } catch {
    return true;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (s: number) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};
/** 2026-09-29 -> { d: 29, m: 9 } */
const dayOf = (iso: string) => ({ d: Number(iso.slice(8, 10)), m: Number(iso.slice(5, 7)) });
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 4) : [];
  } catch {
    return [];
  }
}
function saveRecent(book: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([book, ...readRecent().filter((b) => b !== book)].slice(0, 4)));
  } catch {
    // storage blocked: nothing to remember
  }
}

/* Phones: where the hall is in the open, in the stage's px: under the site's header, and under whatever of the hall's
   heading hangs over a chair (or under the book picker, which takes the heading's place); above the hall's panel and
   PowerBook's tab bar. The engine keeps every chair in the open. */
function openBand(stage: HTMLElement) {
  const st = stage.getBoundingClientRect();
  if (!st.height) return null;
  // [left, right, the lowest a chair under it may reach]
  const over = (el: Element) => {
    const r = el.getBoundingClientRect();
    return [r.left - st.left, r.right - st.left, r.bottom - st.top + 6];
  };
  const header = document.querySelector('header')?.getBoundingClientRect();
  const top = Math.max(0, (header?.bottom ?? st.top) - st.top) + 6;
  const dock = stage.querySelector<HTMLElement>('[data-dock]');
  const head = stage.querySelector<HTMLElement>('[data-head]');
  const above = dock?.dataset.dock === 'top'
    ? [over(dock)]
    : [...(head?.querySelectorAll(`.${styles.kicker}, .${styles.title}, .${styles.meta} > *, .${styles.ctrl} button`) ?? [])]
        .filter((el) => !el.closest(`.${styles.sndPop}`))
        .map(over);
  let bottom = st.height;
  const nav = document.querySelector('[data-bottom-nav]')?.getBoundingClientRect();
  if (nav?.height) bottom = Math.min(bottom, nav.top - st.top);
  if (dock?.dataset.dock === 'bottom') bottom = Math.min(bottom, dock.getBoundingClientRect().top - st.top);
  return { top, above, bottom: bottom - 6 };
}

const BookIcon = () => (
  <svg className={styles.bk} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z" />
    <path d="M12 6v13.5" />
  </svg>
);

export function ReadingRoom({ hall, layout, onToday }: { hall: HallName; layout: 'scroll' | 'full'; onToday?: () => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const theme = useResolvedTheme();
  const phone = usePhone();
  const hk = phone ? PHONE_HALL[hall] : HALL_KEY[hall];
  const H = HALLS[hk];
  const myG = user?.gender === 'male' ? 'm' : user?.gender === 'female' ? 'f' : null;

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
  const tagEls = useRef(new Map<string, HTMLElement>());

  const [state, setState] = useState<RoomState | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const stamp = useRef(performance.now());
  const since = useRef<string | null>(null);
  const [near, setNear] = useState(layout === 'full');

  const [pick, setPick] = useState<{ seat: number | null } | null>(null);
  const [book, setBook] = useState('');
  const [suggest, setSuggest] = useState<string[]>(readRecent);
  const [finished, setFinished] = useState<Finished | null>(null);
  // The day a finished sitting went to, while «Поделиться» is open for it.
  const [shareDay, setShareDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // «За какой день записать?» is on the dock (see MySession.days)
  const [askDay, setAskDay] = useState(false);
  const [tab, setTab] = useState<'readers' | 'chat'>('readers');
  const [drawer, setDrawer] = useState(false);
  const [unread, setUnread] = useState(0);
  const [chatText, setChatText] = useState('');
  const [locked, setLocked] = useState(false);
  const [sound, setSound] = useState(false);
  const [soundPop, setSoundPop] = useState(false);
  const [channels, setChannels] = useState<Record<SoundChannel, boolean>>({ music: true, fire: true, rain: false, pages: true });
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  const [goal, setGoal] = useState(0);
  const [headerH, setHeaderH] = useState(0);
  const goalWas = useRef<number | null>(null);
  const chatList = useRef<HTMLDivElement>(null);
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);
  const [coach, setCoach] = useState<CoachId[] | null>(null);
  const coachRef = useRef<HTMLDivElement>(null);
  const coachSaved = useRef(coachSeen());

  const say = useCallback((text: string, action?: { label: string; run: () => void }) => {
    setToast({ text, action });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.action ? 6500 : 3200);
    return () => clearTimeout(id);
  }, [toast]);

  /* ---------- the room from the server ---------- */
  // My sitting gone without «Закончить» from this page (finished on another device, or the room stood me up after hours
  // without a word from me) is shown here as finished, with what it saved.
  const held = useRef<string | null>(null);
  const onTodayRef = useRef(onToday);
  onTodayRef.current = onToday;
  const settle = useCallback(async (sessionId: string) => {
    const { data } = await apiPost<FinishOut>(`/reading-room/sessions/${sessionId}/finish`, {}, { requireAuth: true });
    if (!data) return;
    // (an ended sitting is told as "already_ended"; under a minute it is the same «too short» as a finish here)
    setFinished({ sessionId, minutes: data.minutes, credited: data.credited, reason: data.minutes < 1 ? 'short' : data.reason, date: data.date });
    if (data.credited) onTodayRef.current?.();
  }, []);

  const load = useCallback(async () => {
    const q = since.current ? `?since=${encodeURIComponent(since.current)}` : '';
    const { data } = await apiGet<RoomState>(`/reading-room/${hall}/state${q}`, { requireAuth: true });
    if (!data) return;
    stamp.current = performance.now();
    setState(data);
    setLoaded(true);
    const gone = held.current;
    held.current = data.my_session?.id ?? null;
    if (gone && gone !== held.current) settle(gone);
    if (data.messages.length) {
      since.current = data.messages[data.messages.length - 1].created_at;
      setMessages((old) => {
        const seen = new Set(old.map((m) => m.id));
        const fresh = data.messages.filter((m) => !seen.has(m.id));
        return fresh.length ? [...old, ...fresh].slice(-120) : old;
      });
    }
  }, [hall, settle]);

  useEffect(() => {
    since.current = null;
    setMessages([]);
    load();
  }, [load]);

  // Poll often while the room is on screen, rarely otherwise.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      load();
    }, near ? 4000 : 20000);
    return () => clearInterval(id);
  }, [load, near]);

  useEffect(() => {
    if (layout !== 'scroll' || !scrollRef.current) return;
    const io = new IntersectionObserver((es) => setNear(es[0].isIntersecting), { rootMargin: '300px 0px' });
    io.observe(scrollRef.current);
    return () => io.disconnect();
  }, [layout]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  const mine = state?.my_session ?? null;
  const mineHere = mine && mine.hall === hall ? mine : null;
  // Tell the server we are still here while seated, even with the room scrolled away. A phone or iPad stops the page
  // while its screen is locked or another app is in front: back from that, check in at once and catch up with the room.
  useEffect(() => {
    if (!mine) return;
    const beat = () => apiPost(`/reading-room/sessions/${mine.id}/heartbeat`, {}, { requireAuth: true });
    const id = setInterval(beat, 25000);
    const back = () => {
      if (document.visibilityState === 'visible') beat().then(() => load());
    };
    document.addEventListener('visibilitychange', back);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', back);
    };
  }, [mine?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // While the clock runs here the screen stays on: an iPad left on the table beside a paper book would otherwise lock
  // after a few minutes and stop the page. The browser lets go of the lock whenever the page is hidden; it is taken
  // again on return, or on the next tap where Safari wants one first.
  useEffect(() => {
    if (mineHere?.status !== 'reading' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let asking = false;
    let done = false;
    const hold = () => {
      if (done || lock || asking || document.visibilityState !== 'visible') return;
      asking = true;
      navigator.wakeLock.request('screen').then(
        (l) => {
          asking = false;
          if (done) {
            l.release();
            return;
          }
          lock = l;
          l.addEventListener('release', () => {
            lock = null;
          });
        },
        () => {
          asking = false;
        },
      );
    };
    hold();
    document.addEventListener('visibilitychange', hold);
    document.addEventListener('pointerdown', hold);
    return () => {
      done = true;
      document.removeEventListener('visibilitychange', hold);
      document.removeEventListener('pointerdown', hold);
      lock?.release();
    };
  }, [mineHere?.id, mineHere?.status]);

  const since0 = (performance.now() - stamp.current) / 1000;
  const elapsed = (s: { status: string; elapsed_seconds: number }) => s.elapsed_seconds + (s.status === 'reading' ? since0 : 0);
  const readers = state?.readers ?? [];
  // «за 29 сентября»: the day minutes are written for, said outright instead of «сегодня»
  const dayLabel = useCallback((iso?: string | null) => {
    if (!iso) return '';
    const { d, m } = dayOf(iso);
    return `${d} ${t(`month.gen.${m}`)}`;
  }, [t]);
  const readingDay = dayLabel(state?.reading_day);

  /* ---------- the day's thirty minutes ---------- */
  const todayTotal = (state?.today_minutes ?? 0) + (mine && state?.in_round ? Math.floor(elapsed(mine) / 60) : 0);
  useEffect(() => {
    if (!state) return;
    if (goalWas.current === null) {
      goalWas.current = todayTotal;
      return;
    }
    if (goalWas.current < GOAL && todayTotal >= GOAL && state.in_round) {
      setGoal(Date.now());
      Ding.play();
    }
    goalWas.current = todayTotal;
  }, [todayTotal, state]);
  useEffect(() => {
    if (!goal) return;
    const id = setTimeout(() => setGoal(0), 3600);
    return () => clearTimeout(id);
  }, [goal]);

  /* ---------- the living photo ---------- */
  useEffect(() => {
    const stage = stageRef.current, canvas = cvRef.current, fx = fxRef.current;
    if (!stage || !canvas || !fx) return;
    const small = Math.min(window.innerWidth, window.innerHeight * 1.8) * Math.min(window.devicePixelRatio || 1, 2) < 1900;
    const engine = createRoomEngine({
      hall: hk, base: BASE, canvas, fx, stage,
      frame: frameRef.current, edge: edgeRef.current, teaser: teaserRef.current, ui: uiRef.current, tags: tagsRef.current,
      scrollEl: layout === 'scroll' ? scrollRef.current : null,
      variant: document.documentElement.dataset.theme === 'light' ? 'day' : 'night',
      small, reduced,
      band: phone ? () => openBand(stage) : null,
      onFlip: (key) => {
        const el = tagEls.current.get(key);
        if (el) {
          el.classList.remove(styles.flip);
          void el.offsetWidth;
          el.classList.add(styles.flip);
        }
        Snd.page(key === mineKey.current ? 1 : 0.55);
      },
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [hk, layout, reduced, phone]);

  useEffect(() => {
    engineRef.current?.setVariant(theme === 'light' ? 'day' : 'night');
  }, [theme]);

  const mineKey = useRef<string | null>(null);
  mineKey.current = mineHere?.id ?? null;
  useEffect(() => {
    engineRef.current?.setOccupants(readers.map((r) => ({
      key: r.session_id, seat: r.seat, char: charFor(hk, r.seat, r.gender), status: r.status,
      gender: r.gender === 'male' ? 'm' : 'f',
    })));
  }, [readers, hk]);

  useEffect(() => {
    const measure = () => setHeaderH(document.querySelector('header')?.getBoundingClientRect().height ?? 0);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [layout]);

  /* ---------- lock in: the page stops scrolling and the hall fills the screen ---------- */
  const revealEnd = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rc = el.getBoundingClientRect();
    return window.scrollY + rc.top + (reduced ? 0 : (rc.height - window.innerHeight) * 0.8);
  }, [reduced]);
  useEffect(() => {
    if (!locked) return;
    const root = document.documentElement;
    root.classList.add(styles.lockedRoot);
    if (layout === 'scroll') window.scrollTo({ top: revealEnd(), behavior: 'instant' as ScrollBehavior });
    // Safari on iPhone scrolls the page by touch whatever overflow says: hold it still here,
    // except inside the hall's own lists (the chat, the readers), which still scroll.
    const hold = (e: TouchEvent) => {
      for (let el = e.target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return;
      }
      e.preventDefault();
    };
    document.addEventListener('touchmove', hold, { passive: false });
    return () => {
      root.classList.remove(styles.lockedRoot);
      document.removeEventListener('touchmove', hold);
    };
  }, [locked, layout, revealEnd]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (soundPop) setSoundPop(false);
      else if (drawer) setDrawer(false);
      else if (locked) setLocked(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [soundPop, drawer, locked]);

  /* ---------- first-visit hints ---------- */
  const endCoach = useCallback(() => {
    coachSaved.current = true;
    try {
      localStorage.setItem(COACH_KEY, '1');
    } catch {
      // storage blocked: the hints may come back next time
    }
    setCoach(null);
  }, []);
  const coachDone = useCallback((id: CoachId) => {
    setCoach((c) => (c ? c.filter((x) => x !== id) : c));
  }, []);
  useEffect(() => {
    if (coach && !coach.length) endCoach();
  }, [coach, endCoach]);
  // they appear once the hall is fully open, on the first visit only
  useEffect(() => {
    if (coach || coachSaved.current || !loaded) return;
    // on a phone Lock in sits right above the sound button: one arrow there would cover the other
    if ((engineRef.current?.progress ?? 0) > 0.97) setCoach(COACH.map((c) => c.id).filter((id) => id !== 'lock' || (layout === 'scroll' && !phone)));
  }, [tick, loaded, coach, layout, phone]);
  // each arrow follows what it points at (name tags ride on the photo), its label kept on the screen
  useEffect(() => {
    if (!coach) return;
    let raf = 0;
    const place = () => {
      raf = requestAnimationFrame(place);
      const box = coachRef.current, stage = stageRef.current;
      if (!box || !stage) return;
      const fr = box.getBoundingClientRect();
      const placed: { l: number; r: number; t: number; b: number }[] = [];
      for (const el of box.querySelectorAll<HTMLElement>('[data-hint]')) {
        const id = el.dataset.hint;
        const target = id === 'reader'
          ? stage.querySelector<HTMLElement>('[data-coach-tag]:not([data-off="1"])')
          : stage.querySelector<HTMLElement>(`[data-coach="${id}"]`);
        const rc = target?.getBoundingClientRect();
        if (!rc || !rc.width) {
          el.style.visibility = 'hidden';
          continue;
        }
        const above = el.dataset.dir === 'above';
        const x = rc.left + rc.width / 2 - fr.left;
        let y = above ? rc.top - fr.top - 4 : rc.bottom - fr.top + 4;
        const lab = el.firstElementChild as HTMLElement | null;
        const lw = lab?.offsetWidth ?? 0, lh = lab?.offsetHeight ?? 0, hh = el.offsetHeight;
        const lx = Math.min(Math.max(x, lw / 2 + 8), fr.width - lw / 2 - 8) - x;
        // two labels side by side (the chips and the sound button in one row) must not run into each other:
        // the later one steps further away from its button
        const box2 = (yy: number) => {
          const t = above ? yy - hh : yy + hh - lh;
          return { l: x + lx - lw / 2 - 4, r: x + lx + lw / 2 + 4, t, b: t + lh };
        };
        for (let k = 0; k < 3 && placed.some((q) => { const m = box2(y); return m.l < q.r && m.r > q.l && m.t < q.b && m.b > q.t; }); k++) y += above ? -(lh + 6) : lh + 6;
        placed.push(box2(y));
        el.style.left = `${x.toFixed(1)}px`;
        el.style.top = `${y.toFixed(1)}px`;
        el.style.setProperty('--lx', `${lx.toFixed(1)}px`);
        el.style.visibility = 'visible';
      }
      // on a phone the bar rests just above the dock, or at the foot between the front chairs while there is none at the foot
      const bar = box.querySelector<HTMLElement>('[data-bar]');
      if (bar && phone) {
        const dock = stage.querySelector<HTMLElement>('[data-dock="bottom"]');
        bar.dataset.free = dock ? '' : '1';
        bar.style.top = dock ? `${dock.getBoundingClientRect().top - bar.offsetHeight - 10 - fr.top}px` : '';
      }
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [coach, phone]);
  useEffect(() => {
    if (locked) coachDone('lock');
  }, [locked, coachDone]);
  useEffect(() => {
    if (drawer) coachDone('chat');
  }, [drawer, coachDone]);

  /* ---------- chat ---------- */
  const lastSeenMsg = useRef<string | null>(null);
  const eventCount = state?.day?.events.length ?? 0;
  useEffect(() => {
    const open = tab === 'chat' && drawer;
    // the newest line in view, whether a message or someone sitting down
    if (open) chatList.current?.scrollTo({ top: chatList.current.scrollHeight });
    const last = messages[messages.length - 1];
    if (!last) return;
    if (open) {
      setUnread(0);
      lastSeenMsg.current = last.id;
    } else if (lastSeenMsg.current !== last.id) {
      const idx = messages.findIndex((m) => m.id === lastSeenMsg.current);
      setUnread(messages.slice(idx + 1).filter((m) => !m.me).length);
    }
  }, [messages, tab, drawer, eventCount]);

  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatText.trim();
    if (!text) return;
    setChatText('');
    const { data, error } = await apiPost<Message>(`/reading-room/${hall}/messages`, { text }, { requireAuth: true });
    if (data) {
      since.current = data.created_at;
      setMessages((old) => [...old, data].slice(-120));
    } else if (error) {
      setChatText(text);
      say(error === 'Too fast' ? t('room.chatTooFast') : t('room.error'));
    }
  };

  /* ---------- my sitting ---------- */
  const openPick = (seat: number | null) => {
    coachDone('sit');
    setFinished(null);
    setPick({ seat });
    if (!book && suggest[0]) setBook(suggest[0]);
    apiGet<{ books: { title: string; status: string }[] }>('/library/bookcase', { requireAuth: true }).then(({ data }) => {
      const reading = (data?.books ?? []).filter((b) => b.status === 'reading').map((b) => b.title);
      if (!reading.length) return;
      setSuggest((old) => [...new Set([...old, ...reading])].slice(0, 5));
      // the title is typed only the first time: a book on the shelf as «читаю» is already the answer
      setBook((b) => b || reading[0]);
    });
  };

  const sit = async () => {
    const title = book.trim();
    if (!title || busy) return;
    const taken = new Set(readers.map((r) => r.seat));
    let seat = pick?.seat ?? null;
    if (seat === null || taken.has(seat)) {
      // no chair chosen: the first free one where the reader will be seen
      seat = H.seats.map((_, i) => i).find((i) => !taken.has(i) && canSit(i)) ?? null;
    }
    if (seat === null) {
      say(t('room.fullSeen'));
      return;
    }
    setBusy(true);
    Ding.prime();
    // a sitting in the other hall ends as I sit down here: nothing to tell about it
    held.current = null;
    const { data, error } = await apiPost<MySession>(`/reading-room/${hall}/sit`, { seat, book: title }, { requireAuth: true });
    setBusy(false);
    if (data) track('room_sit', { hall });
    if (!data) {
      say(error === 'Chair is taken' ? t('room.chairTaken') : t('room.error'));
      load();
      return;
    }
    saveRecent(title);
    setSuggest(readRecent());
    setPick(null);
    await load();
    if (!Snd.enabled) say(t('room.soundHint'));
  };

  const act = async (what: 'pause' | 'resume') => {
    if (!mine) return;
    await apiPost(`/reading-room/sessions/${mine.id}/${what}`, {}, { requireAuth: true });
    load();
  };

  const answerAway = async (count: boolean) => {
    if (!mine || busy) return;
    setBusy(true);
    await apiPost(`/reading-room/sessions/${mine.id}/away`, { count }, { requireAuth: true });
    setBusy(false);
    load();
  };

  // After 03:00 the reading can still be last night's: the reader says which day before the minutes are written.
  const askFirst = !!mine && !!state?.in_round && (mine.days?.length ?? 0) === 2 && elapsed(mine) >= 60;
  useEffect(() => {
    if (!mine) setAskDay(false);
  }, [mine]);
  const finish = async (day?: string) => {
    if (!mine || busy) return;
    if (!day && askFirst) {
      setAskDay(true);
      return;
    }
    setBusy(true);
    setAskDay(false);
    held.current = null;
    const { data } = await apiPost<FinishOut>(`/reading-room/sessions/${mine.id}/finish`, day ? { day } : {}, { requireAuth: true });
    setBusy(false);
    if (data) {
      const f = { sessionId: mine.id, minutes: data.minutes, credited: data.credited, reason: data.reason, date: data.date };
      setFinished(f);
      if (data.credited) {
        say(t('room.savedToday', { min: data.minutes, date: dayLabel(data.date) }), { label: t('room.undo'), run: () => undo(f) });
        onToday?.();
      } else if (data.reason === 'short') say(t('room.tooShort'));
    }
    load();
  };

  const undo = async (f: Finished) => {
    const { data } = await apiPost(`/reading-room/sessions/${f.sessionId}/undo`, {}, { requireAuth: true });
    if (data) {
      setFinished(null);
      say(t('room.undone'));
      onToday?.();
    }
    load();
  };

  /* ---------- sound ---------- */
  const toggleSound = () => {
    coachDone('sound');
    if (!Snd.enabled) {
      Snd.enable();
      setSound(true);
      setSoundPop(true);
    } else setSoundPop((v) => !v);
  };
  const soundOff = () => {
    Snd.disable();
    setSound(false);
    setSoundPop(false);
  };

  /* ---------- seats ---------- */
  const taken = new Set(readers.map((r) => r.seat));
  // A reader sits only where the photo can show them, so they are always seen in it: in a hall with both casts (the
  // round's, wide and portrait) any chair with a character, elsewhere one whose character is of their gender.
  // Chairs that would show just a name tag are not offered.
  function canSit(i: number) {
    const sc = seatChar(hk, i);
    return !!sc && !!myG && (!!H.casts || sc.g === myG);
  }
  const freeSeen = H.seats.filter((_, i) => !taken.has(i) && canSit(i)).length;
  const showRings = !!state?.can_sit && !mine && !finished;
  const reading = readers.filter((r) => r.status === 'reading').length;
  const totalMinutes = readers.reduce((s, r) => s + Math.floor(elapsed(r) / 60), 0);
  const noAccess = hall === 'round' && state && !state.can_sit;
  const noRound = hall === 'round' && state && !state.round;

  const hallTitle = t(hall === 'round' ? 'room.titleRound' : 'room.titleLibrary');
  const access = hall === 'round'
    ? (state?.round ? t('room.accessRound', { month: t(`month.${state.round.month}`), year: state.round.year }) : t('room.noRound'))
    : t('room.accessLibrary');
  const chatLabel = t(hall === 'round' ? 'room.chatRound' : 'room.chatLibrary');

  // Under the round the stage sticks to the top of the window, beneath the site's sticky header; the library's hall
  // starts below the header and fills the rest of the window.
  const stageStyle = { '--room-top': layout === 'scroll' ? `${headerH}px` : '0px' } as CSSProperties;
  const fullStyle = { height: `calc(100svh - ${headerH}px)` } as CSSProperties;

  const tags = readers.map((r) => {
    const ch = charFor(hk, r.seat, r.gender);
    // a chair this photo does not have (the library's portrait-only chairs, seen on a wide screen) gets no tag
    const chair = H.seats[r.seat];
    if (!ch && (!chair || chair[0] < 0)) return null;
    const at = ch ? H.chars[ch].head : ([chair[0], chair[1] - 0.03] as [number, number]);
    return (
      <button
        key={r.session_id}
        type="button"
        ref={(el) => {
          if (el) tagEls.current.set(r.session_id, el);
          else tagEls.current.delete(r.session_id);
        }}
        className={`${styles.tag} ${r.me ? styles.tagMe : ''} ${r.status === 'paused' ? styles.tagPaused : ''}`}
        data-u={at[0]}
        data-v={at[1]}
        data-tf=" translate(-50%,-100%) translateY(-8px)"
        data-clamp="1"
        data-stack="1"
        data-coach-tag={r.me ? undefined : '1'}
        onClick={() => { coachDone('reader'); navigate(`/readers/${r.user_id}`); }}
      >
        <BookIcon />
        {/* who, for how long, and under it the book they are reading right now */}
        <span className={styles.tagText}>
          <span className={styles.tagRow}>
            <span>{r.me ? t('room.you') : r.display_name}</span>
            <b>{r.status === 'paused' ? t('room.paused') : clock(elapsed(r))}</b>
          </span>
          <i className={styles.tagBook} title={r.book}>{r.book}</i>
        </span>
      </button>
    );
  });

  const rings = showRings
    ? H.seats.map((s, i) => {
        if (taken.has(i) || !canSit(i)) return null;
        const sc = seatChar(hk, i)!;
        const at = sc.ring ?? sc.head ?? ([s[0], s[1]] as [number, number]);
        const chosen = pick?.seat === i;
        return (
          <button
            key={`free-${i}`}
            type="button"
            className={`${styles.free} ${styles.freeOwn} ${chosen ? styles.freeChosen : ''} ${pick ? styles.freePicking : ''}`}
            data-u={at[0]}
            data-v={at[1]}
            data-label="1"
            data-clamp="1"
            aria-label={t('room.sitSeen')}
            onClick={() => openPick(i)}
          >
            <span>{t('room.sitSeen')}</span>
          </button>
        );
      })
    : null;

  const readersList = (
    <ul className={styles.readers}>
      {[...readers].sort((a, b) => Number(b.me) - Number(a.me) || Number(a.status === 'paused') - Number(b.status === 'paused') || elapsed(b) - elapsed(a)).map((r) => (
        <li key={r.session_id}>
          <button type="button" className={`${styles.rd} ${r.status === 'paused' ? styles.rdPaused : ''}`} onClick={() => navigate(`/readers/${r.user_id}`)}>
            <span className={styles.av} style={{ '--c': colorFromSeed(r.user_id) } as CSSProperties}>{(r.display_name || '?')[0]}</span>
            <span className={styles.rdMain}>
              <span className={styles.rdName}>
                {r.me ? t('room.you') : r.display_name} <small>@{r.username}</small>
                {r.status === 'paused' && <span className={styles.chip}>{t('room.paused')}</span>}
                {!r.in_round && <span className={styles.chip}>{t('room.guest')}</span>}
              </span>
              <span className={styles.rdBook}><i className={styles.spine} />{r.book}</span>
            </span>
            <span className={styles.rdTime}>
              <b>{clock(elapsed(r))}</b>
              {r.in_round && <small>{t('room.todayMin', { min: r.today_minutes, date: readingDay })}</small>}
            </span>
          </button>
        </li>
      ))}
      {!readers.length && <li className={styles.empty}>{t('room.nobody')}</li>}
    </ul>
  );

  // the chat's messages and the day's comings and goings, in one line of time
  const day = state?.day ?? null;
  const timeline = [
    ...messages.map((m) => ({ at: Date.parse(m.created_at), msg: m, ev: null as RoomEvent | null })),
    ...(day?.events ?? []).map((e) => ({ at: Date.parse(e.at), msg: null as Message | null, ev: e })),
  ].sort((a, b) => a.at - b.at);
  const evText = (e: RoomEvent) => {
    const g = e.gender === 'male' ? 'm' : e.gender === 'female' ? 'f' : 'u';
    return e.kind === 'sit'
      ? t(`room.ev.sit.${g}`, { name: e.display_name, book: e.book })
      : t(`room.ev.finish.${g}`, { name: e.display_name, min: e.minutes ?? 0 });
  };

  const chat = (
    <>
      <div className={styles.chatList} ref={chatList} role="log" aria-live="polite">
        {day && day.readers > 0 && (
          <div className={styles.daySum}>
            {t('room.daySummary', {
              date: dayLabel(day.date),
              names: day.readers > day.names.length ? t('room.andMore', { names: day.names.join(', '), n: day.readers - day.names.length }) : day.names.join(', '),
              min: day.minutes,
            })}
          </div>
        )}
        {timeline.map(({ ev, msg }) => ev ? (
          <div key={`${ev.kind}-${ev.user_id}-${ev.at}`} className={styles.ev}>
            <time>{hhmm(ev.at)}</time>
            {evText(ev)}
          </div>
        ) : msg && (
          <div key={msg.id} className={`${styles.msg} ${msg.me ? styles.msgMine : ''}`}>
            {!msg.me && (
              <button type="button" className={styles.who} style={{ '--c': colorFromSeed(msg.user_id) } as CSSProperties} onClick={() => navigate(`/readers/${msg.user_id}`)}>
                {msg.display_name}
              </button>
            )}
            {msg.text}
            <time>{hhmm(msg.created_at)}</time>
          </div>
        ))}
        {!timeline.length && <div className={styles.msgSys}>{state?.can_sit ? t('room.chatEmpty') : t('room.chatClosed')}</div>}
      </div>
      {state?.can_sit && (
        <form className={styles.chatForm} onSubmit={sendChat}>
          <input value={chatText} onChange={(e) => setChatText(e.target.value)} maxLength={300} autoComplete="off" placeholder={t('room.chatPlaceholder')} aria-label={t('room.chatPlaceholder')} />
          <button className={styles.btn} type="submit">{t('room.send')}</button>
        </form>
      )}
    </>
  );

  const chips = (
    <>
      <button className={styles.ctrlBtn} type="button" aria-pressed={drawer && tab === 'readers'} onClick={() => { setTab('readers'); setDrawer((d) => !(d && tab === 'readers')); }}>
        {t('room.readers')} <span className={styles.cnt}>{readers.length}</span>
      </button>
      <button className={styles.ctrlBtn} type="button" data-coach="chat" aria-pressed={drawer && tab === 'chat'} onClick={() => { setTab('chat'); setDrawer((d) => !(d && tab === 'chat')); }}>
        {chatLabel} {unread > 0 && <span className={styles.unread}>{unread}</span>}
      </button>
    </>
  );

  const lamp = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" /></svg>
  );
  // On a phone the foot of the photo is the front row of chairs, so nothing waits there while nobody is seated:
  // «Занять место» rides in the heading, and it, or a tap on a chair's ring, turns the heading into the book picker
  // (every chair stays open below it, for changing one's mind). The clock, once running, is one slim row at the foot.
  let takeSeat = false;
  let picking = false;
  let dockLook = '';
  let dock;
  if (noRound) {
    dock = <span className={styles.dockNote}>{t('room.noRound')}</span>;
  } else if (noAccess) {
    dock = <span className={styles.dockNote}>{t('room.onlyCircle')}</span>;
  } else if (!mine && !finished && !myG) {
    // without a gender there is no character to seat
    dock = (
      <>
        <span className={styles.dockNote}>{t('room.needGender')}</span>
        <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => navigate('/profile')}>{t('room.toProfile')}</button>
      </>
    );
  } else if (!mine && !finished && !pick && freeSeen === 0) {
    dock = <span className={styles.dockNote}>{t('room.fullSeen')}</span>;
  } else if (mine && askDay && mine.days?.length === 2) {
    const [last, today] = mine.days;
    dock = (
      <>
        <span className={`${styles.dockNote} ${styles.dockAsk}`}>{t('room.whichDay', { min: Math.floor(elapsed(mine) / 60) })}</span>
        <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => finish(last)} disabled={busy}>{t('room.dayYesterday', { date: dayLabel(last) })}</button>
        <button className={styles.btn} type="button" onClick={() => finish(today)} disabled={busy}>{t('room.dayToday', { date: dayLabel(today) })}</button>
        <button className={`${styles.btn} ${styles.link}`} type="button" onClick={() => setAskDay(false)}>{t('room.cancel')}</button>
      </>
    );
  } else if (mine && !mineHere) {
    dock = (
      <>
        <span className={styles.dockNote}>{t('room.elsewhere', { hall: t(mine.hall === 'round' ? 'room.titleRound' : 'room.titleLibrary') })}</span>
        <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => finish()} disabled={busy}>{t('room.finish')}</button>
      </>
    );
  } else if (mineHere && mineHere.away_seconds > 0) {
    // back from a dark screen or another app: only the reader knows whether they read through it
    dock = (
      <>
        <span className={styles.dockNote}>{t('room.awayAsk', { min: Math.max(1, Math.round(mineHere.away_seconds / 60)) })}</span>
        <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => answerAway(true)} disabled={busy}>{t('room.awayYes')}</button>
        <button className={styles.btn} type="button" onClick={() => answerAway(false)} disabled={busy}>{t('room.awayNo')}</button>
      </>
    );
  } else if (mineHere) {
    dockLook = styles.dockSeated;
    dock = (
      <>
        <span className={styles.clock} aria-label={t('room.timer')}>{clock(elapsed(mineHere))}</span>
        <span className={styles.dockBook}>
          <i>{mineHere.book}</i>
          {state?.in_round && <small>{t('room.todayPlus', { today: state.today_minutes, min: Math.floor(elapsed(mineHere) / 60), date: readingDay })}</small>}
        </span>
        {mineHere.status === 'reading'
          ? <button className={styles.btn} type="button" onClick={() => act('pause')}>{t('room.pause')}</button>
          : <button className={styles.btn} type="button" onClick={() => act('resume')}>{t('room.resume')}</button>}
        <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => finish()} disabled={busy}>{t('room.finish')}</button>
      </>
    );
  } else if (pick) {
    picking = true;
    dock = (
      <div className={styles.dockPick}>
        <div className={styles.pickHead}>
          <span className={styles.dockLbl}>{t('room.whatBook')} · {pick.seat !== null ? t('room.seatChosen') : t('room.seatAuto')}</span>
          <button className={`${styles.btn} ${styles.link}`} type="button" onClick={() => setPick(null)}>{t('room.cancel')}</button>
        </div>
        {suggest.length > 0 && (
          <div className={styles.choices}>
            {suggest.map((b) => (
              <button key={b} type="button" className={styles.choice} aria-pressed={book === b} onClick={() => setBook(b)}>
                <i className={styles.spine} /><span>{b}</span>
              </button>
            ))}
          </div>
        )}
        <div className={styles.pickRow}>
          <input value={book} onChange={(e) => setBook(e.target.value)} maxLength={200} placeholder={t('room.bookPlaceholder')} aria-label={t('room.bookPlaceholder')} onKeyDown={(e) => { if (e.key === 'Enter') sit(); }} />
          <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={sit} disabled={busy || !book.trim()}>{t('room.light')}</button>
        </div>
      </div>
    );
  } else if (finished) {
    dock = (
      <>
        <span className={styles.done}>
          {finished.credited ? t('room.savedToday', { min: finished.minutes, date: dayLabel(finished.date) }) : finished.reason === 'short' ? t('room.tooShort') : finished.reason === 'not_in_round' ? t('room.readForGuest', { min: finished.minutes }) : t('room.readFor', { min: finished.minutes })}
        </span>
        {finished.credited && <button className={`${styles.btn} ${styles.link}`} type="button" onClick={() => undo(finished)}>{t('room.undo')}</button>}
        {finished.credited && finished.date && (
          <button className={styles.btn} type="button" onClick={() => setShareDay(finished.date)}>{t('shareDay.short')}</button>
        )}
        <button className={styles.btn} type="button" onClick={() => openPick(null)}>{t('room.readMore')}</button>
      </>
    );
  } else {
    takeSeat = true;
    dock = phone ? null : (
      <>
        <button className={`${styles.btn} ${styles.primary}`} type="button" data-coach="sit" onClick={() => openPick(null)}>
          {lamp}
          {t('room.sitDown')}
        </button>
        <span className={`${styles.dockNote} ${styles.dockHint}`}>{state?.in_round ? t('room.dockNote', { date: readingDay }) : t('room.dockNoteGuest')}</span>
      </>
    );
  }

  const stage = (
    <div className={`${styles.stage} ${locked ? styles.isLocked : ''}`} ref={stageRef} style={stageStyle}>
      {layout === 'scroll' && <div className={styles.frameEdge} ref={edgeRef} />}
      <div className={styles.frame} ref={frameRef}>
        <canvas className={styles.cv} ref={cvRef} aria-label={hallTitle} />
        <canvas className={styles.fx} ref={fxRef} aria-hidden="true" />
        <div className={styles.lockRing} />
        {!loaded && <div className={styles.loading}>{t('room.loading')}</div>}
        <div className={styles.tags} ref={tagsRef}>
          {/* the free chairs' rings over the name tags: a neighbour's tag never hides a chair one could take */}
          {tags}
          {rings}
        </div>
        {layout === 'scroll' && (
          <div className={styles.teaser} ref={teaserRef}>
            <div className={styles.teaserK}>{hallTitle}</div>
            <div className={styles.teaserT}>{readers.length ? t('room.readingNow', { n: readers.length }) : t('room.quietNow')}</div>
            <div className={styles.teaserH}><span className={styles.chev} aria-hidden="true"><i /><i /><i /></span>{t('room.scrollIn')}</div>
          </div>
        )}
        <div className={styles.ui} ref={uiRef} data-live={layout === 'full' ? '1' : '0'}>
          <div className={`${styles.head} ${phone && picking ? styles.headAway : ''}`} data-head="">
            <div className={styles.kicker}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
              <span>{access}</span>
            </div>
            <h2 className={styles.title}>{hallTitle}</h2>
            <div className={styles.meta}>
              <span className={styles.live}><i className={styles.liveDot} />{mineHere ? (readers.length > 1 ? t('room.youPlus', { n: readers.length - 1 }) : t('room.youAlone')) : t('room.readingCount', { n: reading })}</span>
              {totalMinutes > 0 && <span>{t('room.together', { min: totalMinutes })}</span>}
              {phone && takeSeat && (
                <button className={`${styles.btn} ${styles.primary} ${styles.takeSeat}`} type="button" data-coach="sit" onClick={() => openPick(null)}>
                  {lamp}
                  {t('room.takeSeat')}
                </button>
              )}
            </div>
            <div className={styles.ctrl}>
              {layout === 'scroll' && (
                <button className={styles.ctrlBtn} type="button" data-coach="lock" aria-pressed={locked} onClick={() => setLocked((v) => !v)} title={t('room.lockTitle')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d={locked ? 'M8 11V8a4 4 0 0 1 8 0v3' : 'M8 11V8a4 4 0 0 1 8 0'} /></svg>
                  {locked ? <>Locked in {!phone && <kbd>Esc</kbd>}</> : 'Lock in'}
                </button>
              )}
              {phone && chips}
              <div className={styles.snd}>
                <button className={`${styles.ctrlBtn} ${sound ? styles.sndOn : ''}`} type="button" data-coach="sound" aria-expanded={soundPop} onClick={toggleSound}>
                  <span className={styles.bars} aria-hidden="true"><i /><i /><i /></span>
                  {sound ? t('room.soundOn') : t('room.sound')}
                </button>
                {soundPop && (
                  <div className={styles.sndPop}>
                    {SOUND_CHANNELS.map((ch) => (
                      <div key={ch} className={styles.sndRow}>
                        <label>{t(`room.snd.${ch}`)}</label>
                        <button type="button" className={styles.tgl} aria-pressed={channels[ch]} aria-label={t(`room.snd.${ch}`)}
                          onClick={() => { const v = !channels[ch]; setChannels((c) => ({ ...c, [ch]: v })); Snd.set(ch, v); }} />
                        <input type="range" min="0" max="1" step=".01" defaultValue={ch === 'music' ? 0.55 : ch === 'fire' ? 0.5 : ch === 'rain' ? 0.45 : 0.7}
                          aria-label={t(`room.snd.${ch}`)} onChange={(e) => Snd.vol(ch, parseFloat(e.target.value))} />
                      </div>
                    ))}
                    <button className={styles.btn} type="button" onClick={soundOff}>{t('room.soundOff')}</button>
                    <div className={styles.sndNote}>{t('room.soundNote')}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
          {!phone && <div className={styles.chips}>{chips}</div>}
          <aside className={`${styles.drawer} ${drawer ? styles.drawerOpen : ''}`} aria-label={t('room.readers')}>
            <div className={styles.tabs} role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'readers'} onClick={() => setTab('readers')}>{t('room.readers')} <span className={styles.cnt}>{readers.length}</span></button>
              <button type="button" role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>{chatLabel} {unread > 0 && <span className={styles.unread}>{unread}</span>}</button>
              <button type="button" className={styles.drawerX} onClick={() => setDrawer(false)} aria-label={t('room.close')}>×</button>
            </div>
            <div className={`${styles.tabBody} ${tab === 'chat' ? styles.tabChat : ''}`} role="tabpanel">
              {tab === 'readers' ? (
                <>
                  {readersList}
                  <div className={styles.rdFoot}>{hall === 'round' ? t('room.footRound') : t('room.footLibrary')}</div>
                </>
              ) : chat}
            </div>
          </aside>
          {dock && (
            <div
              className={`${styles.dock} ${dockLook} ${phone && picking ? styles.dockTop : ''} ${mineHere?.status === 'paused' ? styles.dockPaused : ''}`}
              data-dock={phone && picking ? 'top' : 'bottom'}
            >
              {dock}
            </div>
          )}
          {coach && (
            <div className={styles.coach} ref={coachRef}>
              {/* on a phone the book picker stands where the hints point (the heading, the top chairs' name tags): they wait */}
              {!(phone && picking) && COACH.filter((c) => coach.includes(c.id)).map((c, i) => (
                <div key={c.id} className={styles.hint} data-hint={c.id} data-dir={c.id === 'sit' && phone ? 'below' : c.dir} style={{ animationDelay: `${i * 0.22}s`, visibility: 'hidden' }} aria-hidden="true">
                  <span className={styles.hintL}>{t(`room.coach.${c.id}`)}</span>
                  <svg className={styles.hintAr} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v15M6 13l6 6 6-6" /></svg>
                </div>
              ))}
              {!locked && (
                <div className={styles.coachBar} data-bar="1">
                  {layout === 'scroll' && !phone && (
                    <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 20V5M6 11l6-6 6 6" /></svg>
                      {t('room.coach.up')}
                    </button>
                  )}
                  <button type="button" onClick={endCoach}>{t('room.coach.ok')}</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {layout === 'scroll' ? (
        <section className={styles.scroll} ref={scrollRef} aria-label={hallTitle}>{stage}</section>
      ) : (
        <section className={styles.full} style={fullStyle} aria-label={hallTitle}>{stage}</section>
      )}
      {toast && (
        <div className={styles.toast} role="status">
          <span>{toast.text}</span>
          {toast.action && <button type="button" onClick={() => { toast.action!.run(); setToast(null); }}>{toast.action.label}</button>}
        </div>
      )}
      {shareDay && <ShareDay day={shareDay} onClose={() => setShareDay(null)} />}
      {goal > 0 && (
        <div className={styles.goal} role="status" key={goal}>
          <div className={styles.goalIn}>
            <svg viewBox="0 0 110 110" aria-hidden="true"><circle className={styles.gRing} cx="55" cy="55" r="48" /><path className={styles.gTick} d="M33 57l15 15 29-32" /></svg>
            <div className={styles.goalT}>{t('room.goalTitle', { min: GOAL })}</div>
            <div className={styles.goalS}>{t('room.goalSub', { date: readingDay })}</div>
          </div>
          {Array.from({ length: 16 }, (_, i) => (
            <i key={i} style={{ '--x': `${Math.round((Math.random() * 2 - 1) * 90)}px`, '--y': `${Math.round(-90 - Math.random() * 120)}px`, '--z': `${Math.round(10 + Math.random() * 22)}px`, '--d': `${(1.9 + Math.random() * 0.5).toFixed(2)}s` } as CSSProperties} />
          ))}
        </div>
      )}
    </>
  );
}
