import { useAuth, useWaitlist } from '@/shared/lib';
import { GuestRoom, Header, ReadingRoom } from '@/widgets';

/**
 * The reading room page. A reader of the current circle sits in the circle's own hall; anyone else in the library
 * hall, where their minutes are kept as reading-room minutes. A visitor without an account reads in the library hall
 * too (GuestRoom), and keeps the minutes by signing up afterwards (GuestKept, in the app shell).
 */
export function LibraryHallPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const { state, ready: settled } = useWaitlist();
  // a reader just logged in from the guest room: wait for their own state, not the visitor's still in memory
  const ready = !isLoading && (!isAuthenticated || settled);
  const inCircle = !!state && (state.in_current_round || state.in_open_round);

  return (
    <div style={{ minHeight: '100svh', background: '#170b06' }}>
      <Header />
      {ready && (isAuthenticated ? <ReadingRoom key={inCircle ? 'round' : 'library'} hall={inCircle ? 'round' : 'library'} layout="full" /> : <GuestRoom />)}
    </div>
  );
}
