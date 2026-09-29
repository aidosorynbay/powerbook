import { Header, ReadingRoom } from '@/widgets';

/**
 * The reading room, reached from the library. The library page itself is the bookcase and fills the screen, so the
 * hall has a page of its own, reached from the bookcase's header. For now it is the circle's own room, opened to
 * every reader: the same chairs and chat as under the round, and only the circle's minutes go into its calendar.
 */
export function LibraryHallPage() {
  return (
    <div style={{ minHeight: '100svh', background: '#170b06' }}>
      <Header />
      <ReadingRoom hall="round" layout="full" />
    </div>
  );
}
