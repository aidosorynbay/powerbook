import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, colorFromSeed, useAuth, useI18n, useResolvedTheme } from '@/shared/lib';
import { HALLS, charFor, createRoomEngine, seatChar, type HallKey, type RoomEngine } from './engine';
import { Ding, Snd, type SoundChannel } from './sound';
import styles from './ReadingRoom.module.css';

/**
 * The reading room: the founder's render of a reading hall, alive, with the readers who are reading right now sitting in
 * its chairs. "round" is the current circle's hall (only its participants sit there, and their minutes go into «Сегодня»),
 * "library" is open to everyone. In the "scroll" layout the hall unfolds as the page scrolls into it (under the round
 * page); in "full" it fills its own page (the library's hall).
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
type MySession = { id: string; hall: HallName; seat: number; book: string; status: 'reading' | 'paused'; elapsed_seconds: number };
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
};
type Finished = { sessionId: string; minutes: number; credited: boolean; reason: string | null };

const HALL_KEY: Record<HallName, HallKey> = { round: 'a', library: 'b' };
const BASE = '/reading-room/';
const GOAL = 30;
const RECENT_KEY = 'pb.room.books';
const SOUND_CHANNELS: SoundChannel[] = ['music', 'fire', 'rain', 'pages'];

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (s: number) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};
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
  const hk = HALL_KEY[hall];
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
  const [, setTick] = useState(0);
  const stamp = useRef(performance.now());
  const since = useRef<string | null>(null);
  const [near, setNear] = useState(layout === 'full');

  const [pick, setPick] = useState<{ seat: number | null } | null>(null);
  const [book, setBook] = useState('');
  const [suggest, setSuggest] = useState<string[]>(readRecent);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [busy, setBusy] = useState(false);
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

  const say = useCallback((text: string, action?: { label: string; run: () => void }) => {
    setToast({ text, action });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.action ? 6500 : 3200);
    return () => clearTimeout(id);
  }, [toast]);

  /* ---------- the room from the server ---------- */
  const load = useCallback(async () => {
    const q = since.current ? `?since=${encodeURIComponent(since.current)}` : '';
    const { data } = await apiGet<RoomState>(`/reading-room/${hall}/state${q}`, { requireAuth: true });
    if (!data) return;
    stamp.current = performance.now();
    setState(data);
    setLoaded(true);
    if (data.messages.length) {
      since.current = data.messages[data.messages.length - 1].created_at;
      setMessages((old) => {
        const seen = new Set(old.map((m) => m.id));
        const fresh = data.messages.filter((m) => !seen.has(m.id));
        return fresh.length ? [...old, ...fresh].slice(-120) : old;
      });
    }
  }, [hall]);

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
  // Tell the server we are still here while seated, even with the room scrolled away.
  useEffect(() => {
    if (!mine) return;
    const id = setInterval(() => {
      apiPost(`/reading-room/sessions/${mine.id}/heartbeat`, {}, { requireAuth: true });
    }, 25000);
    return () => clearInterval(id);
  }, [mine?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const since0 = (performance.now() - stamp.current) / 1000;
  const elapsed = (s: { status: string; elapsed_seconds: number }) => s.elapsed_seconds + (s.status === 'reading' ? since0 : 0);
  const readers = state?.readers ?? [];

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
      small, reduced, phoneShare: 0.62,
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
  }, [hk, layout, reduced]);

  useEffect(() => {
    engineRef.current?.setVariant(theme === 'light' ? 'day' : 'night');
  }, [theme]);

  const mineKey = useRef<string | null>(null);
  mineKey.current = mineHere?.id ?? null;
  useEffect(() => {
    engineRef.current?.setOccupants(readers.map((r) => ({
      key: r.session_id, seat: r.seat, char: charFor(hk, r.seat, r.gender), status: r.status,
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
    if (layout !== 'scroll') return;
    document.documentElement.classList.toggle(styles.lockedRoot, locked);
    if (locked) window.scrollTo({ top: revealEnd(), behavior: 'instant' as ScrollBehavior });
    return () => document.documentElement.classList.remove(styles.lockedRoot);
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

  /* ---------- chat ---------- */
  const lastSeenMsg = useRef<string | null>(null);
  useEffect(() => {
    const open = tab === 'chat' && (drawer || window.innerWidth < 760);
    const last = messages[messages.length - 1];
    if (!last) return;
    if (open) {
      setUnread(0);
      lastSeenMsg.current = last.id;
      chatList.current?.scrollTo({ top: chatList.current.scrollHeight });
    } else if (lastSeenMsg.current !== last.id) {
      const idx = messages.findIndex((m) => m.id === lastSeenMsg.current);
      setUnread(messages.slice(idx + 1).filter((m) => !m.me).length);
    }
  }, [messages, tab, drawer]);

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
    setFinished(null);
    setPick({ seat });
    if (!book && suggest[0]) setBook(suggest[0]);
    apiGet<{ books: { title: string; status: string }[] }>('/library/bookcase', { requireAuth: true }).then(({ data }) => {
      const reading = (data?.books ?? []).filter((b) => b.status === 'reading').map((b) => b.title);
      if (reading.length) setSuggest((old) => [...new Set([...old, ...reading])].slice(0, 5));
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
    const { data, error } = await apiPost<MySession>(`/reading-room/${hall}/sit`, { seat, book: title }, { requireAuth: true });
    setBusy(false);
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

  const finish = async () => {
    if (!mine || busy) return;
    setBusy(true);
    const { data } = await apiPost<{ minutes: number; credited: boolean; reason: string | null; today_minutes: number }>(
      `/reading-room/sessions/${mine.id}/finish`, {}, { requireAuth: true });
    setBusy(false);
    if (data) {
      const f = { sessionId: mine.id, minutes: data.minutes, credited: data.credited, reason: data.reason };
      setFinished(f);
      if (data.credited) {
        say(t('room.savedToday', { min: data.minutes }), { label: t('room.undo'), run: () => undo(f) });
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
  // For now a reader sits only where the render has a character of their gender, so they are always seen in the photo.
  // Chairs that would show just a name tag are not offered.
  function canSit(i: number) {
    const sc = seatChar(hk, i);
    return !!sc && !!myG && sc.g === myG;
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
    const at = ch ? H.chars[ch].head : ([H.seats[r.seat][0], H.seats[r.seat][1] - 0.03] as [number, number]);
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
        onClick={() => navigate(`/readers/${r.user_id}`)}
      >
        <BookIcon />
        <span>{r.me ? t('room.you') : r.display_name}</span>
        <b>{r.status === 'paused' ? t('room.paused') : clock(elapsed(r))}</b>
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
                {hall === 'library' && !r.in_round && <span className={styles.chip}>{t('room.guest')}</span>}
              </span>
              <span className={styles.rdBook}><i className={styles.spine} />{r.book}</span>
            </span>
            <span className={styles.rdTime}>
              <b>{clock(elapsed(r))}</b>
              {r.in_round && <small>{t('room.todayMin', { min: r.today_minutes })}</small>}
            </span>
          </button>
        </li>
      ))}
      {!readers.length && <li className={styles.empty}>{t('room.nobody')}</li>}
    </ul>
  );

  const chat = (
    <>
      <div className={styles.chatList} ref={chatList} role="log" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`${styles.msg} ${m.me ? styles.msgMine : ''}`}>
            {!m.me && (
              <button type="button" className={styles.who} style={{ '--c': colorFromSeed(m.user_id) } as CSSProperties} onClick={() => navigate(`/readers/${m.user_id}`)}>
                {m.display_name}
              </button>
            )}
            {m.text}
            <time>{hhmm(m.created_at)}</time>
          </div>
        ))}
        {!messages.length && <div className={styles.msgSys}>{state?.can_sit ? t('room.chatEmpty') : t('room.chatClosed')}</div>}
      </div>
      {state?.can_sit && (
        <form className={styles.chatForm} onSubmit={sendChat}>
          <input value={chatText} onChange={(e) => setChatText(e.target.value)} maxLength={300} autoComplete="off" placeholder={t('room.chatPlaceholder')} aria-label={t('room.chatPlaceholder')} />
          <button className={styles.btn} type="submit">{t('room.send')}</button>
        </form>
      )}
    </>
  );

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
  } else if (mine && !mineHere) {
    dock = (
      <>
        <span className={styles.dockNote}>{t('room.elsewhere', { hall: t(mine.hall === 'round' ? 'room.titleRound' : 'room.titleLibrary') })}</span>
        <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={finish} disabled={busy}>{t('room.finish')}</button>
      </>
    );
  } else if (mineHere) {
    dock = (
      <>
        <span className={styles.clock} aria-label={t('room.timer')}>{clock(elapsed(mineHere))}</span>
        <span className={styles.dockBook}>
          <i>{mineHere.book}</i>
          {state?.in_round && <small>{t('room.todayPlus', { today: state.today_minutes, min: Math.floor(elapsed(mineHere) / 60) })}</small>}
        </span>
        {mineHere.status === 'reading'
          ? <button className={styles.btn} type="button" onClick={() => act('pause')}>{t('room.pause')}</button>
          : <button className={styles.btn} type="button" onClick={() => act('resume')}>{t('room.resume')}</button>}
        <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={finish} disabled={busy}>{t('room.finish')}</button>
      </>
    );
  } else if (pick) {
    dock = (
      <div className={styles.dockPick}>
        <div className={styles.dockLbl}>{t('room.whatBook')} · {pick.seat !== null ? t('room.seatChosen') : t('room.seatAuto')}</div>
        {suggest.length > 0 && (
          <div className={styles.choices}>
            {suggest.map((b) => (
              <button key={b} type="button" className={styles.choice} aria-pressed={book === b} onClick={() => setBook(b)}>
                <i className={styles.spine} />{b}
              </button>
            ))}
          </div>
        )}
        <div className={styles.pickRow}>
          <input value={book} onChange={(e) => setBook(e.target.value)} maxLength={200} placeholder={t('room.bookPlaceholder')} aria-label={t('room.bookPlaceholder')} onKeyDown={(e) => { if (e.key === 'Enter') sit(); }} />
          <button className={`${styles.btn} ${styles.link}`} type="button" onClick={() => setPick(null)}>{t('room.cancel')}</button>
          <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={sit} disabled={busy || !book.trim()}>{t('room.light')}</button>
        </div>
      </div>
    );
  } else if (finished) {
    dock = (
      <>
        <span className={styles.done}>
          {finished.credited ? t('room.savedToday', { min: finished.minutes }) : finished.reason === 'short' ? t('room.tooShort') : t('room.readFor', { min: finished.minutes })}
        </span>
        {finished.credited && <button className={`${styles.btn} ${styles.link}`} type="button" onClick={() => undo(finished)}>{t('room.undo')}</button>}
        <button className={styles.btn} type="button" onClick={() => openPick(null)}>{t('room.readMore')}</button>
      </>
    );
  } else {
    dock = (
      <>
        <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => openPick(null)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" /></svg>
          {t('room.sitDown')}
        </button>
        <span className={styles.dockNote}>{hall === 'round' || state?.in_round ? t('room.dockNote') : t('room.dockNoteGuest')}</span>
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
          {rings}
          {tags}
        </div>
        {layout === 'scroll' && (
          <div className={styles.teaser} ref={teaserRef}>
            <div className={styles.teaserK}>{hallTitle}</div>
            <div className={styles.teaserT}>{readers.length ? t('room.readingNow', { n: readers.length }) : t('room.quietNow')}</div>
            <div className={styles.teaserH}><span className={styles.chev} aria-hidden="true"><i /><i /><i /></span>{t('room.scrollIn')}</div>
          </div>
        )}
        <div className={styles.ui} ref={uiRef} data-live={layout === 'full' ? '1' : '0'}>
          <div className={styles.head}>
            <div className={styles.kicker}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
              <span>{access}</span>
            </div>
            <h2 className={styles.title}>{hallTitle}</h2>
            <div className={styles.meta}>
              <span className={styles.live}><i className={styles.liveDot} />{mineHere ? t('room.youPlus', { n: readers.length - 1 }) : t('room.readingCount', { n: reading })}</span>
              {totalMinutes > 0 && <span>{t('room.together', { min: totalMinutes })}</span>}
            </div>
            <div className={styles.ctrl}>
              {layout === 'scroll' && (
                <button className={styles.ctrlBtn} type="button" aria-pressed={locked} onClick={() => setLocked((v) => !v)} title={t('room.lockTitle')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d={locked ? 'M8 11V8a4 4 0 0 1 8 0v3' : 'M8 11V8a4 4 0 0 1 8 0'} /></svg>
                  {locked ? <>Locked in <kbd>Esc</kbd></> : 'Lock in'}
                </button>
              )}
              <div className={styles.snd}>
                <button className={`${styles.ctrlBtn} ${sound ? styles.sndOn : ''}`} type="button" aria-expanded={soundPop} onClick={toggleSound}>
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
          <div className={styles.chips}>
            <button className={styles.ctrlBtn} type="button" onClick={() => { setTab('readers'); setDrawer((d) => !(d && tab === 'readers')); }}>
              {t('room.readers')} <span className={styles.cnt}>{readers.length}</span>
            </button>
            <button className={styles.ctrlBtn} type="button" onClick={() => { setTab('chat'); setDrawer((d) => !(d && tab === 'chat')); }}>
              {chatLabel} {unread > 0 && <span className={styles.unread}>{unread}</span>}
            </button>
          </div>
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
          <div className={`${styles.dock} ${mineHere?.status === 'paused' ? styles.dockPaused : ''}`}>{dock}</div>
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
      {goal > 0 && (
        <div className={styles.goal} role="status" key={goal}>
          <div className={styles.goalIn}>
            <svg viewBox="0 0 110 110" aria-hidden="true"><circle className={styles.gRing} cx="55" cy="55" r="48" /><path className={styles.gTick} d="M33 57l15 15 29-32" /></svg>
            <div className={styles.goalT}>{t('room.goalTitle', { min: GOAL })}</div>
            <div className={styles.goalS}>{t('room.goalSub')}</div>
          </div>
          {Array.from({ length: 16 }, (_, i) => (
            <i key={i} style={{ '--x': `${Math.round((Math.random() * 2 - 1) * 90)}px`, '--y': `${Math.round(-90 - Math.random() * 120)}px`, '--z': `${Math.round(10 + Math.random() * 22)}px`, '--d': `${(1.9 + Math.random() * 0.5).toFixed(2)}s` } as CSSProperties} />
          ))}
        </div>
      )}
    </>
  );
}
