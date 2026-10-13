import { useEffect, useState } from 'react';
import { apiGet } from '@/shared/lib';

/**
 * The cover of the book being read, for the line over the dial (the founder:
 * «лучше обложка, чем одно название»). The shared library's book first, then
 * a catalogue edition; kept for the session so the dial page asks once.
 */
type Match = { works: { cover_thumb_url: string | null }[]; editions: { thumb_url: string }[] };

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
    void apiGet<Match>(`/books/match?q=${encodeURIComponent(title!.trim())}`, { requireAuth: true }).then(({ data }) => {
      const found = data?.works.find((w) => w.cover_thumb_url)?.cover_thumb_url ?? data?.editions[0]?.thumb_url ?? null;
      memo.set(key, found);
      try {
        sessionStorage.setItem(`pb.cover.${key}`, found ?? '');
      } catch {
        /* fine */
      }
      if (alive) setUrl(found);
    });
    return () => {
      alive = false;
    };
  }, [key, title]);
  return url;
}

function readStore(key: string): string | null {
  try {
    const v = sessionStorage.getItem(`pb.cover.${key}`);
    return v ? v : null;
  } catch {
    return null;
  }
}
