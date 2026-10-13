import { useEffect, useState } from 'react';
import { apiGet, getApiBaseUrl } from '@/shared/lib';

/**
 * The cover of the book being read, for the line over the dial (the founder:
 * «лучше обложка, чем одно название»). The shared library's book first, then
 * a catalogue edition; kept for the session so the dial page asks once.
 */
type Match = { works: { title: string; cover_thumb_url: string | null }[]; editions: { thumb_url: string }[] };

const memo = new Map<string, string | null>();

export function useBookCover(title: string | undefined): string | null {
  const key = (title ?? '').trim().toLowerCase();
  const [url, setUrl] = useState<string | null>(() => (key ? memo.get(key) ?? readStore(key) : null));
  useEffect(() => {
    if (!key || key.length < 2) {
      setUrl(null);
      return;
    }
    if (memo.has(key)) {
      setUrl(memo.get(key) ?? null);
      return;
    }
    let alive = true;
    void apiGet<Match>(`/books/match?q=${encodeURIComponent(title!.trim())}&editions=false`, { requireAuth: true }).then(({ data }) => {
      // only a book whose title is this one (or this one without its volume number): never a stranger's cover
      const norm = (x: string) => x.toLowerCase().replace(/[«»"'.,:;!?()]/g, '').replace(/\s+/g, ' ').trim();
      const want = norm(title!);
      const same = (w: { title: string }) => {
        const got = norm(w.title);
        return got === want || want.startsWith(`${got} `) || got.startsWith(`${want} `);
      };
      const found = data?.works.find((w) => w.cover_thumb_url && same(w))?.cover_thumb_url ?? null;
      memo.set(key, found);
      try {
        sessionStorage.setItem(`pb.cover2.${key}`, found ?? '');
      } catch {
        /* fine */
      }
      if (alive) setUrl(found);
    });
    return () => {
      alive = false;
    };
  }, [key, title]);
  // covers of the shared library are API paths (/library/covers/…), editions are full URLs
  return url && !url.startsWith('http') && !url.startsWith('data:') ? `${getApiBaseUrl()}${url}` : url;
}

function readStore(key: string): string | null {
  try {
    const v = sessionStorage.getItem(`pb.cover2.${key}`);
    return v ? v : null;
  } catch {
    return null;
  }
}
