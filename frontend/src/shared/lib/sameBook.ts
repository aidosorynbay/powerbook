import { apiGet } from './api';

/**
 * «Вы про эту книгу?» The founder (2026-10-21): «Скажи жизни да» one day and «Сказать жизни «ДА» the next stood as
 * two books. A typed title that is close to one of the reader's books or a book of the shared library, but not the
 * same, is asked about before it is kept: one tap takes the known title, «Нет» keeps the typed one and is not asked again.
 */

const norm = (s: string) =>
  s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const pairs = (s: string) => {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
  return out;
};

/** How close two titles are, 0…1: letter pairs in common, or one title the start of the other («Маркетинг от А до»). */
export function titleCloseness(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // «1984» and «1983», «Том 1» and «Том 2»: other numbers, another book
  const dx = x.match(/\d+/g)?.join(' ');
  const dy = y.match(/\d+/g)?.join(' ');
  if (dx && dy && dx !== dy) return 0;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 5 && long.startsWith(short)) return 0.9;
  const px = pairs(x);
  const left = new Map<string, number>();
  pairs(y).forEach((p) => left.set(p, (left.get(p) ?? 0) + 1));
  let common = 0;
  px.forEach((p) => {
    const n = left.get(p) ?? 0;
    if (n > 0) {
      common += 1;
      left.set(p, n - 1);
    }
  });
  const total = px.length + pairs(y).length;
  return total ? (2 * common) / total : 0;
}

const CLOSE = 0.66;
const SAID_NO = 'pb.notSameBook';

function saidNo(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SAID_NO) || '[]');
  } catch {
    return [];
  }
}

/** «Нет, другая книга»: this typed title is not that book, so it is not asked again. */
export function notSameBook(typed: string, known: string): void {
  try {
    const list = [`${norm(typed)}|${norm(known)}`, ...saidNo()].slice(0, 200);
    localStorage.setItem(SAID_NO, JSON.stringify(list));
  } catch {
    /* private window: it may be asked again */
  }
}

/** The known title a typed one most likely means, or null when it is that title already or nothing is close. */
export async function guessBook(typed: string, own: string[]): Promise<string | null> {
  const t = typed.trim();
  if (norm(t).length < 3) return null;
  const candidates = [...own];
  const { data } = await apiGet<{ works: { title: string }[] }>(
    `/books/match?q=${encodeURIComponent(t)}&editions=false`,
    { requireAuth: true },
  );
  candidates.push(...(data?.works ?? []).map((w) => w.title));
  if (candidates.some((c) => norm(c) === norm(t))) return null;
  const refused = new Set(saidNo());
  let best: string | null = null;
  let score = CLOSE;
  for (const c of candidates) {
    if (refused.has(`${norm(t)}|${norm(c)}`)) continue;
    const s = titleCloseness(t, c);
    if (s >= score) {
      best = c;
      score = s;
    }
  }
  return best;
}
