/** The league bookmarks, drawn as SVG strings: the long metal bookmark with its
 * engraving (profile, collection, the «new league» screen, the story) and the
 * slim glyph worn beside a name. Approved by the founder 2026-10-16; the
 * engravings live in public/leagues/<tier>.jpg (Google Flow, retoned per metal). */
import { LOGO_PATHS } from './logo';

export const TIERS = ['bronze', 'silver', 'gold', 'diamond', 'exlibris'] as const;
export type Tier = (typeof TIERS)[number];

/** Share of a circle's days each league needs; ex libris is three diamonds in a row. */
export const TIER_PCT: Record<Exclude<Tier, 'exlibris'>, number> = { bronze: 50, silver: 70, gold: 86, diamond: 96 };

// dark, light of the metal; the ink its words are engraved with
const METAL: Record<Tier, [string, string, string | null]> = {
  bronze: ['#8a5530', '#efb886', '#2a1406'],
  silver: ['#3f464d', '#eef2f6', '#2a3036'],
  gold: ['#6a3f00', '#ffd659', '#4a2c00'],
  diamond: ['#2f6690', '#eef9ff', '#163a5a'],
  exlibris: ['#0b0907', '#4a4239', null],
};
const GLOW: Partial<Record<Tier, string>> = {
  silver: 'rgba(220,235,255,.25)',
  gold: 'rgba(255,190,40,.45)',
  diamond: 'rgba(150,215,255,.6)',
  exlibris: 'rgba(255,170,60,.55)',
};
const PIPS: Record<Tier, number> = { bronze: 1, silver: 2, gold: 3, diamond: 4, exlibris: 5 };
const OUT = 'M6 0H94Q100 0 100 6V300L50 279L0 300V6Q0 0 6 0Z';
export const ENGRAVING_SIZE = [600, 1075] as const;

export const engravingUrl = (t: Tier) => `/leagues/${t}.jpg`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

let uid = 0;

export type MarkWords = { label: string; name: string; since?: string };

/**
 * The long bookmark, 100×300 units (the ribbon hangs out to the right and above).
 * `image` is the engraving's URL (a data: URL when the SVG is drawn to a canvas);
 * `words: null` leaves the engraved words off, for a canvas that writes them itself.
 */
