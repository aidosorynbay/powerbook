import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, getApiBaseUrl, track, useAuth, useI18n, useWaitlist, type PublicStats } from '@/shared/lib';
import { LiveRoom, clock, type PublicRoom } from './LiveRoom';
import { Ding } from './sound';
import styles from './GuestRoom.module.css';

/** The visitor's sitting, kept by their browser until they keep it with an account (see claimGuestSitting). */
export const GUEST_KEY = 'pb.guestSit';
type Kept = { id: string; token: string; key: string; book: string; ended?: boolean; minutes?: number };
type SittingOut = {
  id: string; key: string; seat: number; book: string; status: 'reading' | 'paused';
  elapsed_seconds: number; away_seconds: number; ended: boolean; claimed: boolean;
};
type Claimed = { minutes: number; credited: boolean };
const GOAL = 30;

export function readGuestSitting(): Kept | null {
  try {
    const v = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null');
    return v && v.id && v.token ? v : null;
  } catch {
    return null;
  }
}
function keep(v: Kept | null) {
  try {
    if (v) localStorage.setItem(GUEST_KEY, JSON.stringify(v));
    else localStorage.removeItem(GUEST_KEY);
  } catch {
    /* storage blocked: the sitting lives as long as the page */
  }
}

let claiming: Promise<Claimed | null> | null = null;

/** After signing up or logging in: the visitor's minutes become theirs. Returns what was kept, or null.
 *  Callers at the same moment share one request (the server also locks the sitting). */
export function claimGuestSitting(): Promise<Claimed | null> {
  if (!claiming) claiming = claimOnce().finally(() => { claiming = null; });
  return claiming;
}

async function claimOnce(): Promise<Claimed | null> {
  const g = readGuestSitting();
  if (!g) return null;
  const { data, error } = await apiPost<Claimed>(`/reading-room/guest/${g.id}/claim`, { token: g.token }, { requireAuth: true });
  if (data) {
    keep(null);
    track('guest_claim', { minutes: data.minutes, credited: data.credited });
    return data;
  }
  // a sitting nobody can find any more (or kept by someone else) is let go; a network hiccup is tried again later
  if (error === 'Sitting not found' || error === 'Already kept') keep(null);
  return null;
}

/** Wherever a visitor signs up or logs in, their room minutes become theirs, and they are told so. */
export function GuestKept() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [kept, setKept] = useState<Claimed | null>(null);
  useEffect(() => {
    if (!user || !readGuestSitting()) return;
    claimGuestSitting().then((r) => r && r.minutes > 0 && setKept(r));
  }, [user]);
  useEffect(() => {
    if (!kept) return;
    const id = window.setTimeout(() => setKept(null), 7000);
    return () => window.clearTimeout(id);
  }, [kept]);
  if (!kept) return null;
  return (
    <div className={styles.kept} role="status">
      {kept.credited ? t('guestRoom.keptCircle', { min: kept.minutes }) : t('guestRoom.kept', { min: kept.minutes })}
    </div>
  );
}

/** While the clock runs the screen stays on (a phone beside a paper book would lock and stop the page). */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
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
          l.addEventListener('release', () => { lock = null; });
        },
        () => { asking = false; },
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
  }, [on]);
}

/**
 * The library hall for a visitor without an account: one tap sits them in a free chair (the book's name is
 * optional), the timer runs with the screen kept on, a locked phone is asked about rather than lost, and when they
 * are done they keep the minutes by joining the circle or just signing up — or leave them.
 */
