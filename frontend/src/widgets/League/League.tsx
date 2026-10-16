/** Reading leagues in the app: the card in the profile, the collection of
 * bookmarks, the slim bookmark beside a name, and the once-only «new league»
 * screen with its story. The rules live in app/services/leagues.py. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiGet, track, useI18n, type League, type LeagueTierKey, type Locale } from '@/shared/lib';
import { Sheet } from '@/widgets/RoundToday';
import { TIERS, TIER_PCT, engravingDataUrl, glyphSvg, markSvg, type Tier } from './mark';
import styles from './League.module.css';

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,700&family=Cormorant+SC:wght@700&display=swap';
const SAMPLE = 'Aa Яя Әә Ғғ Ққ Ңң Өө Ұұ Үү Һһ Іі 0123456789';

let fontsPending: Promise<void> | null = null;
/** The bookmark's engraved words are Cormorant; never waits long, falls back to Georgia. */
export function loadLeagueFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
  fontsPending ??= (async () => {
    if (!document.querySelector('link[data-league-fonts]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = FONT_HREF;
      link.dataset.leagueFonts = '1';
      document.head.appendChild(link);
    }
    const loaded = Promise.all([
      document.fonts.load('italic 700 40px "Cormorant Garamond"', SAMPLE),
      document.fonts.load('700 40px "Cormorant SC"', SAMPLE),
    ]).then(
      () => undefined,
      () => undefined,
    );
    await Promise.race([loaded, new Promise<void>((r) => window.setTimeout(r, 3500))]);
  })();
  return fontsPending;
}

function useLeagueFonts() {
  const [, setReady] = useState(0);
  useEffect(() => {
    let live = true;
    loadLeagueFonts().then(() => live && setReady((n) => n + 1));
    return () => {
      live = false;
    };
  }, []);
}

export function monthName(year: number, month: number, locale: Locale): string {
  try {
    const s = new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : locale, { month: 'long' }).format(new Date(year, month - 1, 15));
    return s.charAt(0).toLowerCase() + s.slice(1);
  } catch {
    return String(month);
  }
}

function useDays() {
  const { t, locale } = useI18n();
  return (n: number) => {
    if (locale === 'ru') {
      const m10 = n % 10;
      const m100 = n % 100;
      const w = m10 === 1 && m100 !== 11 ? 'lg.day1' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'lg.day2' : 'lg.day5';
      return `${n} ${t(w)}`;
    }
    return `${n} ${t(n === 1 ? 'lg.day1' : 'lg.day2')}`;
  };
}

