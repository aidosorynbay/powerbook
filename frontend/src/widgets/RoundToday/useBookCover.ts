import { useEffect, useState } from 'react';
import { apiGet, getApiBaseUrl } from '@/shared/lib';

/**
 * The cover of the book being read, for the line over the dial (the founder:
 * «лучше обложка, чем одно название»). The reader's own copy on their
 * bookcase comes first, with the cover they gave it there (the founder,
 * 2026-10-13: «Red Rising 1» has his own cover); then the shared library's
 * book of the same title. Never another book's cover.
 */
type Shelf = { books: { title: string; cover_thumb_url: string | null; cover_url: string | null; cover_data: string | null }[] };
type Match = { works: { title: string; cover_thumb_url: string | null }[] };

const norm = (x: string) => x.toLowerCase().replace(/[«»"'.,:;!?()]/g, '').replace(/\s+/g, ' ').trim();
/** This title, or this title without a volume number («Red Rising 1» and «Red Rising»). */
const sameTitle = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `);
};
const abs = (url: string | null) => (url && !url.startsWith('http') && !url.startsWith('data:') ? `${getApiBaseUrl()}${url}` : url);

let shelf: Promise<Shelf | null> | null = null;
const memo = new Map<string, string | null>();

async function lookup(title: string): Promise<string | null> {
  shelf ??= apiGet<Shelf>('/library/bookcase', { requireAuth: true }).then(({ data }) => data ?? null);
  const mine = (await shelf)?.books.filter((b) => sameTitle(b.title, title)) ?? [];
  // an exact title first, then a volume of the same series name
  mine.sort((a, b) => Number(norm(b.title) === norm(title)) - Number(norm(a.title) === norm(title)));
  const own = mine.map((b) => b.cover_thumb_url ?? b.cover_url ?? b.cover_data).find(Boolean);
  if (own) return abs(own);
  const { data } = await apiGet<Match>(`/books/match?q=${encodeURIComponent(title)}&editions=false`, { requireAuth: true });
  return abs(data?.works.find((w) => w.cover_thumb_url && sameTitle(w.title, title))?.cover_thumb_url ?? null);
}

export function useBookCover(title: string | undefined): string | null {
  const key = (title ?? '').trim();
  const [url, setUrl] = useState<string | null>(() => memo.get(key.toLowerCase()) ?? null);
  useEffect(() => {
    if (key.length < 2) {
      setUrl(null);
      return;
    }
    const k = key.toLowerCase();
    if (memo.has(k)) {
      setUrl(memo.get(k) ?? null);
      return;
    }
    let alive = true;
    void lookup(key).then((found) => {
      memo.set(k, found);
      if (alive) setUrl(found);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return url;
}
