import { useSyncExternalStore } from 'react';
import { apiGet } from './api';

/** The award pin each reader wears by their avatar (GET /insights/awards/worn: user id → award key), fetched
 * once for the whole site and read by every avatar. Off until `enableWornPins(true)`: the awards are shown to
 * admins first (widgets/Awards FOR_EVERYONE). Readers who hid their awards or chose «Не носить» are not in it. */
let enabled = false;
let pins: Record<string, string> = {};
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((f) => f());
}

async function load() {
  const { data } = await apiGet<Record<string, string>>('/insights/awards/worn', { requireAuth: true });
  if (!enabled) return;
  pins = data ?? {};
  emit();
}

export function enableWornPins(on: boolean) {
  if (on === enabled) return;
  enabled = on;
  if (on) void load();
  else {
    pins = {};
    emit();
  }
}

/** After the reader changes their own pin. */
export function refreshWornPins() {
  if (enabled) void load();
}

function subscribe(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

export function useWornPin(userId?: string | null): string | null {
  const all = useSyncExternalStore(subscribe, () => pins);
  return userId ? all[userId] ?? null : null;
}

/** The pin cut out of its cloth (transparent), as worn by an avatar. */
export const pinCutUrl = (key: string) => `/award-pins/c/${key}.webp`;
