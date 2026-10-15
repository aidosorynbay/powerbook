import { useEffect, useState } from 'react';
import type { HallName } from './ReadingRoom';

/**
 * The one hall everyone reads in: the circle's readers, readers outside the circle and visitors without an account
 * (the founder, 2026-10-15: one hall, so that it fills up). It is the circle's; while no circle runs this month the
 * server answers «library» with every look at a room, and the pages that show «the» hall follow it.
 */
let current: HallName = 'round';
const listeners = new Set<(hall: HallName) => void>();

export function noteOpenHall(hall: HallName | undefined) {
  if (!hall || hall === current) return;
  current = hall;
  listeners.forEach((f) => f(hall));
}

export function useOpenHall(): HallName {
  const [hall, setHall] = useState(current);
  useEffect(() => {
    listeners.add(setHall);
    setHall(current);
    return () => {
      listeners.delete(setHall);
    };
  }, []);
  return hall;
}
