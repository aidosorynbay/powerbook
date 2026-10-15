import { useAuth } from '@/shared/lib';
import { GuestRoom, Header, ReadingRoom, useOpenHall } from '@/widgets';

/**
 * The reading room page: one hall for everyone (useOpenHall, the circle's). A reader of the current circle gets their
 * minutes into the circle's day, anyone else keeps them as reading-room minutes; a visitor without an account reads
 * there too (GuestRoom) and keeps the minutes by signing up afterwards (GuestKept, in the app shell).
 */
export function LibraryHallPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const hall = useOpenHall();

  return (
    <div style={{ minHeight: '100svh', background: '#170b06' }}>
      <Header />
      {!isLoading && (isAuthenticated ? <ReadingRoom key={hall} hall={hall} layout="full" /> : <GuestRoom />)}
    </div>
  );
}
