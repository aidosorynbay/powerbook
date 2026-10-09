import { track } from './analytics';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { apiDelete, apiGet, apiPost } from './api';
import { useAuth } from './auth';

export type WaitlistState = {
  /** "registration": a round can be joined now; "waitlist": the next one can be waited for. */
  phase: 'registration' | 'waitlist';
  open_round: { id: string; year: number; month: number; registration_until: string; days_left: number } | null;
  year: number;
  month: number;
  starts_on: string;
  count: number;
  /** Readers already in the open round (0 when none is open). */
  joined: number;
  in_current_round: boolean;
  in_open_round: boolean;
  on_waitlist: boolean;
  waited_for_open: boolean;
  days_left_in_month: number;
  invited: number;
  people: { user_id: string; display_name: string; avatar_data: string | null }[];
  ref: string | null;
};

const REF_KEY = 'pb.ref';
// Set on the invitation page before sending someone to sign up: once they
// have an account, they land in the circle (or on its list) without asking
// twice. It holds the moment it was set, and is honoured for a day only, so
// a visit weeks ago cannot sign anyone up today.
const INTENT_KEY = 'pb.joinIntent';
const INTENT_TTL = 24 * 60 * 60 * 1000;

// One copy for the whole page: the hero, the prompt and the invitation page
// all show the same state and change together.
let current: WaitlistState | null = null;
let loadedFor: string | null | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function storage(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // blocked storage: the invitation simply is not remembered
  }
  return null;
}

export function rememberInvite(ref: string | null) {
  if (ref) storage(REF_KEY, ref.replace(/^@/, '').slice(0, 60));
}

/** The username whose shared link brought this visitor: sent with their sign-up. */
export function invitedRef(): string | null {
  return storage(REF_KEY);
}

export function markJoinIntent() {
  storage(INTENT_KEY, String(Date.now()));
}

function freshIntent(): boolean {
  const at = Number(storage(INTENT_KEY));
  return at > Date.now() - INTENT_TTL;
}

async function load(): Promise<WaitlistState | null> {
  const { data } = await apiGet<WaitlistState>('/waitlist', { requireAuth: true });
  if (data) {
    current = data;
    emit();
  }
  return data;
}

export function useWaitlist() {
  const { isAuthenticated, user } = useAuth();
  const state = useSyncExternalStore(subscribe, () => current);

  useEffect(() => {
    const who = isAuthenticated ? user?.id ?? null : null;
    if (loadedFor === who && current) return;
    loadedFor = who;
    load().then(async (s) => {
      if (!s || !isAuthenticated || storage(INTENT_KEY) === null) return;
      const fresh = freshIntent();
      storage(INTENT_KEY, null);
      if (!fresh) return;
      // Came from an invitation and has just signed up: put them on the list.
      if (s.phase === 'waitlist' && !s.on_waitlist && !s.in_current_round) {
        const { data } = await apiPost<WaitlistState>('/waitlist', { ref: storage(REF_KEY) }, { requireAuth: true });
        if (data) {
          current = data;
          emit();
        }
      } else if (s.phase === 'registration' && s.open_round && !s.in_open_round && !s.in_current_round) {
        // «Зарегистрироваться и записаться» promised both. Before, the account
        // was made and the reader was sent back to press a second button —
        // and whoever closed the tab in between had quietly missed the month.
        const { error } = await apiPost(`/rounds/${s.open_round.id}/join`, {}, { requireAuth: true });
        if (!error) track('round_join', { invited: !!storage(REF_KEY), via: 'signup' });
        await load();
      }
    });
  }, [isAuthenticated, user?.id]);

  const join = useCallback(async () => {
    const { data, error } = await apiPost<WaitlistState>('/waitlist', { ref: storage(REF_KEY) }, { requireAuth: true });
    if (data) {
      current = data;
      emit();
      track('waitlist_join', { invited: !!storage(REF_KEY) });
    }
    return error;
  }, []);

  const leave = useCallback(async () => {
    const { data } = await apiDelete<WaitlistState>('/waitlist', { requireAuth: true });
    if (data) {
      current = data;
      emit();
    }
  }, []);

  /** Take a place in the round whose sign-up is open. */
  const joinRound = useCallback(async () => {
    if (!current?.open_round) return 'no_round';
    const { error } = await apiPost(`/rounds/${current.open_round.id}/join`, {}, { requireAuth: true });
    if (!error) track('round_join', { invited: !!storage(REF_KEY) });
    await load();
    return error;
  }, []);

  return { state, join, leave, joinRound, refresh: load };
}

/** The reader's own invitation link. */
export function inviteLink(ref: string | null): string {
  const base = `${window.location.origin}/join`;
  return ref ? `${base}?ref=${encodeURIComponent(ref)}` : base;
}