/** The long bookmark with its engraving, the league and the reader's name engraved below. */
export function LeagueMark({ tier, name, since, px }: { tier: LeagueTierKey; name: string; since?: number | null; px: number }) {
  const { t } = useI18n();
  const html = useMemo(
    () => markSvg(tier as Tier, px, { label: t(`league.${tier}`), name, since: since ? t('lg.since', { y: since }) : undefined }),
    [tier, px, name, since, t],
  );
  return <span className={styles.mark} style={{ width: px, height: px * 3 }} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The slim bookmark worn beside a reader's name. */
export function LeagueGlyph({ tier, onAvatar = false }: { tier: LeagueTierKey; onAvatar?: boolean }) {
  const { t } = useI18n();
  const html = useMemo(() => glyphSvg(tier as Tier), [tier]);
  return <span className={onAvatar ? styles.onAvatar : styles.glyph} title={t(`league.${tier}`)} role="img" aria-label={t(`league.${tier}`)} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function useLeague() {
  const [league, setLeague] = useState<League | null>(null);
  useEffect(() => {
    let live = true;
    apiGet<League>('/insights/league', { requireAuth: true }).then(({ data }) => live && data && setLeague(data));
    return () => {
      live = false;
    };
  }, []);
  return league;
}

/** The profile's league: the bookmark, why, what keeps or lifts it this circle, and the door to the collection. */
export function LeagueCard({ league, name }: { league: League; name: string }) {
  const { t, locale } = useI18n();
  const days = useDays();
  const [open, setOpen] = useState(false);
  useLeagueFonts();
  const p = league.progress;
  const tier = league.tier;
  const month = p ? monthName(p.year, p.month, locale) : '';
  const basis = league.based_on;
  let line: string | null = null;
  let warn = false;
  if (p?.keep) {
    warn = true;
    line = p.keep.reachable ? t('lg.keep', { tier: t(`league.${p.keep.tier}`), days: days(p.keep.days) }) : t('lg.keepLost');
  } else if (p?.next) {
    line = t('lg.next', { tier: t(`league.${p.next.tier}`), days: days(p.next.days) });
  } else if (league.exlibris_in) {
    line = t('lg.exlibrisIn', { n: league.exlibris_in });
  }
  const share = p ? Math.min(100, (p.scored / Math.max(1, p.total)) * 100) : 0;

  return (
    <section className={styles.card}>
      {tier ? (
        <div className={styles.cardMark}>
          <LeagueMark tier={tier} name={name} since={league.since_year} px={52} />
        </div>
      ) : (
        <div className={styles.cardEmpty} aria-hidden="true" dangerouslySetInnerHTML={{ __html: glyphSvg('bronze') }} />
      )}
      <div className={styles.cardBody}>
        <div className={styles.kicker}>{p ? t('lg.title', { month }) : t('insights.league')}</div>
        <div className={styles.cardTier}>{tier ? t(`league.${tier}`) : '—'}</div>
        {basis && basis.scored > 0 && (
          <div className={styles.cardBasis}>
            {t('lg.basis', { n: basis.scored, total: basis.total, inMonth: t(`month.in.${basis.month}`) })}
          </div>
        )}
        {!tier && <div className={styles.cardBasis}>{t('lg.none')}</div>}
        {p && line && (
          <>
            <div className={styles.bar}>
              <i style={{ width: `${share}%` }} />
            </div>
            <div className={`${styles.cardLine} ${warn ? styles.warn : ''}`}>{line}</div>
          </>
        )}
        <button type="button" className={styles.door} onClick={() => setOpen(true)}>
          {t('lg.mine')} <span aria-hidden="true">›</span>
        </button>
      </div>
      <CollectionSheet open={open} onClose={() => setOpen(false)} league={league} name={name} />
    </section>
  );
}

function CollectionSheet({ open, onClose, league, name }: { open: boolean; onClose: () => void; league: League; name: string }) {
  const { t, locale } = useI18n();
  const held = new Map(league.collection.map((h) => [h.tier, h]));
  return (
    <Sheet open={open} onClose={onClose} label={t('lg.mine')}>
      <h3 className={styles.sheetTitle}>{t('lg.mine')}</h3>
      <p className={styles.sheetLead}>{t('lg.mineHint')}</p>
      <div className={styles.grid}>
        {TIERS.map((tier) => {
          const h = held.get(tier);
          const need =
            tier === 'exlibris' ? t('lg.needEx') : tier === 'diamond' ? t('lg.needDiamond', { pct: TIER_PCT.diamond }) : t('lg.need', { pct: TIER_PCT[tier] });
          return (
            <div key={tier} className={`${styles.cell} ${h ? '' : styles.locked}`}>
              <div className={styles.cellMark}>
                <LeagueMark tier={tier} name={name} since={league.since_year} px={78} />
              </div>
              <b>{t(`league.${tier}`)}</b>
              <small>{h ? `${monthName(h.year, h.month, locale)} ${h.year}` : need}</small>
            </div>
          );
        })}
      </div>
      <h4 className={styles.rulesTitle}>{t('lg.rules')}</h4>
      <ul className={styles.rules}>
        <li>{t('lg.rule1')}</li>
        <li>{t('lg.rule2')}</li>
        <li>{t('lg.rule3')}</li>
        <li>{t('lg.rule4')}</li>
      </ul>
      <button type="button" className={styles.close} onClick={onClose}>
        {t('lg.done')}
      </button>
    </Sheet>
  );
}

const seenKey = (id: string) => `pb.league.seen.${id}`;
const INTRO_KEY = 'pb.league.intro';

/** Once per circle that raised the reader (and once ever, at the launch, for everyone already in a league). */
export function LeaguePromo({ league, name }: { league: League | null; name: string }) {
  const { t, locale } = useI18n();
  const days = useDays();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<File | null>(null);
  useLeagueFonts();

  const promoted = !!league?.promoted_round_id;
  const id = league?.promoted_round_id ?? league?.based_on?.round_id ?? null;
  useEffect(() => {
    if (!league?.tier || !id) return;
    try {
      if (localStorage.getItem(seenKey(id))) return;
      if (!promoted && localStorage.getItem(INTRO_KEY)) return;
    } catch {
      return;
    }
    setShow(true);
    track('league_promo', { tier: league.tier, promoted: promoted ? 1 : 0 });
  }, [league, id, promoted]);

  useEffect(() => {
    if (!show || !league?.tier) return;
    loadLeagueFonts()
      .then(() => drawLeagueStory(league, name, t, locale))
      .then((f) => (file.current = f))
      .catch(() => undefined);
  }, [show, league, name, t, locale]);

  if (!show || !league?.tier || !id) return null;
  const tier = league.tier;
  const b = league.based_on;

  const close = () => {
    try {
      localStorage.setItem(seenKey(id), '1');
      localStorage.setItem(INTRO_KEY, '1');
    } catch {
      /* private mode: shown again next time, nothing lost */
    }
    setShow(false);
  };
  const share = async () => {
    setBusy(true);
    try {
      const f = file.current ?? (await drawLeagueStory(league, name, t, locale));
      if (f && navigator.canShare?.({ files: [f] })) {
        try {
          await navigator.share({ files: [f] });
          track('league_share', { tier, method: 'share' });
        } catch {
          /* closed the sheet */
        }
      } else if (f) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(f);
        a.download = f.name;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        track('league_share', { tier, method: 'download' });
      }
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className={styles.promo} role="dialog" aria-modal="true" aria-label={t(promoted ? 'lg.new' : 'lg.yours')}>
      <div className={styles.promoKicker}>{t(promoted ? 'lg.new' : 'lg.yours')}</div>
      <div className={styles.promoTier}>{t(`league.${tier}`)}</div>
      <div className={styles.promoMark}>
        <LeagueMark tier={tier} name={name} since={league.since_year} px={128} />
      </div>
      {b && (
        <div className={styles.promoBasis}>
          {t('lg.promoBasis', { n: b.scored, total: b.total, inMonth: t(`month.in.${b.month}`) })}
        </div>
      )}
      {league.progress?.next && (
        <div className={styles.promoNext}>{t('lg.next', { tier: t(`league.${league.progress.next.tier}`), days: days(league.progress.next.days) })}</div>
      )}
      <div className={styles.promoActions}>
        <button type="button" className={styles.primary} onClick={share} disabled={busy}>
          {t('lg.share')}
        </button>
        <button type="button" className={styles.ghost} onClick={close}>
          {t('lg.done')}
        </button>
      </div>
    </div>,
    document.body,
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** The story, 1080×1920: navy, the league's name, the bookmark, the circle it came from, our address. */
export async function drawLeagueStory(
  league: League,
  name: string,
  t: (k: string, p?: Record<string, string | number>) => string,
  _locale: Locale,
): Promise<File | null> {
  const tier = league.tier as Tier | null;
  if (!tier) return null;
  const W = 1080;
  const H = 1920;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const bg = ctx.createRadialGradient(W / 2, 760, 60, W / 2, 760, 1200);
  bg.addColorStop(0, '#173a4f');
  bg.addColorStop(0.7, '#0B1C26');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#8fa3af';
  ctx.font = '600 34px system-ui, -apple-system, sans-serif';
  ctx.fillText(t(league.promoted_round_id ? 'lg.new' : 'lg.yours').toUpperCase().split('').join(' '), W / 2, 190);
  ctx.fillStyle = '#f6f8fa';
  ctx.font = 'italic 700 120px "Cormorant Garamond", Georgia, serif';
  ctx.fillText(t(`league.${tier}`), W / 2, 330);

  // the bookmark without its words (an SVG image cannot use the page's fonts); the words are written below
  const px = 300;
  const u = px / 100; // one bookmark unit in pixels
  // the ribbon hangs outside the 100×300 box: widen the picture so it is not cut off
  const svg = markSvg(tier, px, null, await engravingDataUrl(tier), false)
    .replace(/filter:[^;"]*;?/, '')
    .replace(`width="${px}" height="${px * 3}" viewBox="0 0 100 300"`, `width="${120 * u}" height="${318 * u}" viewBox="-4 -14 120 318"`);
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const x0 = (W - px) / 2;
  const y0 = 430;
  ctx.save();
  ctx.shadowColor = tier === 'bronze' ? 'rgba(0,0,0,.5)' : tier === 'silver' ? 'rgba(220,235,255,.35)' : tier === 'diamond' ? 'rgba(150,215,255,.7)' : 'rgba(255,190,60,.6)';
  ctx.shadowBlur = 60;
  ctx.drawImage(img, x0 - 4 * u, y0 - 14 * u, 120 * u, 318 * u);
  ctx.restore();

  const ink = tier === 'exlibris' ? '#f3d27a' : { bronze: '#2a1406', silver: '#2a3036', gold: '#4a2c00', diamond: '#163a5a' }[tier];
  const engrave = (txt: string, y: number, font: string, spacing = 0) => {
    ctx.font = font;
    const s = spacing ? txt.toUpperCase().split('').join(String.fromCharCode(0x200a)) : txt;
    if (tier !== 'exlibris') {
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      ctx.fillText(s, W / 2, y0 + (y + 0.45) * u);
    }
    ctx.fillStyle = ink;
    ctx.fillText(s, W / 2, y0 + y * u);
  };
  const nfs = Math.min(12.5, 70 / (Math.max(name.length, 5) * 0.47));
  engrave(t(`league.${tier}`), 221, `700 ${7.6 * u}px "Cormorant SC", Georgia, serif`, 1);
  engrave(name, 252, `italic 700 ${nfs * u}px "Cormorant Garamond", Georgia, serif`);
  if (league.since_year) engrave(t('lg.since', { y: league.since_year }).toUpperCase(), 262, `700 ${5.6 * u}px "Cormorant SC", Georgia, serif`);

  const b = league.based_on;
  if (b) {
    ctx.fillStyle = '#c9d4da';
    ctx.font = '500 44px system-ui, -apple-system, sans-serif';
    ctx.fillText(t('lg.promoBasis', { n: b.scored, total: b.total, inMonth: t(`month.in.${b.month}`) }), W / 2, 1450);
  }
  ctx.fillStyle = '#F26430';
  ctx.font = '700 44px system-ui, -apple-system, sans-serif';
  ctx.fillText('powerbook.kz', W / 2, 1780);

  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92));
  return blob ? new File([blob], `powerbook-${tier}.jpg`, { type: 'image/jpeg' }) : null;
}