export function GuestRoom() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { state: wait } = useWaitlist();
  const [mine, setMine] = useState<Kept | null>(() => readGuestSitting());
  const [sitting, setSitting] = useState<SittingOut | null>(null);
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [book, setBook] = useState('');
  const [gender, setGender] = useState<'female' | 'male'>('female');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [titles, setTitles] = useState<string[]>([]);
  const [goal, setGoal] = useState(false);
  const stamp = useRef(performance.now());
  const goalRang = useRef(false);
  const [, setTick] = useState(0);

  // the rest of PowerBook reading right now, and the circle's books as one-tap titles
  useEffect(() => {
    apiGet<PublicStats>('/stats/public').then(({ data }) => data && setStats(data));
    apiGet<{ title: string }[]>('/stats/public/books').then(({ data }) => data && setTitles(data.slice(0, 4).map((b) => b.title)));
  }, []);

  const call = useCallback(async (what: 'heartbeat' | 'pause' | 'resume' | 'finish') => {
    const g = readGuestSitting();
    if (!g) return null;
    const { data, error } = await apiPost<SittingOut & { minutes?: number }>(`/reading-room/guest/${g.id}/${what}`, { token: g.token });
    if (error === 'Sitting not found') {
      // the sitting is gone (another device, or long ago): start over
      keep(null);
      setMine(null);
      setSitting(null);
      return null;
    }
    if (data) {
      stamp.current = performance.now();
      setSitting(data);
      if (data.ended) {
        const done = { ...g, ended: true, minutes: data.minutes ?? Math.floor(data.elapsed_seconds / 60) };
        keep(done);
        setMine(done);
      }
    }
    return data;
  }, []);

  const answerAway = async (count: boolean) => {
    const g = readGuestSitting();
    if (!g) return;
    setBusy(true);
    const { data } = await apiPost<SittingOut>(`/reading-room/guest/${g.id}/away`, { token: g.token, count });
    setBusy(false);
    if (data) {
      stamp.current = performance.now();
      setSitting(data);
    }
    track('guest_away', { count });
  };

  const open = !!mine && !mine.ended;
  useWakeLock(open && sitting?.status === 'reading');

  // Back to an open sitting after a reload; the clock is told every 25 seconds while the page is open. A page
  // closed mid-sitting gets up from the chair (the minutes stay in this browser, to keep later).
  const lastElapsed = useRef(0);
  lastElapsed.current = sitting?.elapsed_seconds ?? 0;
  useEffect(() => {
    if (!open || !mine) return;
    call('heartbeat');
    const id = window.setInterval(() => call('heartbeat'), 25_000);
    const tick = window.setInterval(() => setTick((n) => n + 1), 1000);
    const onShow = () => { if (document.visibilityState === 'visible') call('heartbeat'); };
    const onHide = (e: PageTransitionEvent) => {
      if (e.persisted) return; // into the back-forward cache: the page may well come back
      const body = new Blob([JSON.stringify({ token: mine.token })], { type: 'application/json' });
      navigator.sendBeacon?.(`${getApiBaseUrl()}/reading-room/guest/${mine.id}/finish`, body);
      keep({ ...mine, ended: true, minutes: Math.floor(lastElapsed.current / 60) });
    };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.clearInterval(id);
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pagehide', onHide);
    };
  }, [mine?.id, open, call]); // eslint-disable-line react-hooks/exhaustive-deps

  const seconds = sitting && !sitting.ended
    ? sitting.elapsed_seconds + (sitting.status === 'reading' ? (performance.now() - stamp.current) / 1000 : 0)
    : 0;

  // thirty minutes: the bell, and what that is in the circle
  useEffect(() => {
    if (!open || goalRang.current || seconds < GOAL * 60) return;
    goalRang.current = true;
    Ding.play();
    setGoal(true);
    track('guest_goal');
  }, [open, seconds]);
  useEffect(() => {
    if (!goal) return;
    const id = window.setTimeout(() => setGoal(false), 6000);
    return () => window.clearTimeout(id);
  }, [goal]);

  const freeSeats = (r: PublicRoom | null) => {
    if (!r) return [];
    const taken = new Set(r.readers.map((x) => x.seat));
    return Array.from({ length: r.seats }, (_, i) => i).filter((i) => !taken.has(i));
  };
  const seatsLeft = room?.guest_seats_left ?? 1;

  const sit = async () => {
    if (pick === null) return;
    Ding.prime();
    setBusy(true);
    setErr('');
    const { data, error } = await apiPost<SittingOut & { token: string }>('/reading-room/guest-sit', { seat: pick, book: book.trim(), gender });
    setBusy(false);
    if (!data) {
      setErr(
        error === 'Hall is full for guests' ? t('guestRoom.full')
          : error === 'Not a book title' ? t('guestRoom.notTitle')
          : error === 'Too many sittings' ? t('guestRoom.tooMany')
          : error?.includes('taken') ? t('guestRoom.taken') : t('guestRoom.error'),
      );
      setRefresh((n) => n + 1);
      return;
    }
    const k: Kept = { id: data.id, token: data.token, key: data.key, book: data.book };
    keep(k);
    setMine(k);
    setSitting(data);
    goalRang.current = false;
    stamp.current = performance.now();
    setPick(null);
    setRefresh((n) => n + 1);
    track('guest_sit', { seat: data.seat, titled: !!book.trim() });
  };

  const finish = async () => {
    setBusy(true);
    await call('finish');
    setBusy(false);
    setRefresh((n) => n + 1);
    track('guest_finish');
  };

  const leave = () => {
    keep(null);
    setMine(null);
    setSitting(null);
    setBook('');
    track('guest_leave');
  };

  const month = wait ? t(`month.${wait.month}`) : '';
  const joinOpen = !wait || wait.phase === 'registration';
  const save = (to: 'join' | 'register' | 'login') => {
    track('guest_save', { to });
    const back = encodeURIComponent('/library/hall');
    navigate(to === 'join' ? '/join' : to === 'register' ? `/register?redirect=${back}` : `/login?redirect=${back}`);
  };

  const elsewhere = stats?.room_now ?? 0;

  let panel;
  if (mine?.ended && (mine.minutes ?? 0) < 1) {
    panel = (
      <div className={styles.card} role="dialog" aria-labelledby="guest-short">
        <h2 id="guest-short" className={styles.title}>{t('guestRoom.shortTitle')}</h2>
        <p className={styles.text}>{t('guestRoom.shortText')}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={leave}>{t('guestRoom.again')}</button>
          <button type="button" className={styles.link} onClick={() => save('join')}>
            {joinOpen ? t('wl.heroJoin', { month }) : t('wl.heroWait', { month })}
          </button>
        </div>
      </div>
    );
  } else if (mine?.ended) {
    panel = (
      <div className={styles.card} role="dialog" aria-labelledby="guest-done">
        <h2 id="guest-done" className={styles.title}>{t('guestRoom.doneTitle', { min: mine.minutes ?? 0 })}</h2>
        <p className={styles.text}>{joinOpen ? t('guestRoom.doneText') : t('guestRoom.doneTextWait', { month })}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => save('join')}>
            {joinOpen ? t('guestRoom.saveJoin', { month }) : t('guestRoom.saveWait', { month })}
          </button>
          <button type="button" className={styles.secondary} onClick={() => save('register')}>{t('guestRoom.saveSite')}</button>
          <button type="button" className={styles.link} onClick={() => save('login')}>{t('guestRoom.saveLogin')}</button>
          <button type="button" className={styles.link} onClick={leave}>{t('guestRoom.dontSave')}</button>
        </div>
      </div>
    );
  } else if (open && sitting && sitting.away_seconds > 0) {
    panel = (
      <div className={styles.card} role="dialog" aria-labelledby="guest-away">
        <h2 id="guest-away" className={styles.title}>{t('room.awayAsk', { min: Math.max(1, Math.round(sitting.away_seconds / 60)) })}</h2>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={busy} onClick={() => answerAway(true)}>{t('room.awayYes')}</button>
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => answerAway(false)}>{t('room.awayNo')}</button>
        </div>
      </div>
    );
  } else if (open && mine) {
    panel = (
      <div className={styles.dock}>
        <span className={styles.clock} aria-label={t('room.timer')}>{clock(seconds)}</span>
        <span className={styles.dockBook}><i>{mine.book}</i><small>{t('guestRoom.dockNote')}</small></span>
        {sitting?.status === 'paused'
          ? <button type="button" className={styles.secondary} onClick={() => call('resume')}>{t('room.resume')}</button>
          : <button type="button" className={styles.secondary} onClick={() => call('pause')}>{t('room.pause')}</button>}
        <button type="button" className={styles.primary} disabled={busy} onClick={finish}>{t('guestRoom.finish')}</button>
      </div>
    );
  } else if (pick !== null) {
    panel = (
      <form className={styles.card} onSubmit={(e) => { e.preventDefault(); sit(); }}>
        <h2 className={styles.title}>{t('guestRoom.pickTitle')}</h2>
        <label className={styles.field}>
          <span>{t('guestRoom.book')}</span>
          <input value={book} maxLength={200} onChange={(e) => setBook(e.target.value)} placeholder={t('guestRoom.bookHint')} />
        </label>
        {titles.length > 0 && (
          <div className={styles.chips}>
            {titles.map((x) => (
              <button key={x} type="button" className={book === x ? styles.on : ''} onClick={() => setBook(book === x ? '' : x)}>{x}</button>
            ))}
          </div>
        )}
        <div className={styles.who} role="radiogroup" aria-label={t('guestRoom.who')}>
          <span>{t('guestRoom.who')}</span>
          <button type="button" role="radio" aria-checked={gender === 'female'} className={gender === 'female' ? styles.on : ''} onClick={() => setGender('female')}>{t('guestRoom.female')}</button>
          <button type="button" role="radio" aria-checked={gender === 'male'} className={gender === 'male' ? styles.on : ''} onClick={() => setGender('male')}>{t('guestRoom.male')}</button>
        </div>
        {err && <p className={styles.err}>{err}</p>}
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={busy}>{t('guestRoom.start')}</button>
          <button type="button" className={styles.link} onClick={() => setPick(null)}>{t('guestRoom.back')}</button>
        </div>
      </form>
    );
  } else if (seatsLeft === 0) {
    panel = (
      <div className={styles.card}>
        <h2 className={styles.title}>{t('guestRoom.fullTitle')}</h2>
        <p className={styles.text}>{t('guestRoom.full')}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => save('register')}>{t('guestRoom.signUp')}</button>
          <button type="button" className={styles.link} onClick={() => save('login')}>{t('guestRoom.saveLogin')}</button>
        </div>
      </div>
    );
  } else {
    panel = (
      <div className={styles.intro}>
        {elsewhere > 0 && <p className={styles.pill}><span aria-hidden="true" />{t('guestRoom.elsewhere', { n: elsewhere })}</p>}
        <h1 className={styles.introTitle}>{t('guestRoom.introTitle')}</h1>
        <p className={styles.text}>{t('guestRoom.introText')}</p>
        <button
          type="button"
          className={`${styles.primary} ${styles.introCta}`}
          onClick={() => {
            const free = freeSeats(room);
            if (free.length) setPick(free[Math.floor(Math.random() * free.length)]);
            track('guest_any_chair');
          }}
        >
          {t('guestRoom.anyChair')}
        </button>
      </div>
    );
  }

  return (
    <>
      <LiveRoom
        hall="library"
        mineKey={mine?.key ?? null}
        onSeat={open || mine?.ended || seatsLeft === 0 ? undefined : (seat) => { setPick(seat); setErr(''); }}
        refresh={refresh}
        onRoom={(r: PublicRoom) => {
          setRoom(r);
          // our own chair closed elsewhere: show it as finished on the next heartbeat
          if (open && !r.readers.some((x) => x.key === mine?.key)) call('heartbeat');
        }}
      >
        <div className={styles.wrap}>{panel}</div>
      </LiveRoom>
      {goal && (
        <div className={styles.goal} role="status">
          <b>{t('room.goalTitle', { min: GOAL })}</b>
          <span>{t('guestRoom.goalSub')}</span>
        </div>
      )}
    </>
  );
}
