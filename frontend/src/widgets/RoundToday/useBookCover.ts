import { useEffect, useState } from 'react';
import { apiGet, getApiBaseUrl } from '@/shared/lib';

/**
 * The cover of the book being read, for the line over the dial (the founder:
 * «лучше обложка, чем одно название»). The reader's own copy on their
 * bookcase comes first, looking exactly as it does there (the founder,
 * 2026-10-13: «Red Rising 1» has their own cover): the shared library's face
 * of the book (app/services/book_face.py) or the cover they chose; then the
 * shared library's book of the same title. Never another book's cover. The
 * title comes back as the library spells it, so «три товарища» typed today
 * reads «Три товарища», as on the shelf.
 */
type Shelf = { books: { title: string; author: string | null; cover_thumb_url: string | null; cover_url: string | null; cover_data: string | null }[] };
type Match = { works: { title: string; author: string | null; cover_thumb_url: string | null }[] };
export type BookLook = { cover: string | null; author: string | null; title: string | null };

const norm = (x: string) => x.toLowerCase().replace(/[«»"'.,:;!?()]/g, '').replace(/\s+/g, ' ').trim();
/** This title, or this title without a volume number («Red Rising 1» and «Red Rising»). */
const sameTitle = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `);
};
const abs = (url: string | null) => (url && !url.startsWith('http') && !url.startsWith('data:') ? `${getApiBaseUrl()}${url}` : url);

let shelf: Promise<Shelf | null> | null = null;
// What each title looked like last time, shown at once; `fresh` holds the titles looked up since the shelf last
// changed. A cover photographed on the bookcase showed over the dial only after the app was closed (2026-10-19).
const memo = new Map<string, BookLook>();
const fresh = new Set<string>();
const listeners = new Set<() => void>();

/** The reader's shelf changed (a cover photographed or picked, a book corrected) or the app came back to the
 * front: look every title up again. What is on screen stays until the new look arrives. */
export function forgetBookCovers() {
  shelf = null;
  fresh.clear();
  listeners.forEach((listener) => listener());
}

if (typeof document !== 'undefined') {
  // someone else's photo may have become the book's cover meanwhile
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') forgetBookCovers();
  });
}

async function lookup(title: string): Promise<BookLook> {
  shelf ??= apiGet<Shelf>('/library/bookcase', { requireAuth: true }).then(({ data }) => data ?? null);
  const mine = (await shelf)?.books.filter((b) => sameTitle(b.title, title)) ?? [];
  // an exact title first, then a volume of the same series name
  mine.sort((a, b) => Number(norm(b.title) === norm(title)) - Number(norm(a.title) === norm(title)));
  // the shelf's own order: a file's cover only when the library has none for the book (cover_data is then set)
  const own = mine.find((b) => b.cover_data ?? b.cover_thumb_url ?? b.cover_url);
  // the title only from the same book, not from another volume of its series
  const same = mine.find((b) => norm(b.title) === norm(title));
  if (own) return { cover: abs(own.cover_data ?? own.cover_thumb_url ?? own.cover_url), author: own.author, title: same?.title ?? null };
  const { data } = await apiGet<Match>(`/books/match?q=${encodeURIComponent(title)}&editions=false`, { requireAuth: true });
  const work = data?.works.find((w) => sameTitle(w.title, title));
  const exact = work && norm(work.title) === norm(title) ? work.title : null;
  return { cover: abs(work?.cover_thumb_url ?? null), author: work?.author ?? mine[0]?.author ?? null, title: same?.title ?? exact };
}

const NONE: BookLook = { cover: null, author: null, title: null };

export function useBookCover(title: string | undefined): BookLook {
  const key = (title ?? '').trim();
  const [url, setUrl] = useState<BookLook>(() => memo.get(key.toLowerCase()) ?? NONE);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const again = () => setRound((n) => n + 1);
    listeners.add(again);
    return () => {
      listeners.delete(again);
    };
  }, []);
  useEffect(() => {
    if (key.length < 2) {
      setUrl(NONE);
      return;
    }
    const k = key.toLowerCase();
    if (memo.has(k)) setUrl(memo.get(k) ?? NONE);
    if (fresh.has(k)) return;
    let alive = true;
    void lookup(key).then((found) => {
      memo.set(k, found);
      fresh.add(k);
      if (alive) setUrl(found);
    });
    return () => {
      alive = false;
    };
  }, [key, round]);
  return url;
}
