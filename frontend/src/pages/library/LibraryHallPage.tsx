import { Header, ReadingRoom } from '@/widgets';

/**
 * The library's reading room, open to every reader. The library page itself is the bookcase and fills the screen,
 * so the hall has a page of its own, reached from the bookcase's header.
 */
export function LibraryHallPage() {
  return (
    <div style={{ minHeight: '100svh', background: '#170b06' }}>
      <Header />
      <ReadingRoom hall="library" layout="full" />
    </div>
  );
}