export function markSvg(t: Tier, px: number, words: MarkWords | null, image = engravingUrl(t), animate = true): string {
  const [rd, rl, ink] = METAL[t];
  const k = `lg${++uid}`;
  const ex = t === 'exlibris';
  const engraved = (attrs: string, txt: string) =>
    ex
      ? `<text ${attrs} fill="#000" transform="translate(0 .5)">${esc(txt)}</text><text ${attrs} fill="url(#${k}g)">${esc(txt)}</text>`
      : `<text ${attrs} fill="#fff" fill-opacity=".5" transform="translate(0 .45)">${esc(txt)}</text><text ${attrs} fill="${ink}">${esc(txt)}</text>`;
  let pips = '';
  if (t === 'diamond') {
    pips = `<g transform="translate(50 229.5)"><path d="M-6 0l2.6-3.2h6.8l2.6 3.2-6 7.4z" fill="#d9f3ff" stroke="#163a5a" stroke-width=".5"/><path d="M-6 0h12M-3.4-3.2l1.4 3.2 2 7.4M3.4-3.2l-1.4 3.2-2 7.4M-2 0l2-3.2 2 3.2" fill="none" stroke="#163a5a" stroke-width=".4"/><path d="M-3.4-3.2h3.4l-2 3.2h-4z" fill="#fff" opacity=".85"/></g>`;
  } else {
    const n = PIPS[t];
    for (let i = 0; i < n; i++) {
      const x = 50 + (i - (n - 1) / 2) * 5;
      const d = `M${x} 230l1.7 1.7-1.7 1.7-1.7-1.7z`;
      pips += `<path d="${d}" fill="#fff" fill-opacity=".45" transform="translate(0 .4)"/><path d="${d}" fill="${ex ? '#F26430' : ink}"/>`;
    }
  }
  const logo = ex
    ? `<g transform="translate(42 22) scale(.0297) translate(-271 -271)" fill="#F26430">${LOGO_PATHS}</g>`
    : `<g transform="translate(42 22.45) scale(.0297) translate(-271 -271)" fill="#fff" fill-opacity=".5">${LOGO_PATHS}</g><g transform="translate(42 22) scale(.0297) translate(-271 -271)" fill="${rd}" fill-opacity=".85">${LOGO_PATHS}</g>`;
  const serif = `font-family="'Cormorant SC','Cormorant Garamond',Georgia,serif" font-weight="700"`;
  const nfs = words ? Math.min(12.5, 70 / (Math.max(words.name.length, 5) * 0.47)) : 0;
  const text = words
    ? engraved(`x="50" y="221" text-anchor="middle" ${serif} font-size="7.6" letter-spacing="1.6"`, words.label) +
      engraved(`x="50" y="252" text-anchor="middle" font-family="'Cormorant Garamond',Georgia,serif" font-style="italic" font-weight="700" font-size="${nfs}"`, words.name) +
      (words.since ? engraved(`x="50" y="262" text-anchor="middle" ${serif} font-size="5.6" letter-spacing="1.1"`, words.since) : '')
    : '';
  const sheenStops =
    t === 'diamond'
      ? '<stop offset=".35" stop-color="#9fe7ff" stop-opacity=".45"/><stop offset=".5" stop-color="#fff" stop-opacity=".8"/><stop offset=".65" stop-color="#ffc6f2" stop-opacity=".4"/>'
      : '<stop offset=".5" stop-color="#fff" stop-opacity=".5"/>';
  const sheen = animate
    ? `<g clip-path="url(#${k}c)"><rect x="-60" y="-20" width="24" height="360" fill="url(#${k}s)" transform="skewX(-14)" opacity=".5"><animate attributeName="x" values="-60;180;180" keyTimes="0;.35;1" dur="${t === 'gold' || t === 'diamond' || ex ? 3.4 : 5.5}s" repeatCount="indefinite"/></rect></g>`
    : '';
  const [W, H] = ENGRAVING_SIZE;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${px}" height="${px * 3}" viewBox="0 0 100 300" style="overflow:visible;display:block${GLOW[t] ? `;filter:drop-shadow(0 0 ${px / 12}px ${GLOW[t]})` : ''}" aria-hidden="true">
<defs>
 <linearGradient id="${k}r" x1="0" y1="0" x2="1" y2=".6"><stop offset="0" stop-color="${rl}"/><stop offset=".28" stop-color="${rd}"/><stop offset=".5" stop-color="${rl}"/><stop offset=".78" stop-color="${rd}"/><stop offset="1" stop-color="${rl}"/></linearGradient>
 <linearGradient id="${k}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b0"/><stop offset=".45" stop-color="#e2b04a"/><stop offset=".7" stop-color="#fff0b0"/><stop offset="1" stop-color="#b9862a"/></linearGradient>
 <linearGradient id="${k}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/>${sheenStops}<stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
 <linearGradient id="${k}o" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb07a"/><stop offset=".45" stop-color="#F26430"/><stop offset="1" stop-color="#9c3010"/></linearGradient>
 <clipPath id="${k}c"><path d="${OUT}"/></clipPath>
</defs>
<path d="${OUT}" transform="translate(1.6 3)" fill="#000" opacity=".5"/>
<path d="${OUT}" fill="url(#${k}r)"/>
<path d="${OUT}" fill="none" stroke="${ex ? `url(#${k}g)` : '#fff'}" stroke-opacity="${ex ? 1 : 0.55}" stroke-width="${ex ? 1.6 : 0.6}"/>
<path d="M3.6 3.6H96.4V294.4L50 275.2L3.6 294.4Z" fill="none" stroke="${ex ? `url(#${k}g)` : rd}" stroke-width="${ex ? 0.5 : 0.45}" opacity="${ex ? 0.8 : 0.55}"/>
<circle cx="50" cy="12" r="3.9" fill="${rd}"/><circle cx="50" cy="12" r="2.9" fill="#0a0705"/>
${logo}
<rect x="7.5" y="47.5" width="85" height="152" rx="1" fill="#000" opacity=".55"/>
<svg x="8" y="48" width="84" height="151" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><image href="${image}" xlink:href="${image}" width="${W}" height="${H}"/></svg>
<rect x="8" y="48" width="84" height="151" fill="none" stroke="#000" stroke-opacity=".5" stroke-width=".8"/>
<rect x="6.6" y="46.6" width="86.8" height="153.8" rx="1.2" fill="none" stroke="${ex ? `url(#${k}g)` : '#fff'}" stroke-opacity="${ex ? 1 : 0.45}" stroke-width="${ex ? 0.9 : 0.5}"/>
${pips}
${text}
${sheen}
<path d="M50 12C50 -2 57 -10 69 -10C84 -10 98 -8 104 -1C108 4 108 14 108 26" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="4.2" stroke-linecap="round" transform="translate(1.2 1.6)"/>
<path d="M50 12C50 -2 57 -10 69 -10C84 -10 98 -8 104 -1C108 4 108 14 108 26" fill="none" stroke="url(#${k}o)" stroke-width="3.8" stroke-linecap="round"/>
<path d="M51.5 4C53 -4 59 -7.8 69 -7.8C82 -7.8 94 -6 100 -1" fill="none" stroke="#ffc09a" stroke-width=".9" opacity=".65" stroke-linecap="round"/>
<path d="M105 25h6l-.8 3.4h-4.4z" fill="#b8400f"/>
<path d="M105.9 28.4l-2 20M107.1 28.4l-.8 21M108.1 28.4l.4 21M109.1 28.4l1.3 20.6M110.1 28.4l2.4 19.4" stroke="#F26430" stroke-width="1.25" stroke-linecap="round"/>
<path d="M106.7 29l-.8 17.5M109.1 29l.8 17.5" stroke="#ffb88f" stroke-width=".55" opacity=".8"/>
</svg>`;
}

/** The slim bookmark beside a reader's name: the metal, a dark window, our orange at the top. */
export function glyphSvg(t: Tier): string {
  const [rd, rl] = METAL[t];
  const k = `lgg${++uid}`;
  const ex = t === 'exlibris';
  const glow = t === 'gold' || t === 'diamond' || ex ? `drop-shadow(0 0 3px ${GLOW[t]})` : 'drop-shadow(0 1px 1px rgba(0,0,0,.5))';
  return `<svg width="7.4" height="22" viewBox="0 0 100 300" style="overflow:visible;filter:${glow}" aria-hidden="true"><defs><linearGradient id="${k}" x1="0" y1="0" x2="1" y2=".5"><stop offset="0" stop-color="${rl}"/><stop offset=".45" stop-color="${rd}"/><stop offset="1" stop-color="${rl}"/></linearGradient></defs><path d="M8 0H92Q100 0 100 8V300L50 270L0 300V8Q0 0 8 0Z" fill="url(#${k})" stroke="${ex ? '#e2b04a' : 'none'}" stroke-width="10"/><rect x="16" y="60" width="68" height="140" fill="#000" opacity=".45"/><circle cx="50" cy="28" r="12" fill="#F26430"/></svg>`;
}

/** The bookmark's tail that hangs from under the league ring on a reader's face (founder + council, 2026-10-17):
 * 6×12, lit from the left like the ring, swallowtail below; ex libris is black with a gold edge. */
const TAIL: Record<Tier, [string, string, string]> = {
  bronze: ['#5e3218', '#e8b894', '#c98a5e'],
  silver: ['#6f7a84', '#ffffff', '#e9eef2'],
  gold: ['#9c6f1e', '#fff1b8', '#f6d77a'],
  diamond: ['#2a7fb8', '#ffffff', '#bfefff'],
  exlibris: ['#050505', '#2a2a2a', '#111111'],
};
export function tailSvg(t: Tier): string {
  const [d, l, m] = TAIL[t];
  const k = `lgt${++uid}`;
  const edge = t === 'exlibris' ? 'stroke="#D4AF37" stroke-width=".7"' : 'stroke="rgba(0,0,0,.25)" stroke-width=".4"';
  return `<svg viewBox="0 0 6 12" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${k}" x1="0" x2="1"><stop offset="0" stop-color="${l}"/><stop offset=".25" stop-color="${m}"/><stop offset="1" stop-color="${d}"/></linearGradient></defs><path d="M.3 0H5.7V11.7L3 8.7L.3 11.7Z" fill="url(#${k})" ${edge}/><line x1="1" y1="1" x2="1" y2="9" stroke="rgba(255,255,255,.5)" stroke-width=".6"/></svg>`;
}

/** The engraving as a data: URL, for an SVG that is drawn to a canvas (it cannot fetch). */
export async function engravingDataUrl(t: Tier): Promise<string> {
  const blob = await (await fetch(engravingUrl(t))).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
