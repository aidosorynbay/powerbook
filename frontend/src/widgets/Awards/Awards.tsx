/** Awards in the app: the card in the profile, the whole showcase, one award up close, the moment new ones
 * arrive (once, on whichever phone or browser opens next) and the story. Each award is an enamel pin on the
 * bookcloth; which awards exist and when each is earned lives in app/services/awards.py.
 *
 * What the council of 2026-10-18 asked for: the number first and the name as its caption; no «17 из 44» and no
 * album of grey holes — what was lived, and one next step on each line; «вы и ещё 12 читателей» (company, not a
 * place); the story says the fact and the day, not how rare it is. */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, track, useI18n, type AwardEarned, type Awards, type Locale } from '@/shared/lib';
import { Sheet } from '@/widgets/RoundToday';
import { dayLink } from '@/widgets/ShareDay';
import { loadLeagueFonts } from '@/widgets/League';
import { MILLION, SPECIAL, TRACKS, TRACK_ORDER, pinLarge, pinSmall, trackOf } from './catalog';
import styles from './Awards.module.css';

type T = (k: string, p?: Record<string, string | number>) => string;

/** How many holders still make an award rare enough to say so. */
const RARE = 40;

/** Shown to admins first, as «?» was (founder, 2026-10-16): flip to show every reader. */
export const FOR_EVERYONE = false;
export function awardsOn(user: { system_role?: string } | null | undefined): boolean {
  return FOR_EVERYONE || user?.system_role === 'admin' || user?.system_role === 'superadmin';
}

/** The reader's awards, fetched again after every saved day (a new award is often earned right then). */
export function useAwards(enabled = true) {
  const [awards, setAwards] = useState<Awards | null>(null);
  const load = useCallback(() => {
    apiGet<Awards>('/insights/awards', { requireAuth: true }).then(({ data }) => data && setAwards(data));
  }, []);
  useEffect(() => {
    if (!enabled) return;
    load();
    window.addEventListener('pb:minutes-saved', load);
    return () => window.removeEventListener('pb:minutes-saved', load);
  }, [enabled, load]);
  return { awards, reload: load };
}

function plural(locale: Locale, n: number, one: string, few: string, many: string) {
  if (locale !== 'ru') return n === 1 ? one : few;
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}

function useWords() {
  const { t, locale } = useI18n();
  return useMemo(() => {
    // the site's own month names: Chrome writes «M10 17» for kk-KZ (2026-10-17)
    const date = (iso: string) => {
      const [y, m, d] = iso.split('-').map(Number);
      return m ? t('aw.date', { d, m: t(`month.gen.${m}`), y }) : iso;
    };
    const num = (n: number) => n.toLocaleString(locale === 'en' ? 'en-US' : 'ru-RU');
    const days = (n: number) => `${num(n)} ${t(plural(locale, n, 'lg.day1', 'lg.day2', 'lg.day5'))}`;
    const daysWord = (n: number) => t(plural(locale, n, 'lg.day1', 'lg.day2', 'lg.day5'));
    // company, not a place: «вы и ещё 12 читателей»; never a percent, never «из 916»; under five others no number
    // (with 53 readers in a circle, «вы и ещё 2» points at people — council, 2026-10-18)
    // and only for the rare ones: «вы и ещё 900» says nothing (research, 2026-10-18)
    const company = (n: number): string | null => {
      if (n > RARE) return null;
      const others = Math.max(0, n - 1);
      if (others === 0) return t('aw.onlyYou');
      if (others < 5) return t('aw.withFew');
      return t(plural(locale, others, 'aw.withYou1', 'aw.withYou2', 'aw.withYou5'), { m: num(others) });
    };
    const already = (n: number) => t(plural(locale, n, 'aw.already1', 'aw.already2', 'aw.already5'), { n: num(n) });
    const millions = (minutes: number) => (minutes / MILLION).toLocaleString(locale === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: 1 });
    return { date, num, days, daysWord, company, already, millions };
  }, [t, locale]);
}
type Words = ReturnType<typeof useWords>;

/** One pin. Not yet earned: the same pin, dimmed to its shape. */
export function AwardPin({ k, size, locked = false, big = false, onClick, label }: {
  k: string;
  size: number;
  locked?: boolean;
  big?: boolean;
  onClick?: () => void;
  label?: string;
}) {
  const style = { '--pin': `${size}px` } as CSSProperties;
  const body = <img src={big ? pinLarge(k) : pinSmall(k)} alt="" loading={big ? 'eager' : 'lazy'} decoding="async" draggable={false} />;
  const cls = `${styles.pin} ${locked ? styles.locked : ''}`;
  return onClick ? (
    <button type="button" className={cls} style={style} onClick={onClick} aria-label={label}>
      {body}
    </button>
  ) : (
    <span className={cls} style={style} role={label ? 'img' : undefined} aria-label={label}>
      {body}
    </span>
  );
}

/** «по 30+ минут · с 1 апреля 2021»: the day of the first pin, the start of the chronicle. */
function sinceLine(t: T, w: Words, awards: Awards): string {
  const first = awards.earned.find((e) => e.key === 'days_1');
  if (first) return t('aw.heroFrom', { date: w.date(first.on) });
  return awards.since ? t('aw.heroSince', { y: awards.since }) : t('aw.heroLine');
}

const nameOf = (t: T, key: string) => t(`aw.${key}.name`);
const condOf = (t: T, key: string) => t(`aw.${key}.cond`);

/** Where a track stands towards its next pin, in its own words. */
function progressLine(t: T, w: Words, tr: string, now: number, next: number): string {
  if (tr === 'days') return t('aw.left.days', { left: w.days(next - now) });
  if (tr === 'minutes') return t('aw.left.minutes', { left: w.num(next - now) });
  if (tr === 'streak') return t('aw.left.streak', { now: w.num(now), next: w.num(next) });
  if (tr === 'clean') return t('aw.left.clean', { now: w.num(now), next: w.num(next) });
  return t('aw.left.together', { now: w.millions(now), next: w.num(next) });
}
function share01(tr: string, now: number, next: number) {
  return Math.max(0, Math.min(1, tr === 'together' ? now / (next * MILLION) : now / next));
}

/** Five dots, as in the logo, as many filled as the pin is rare (1 = most readers have it). Quiet: no number, no percent. */
export function Rarity({ n }: { n: number }) {
  const { t } = useI18n();
  return (
    <span className={styles.dots} role="img" aria-label={t('aw.rarity', { n })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= n ? styles.dotOn : styles.dotOff} />
      ))}
    </span>
  );
}

/** The profile's awards: the days of 30+ minutes as the hero with their step as a caption, the newest pins,
 * the door to all of them. */
async function setHidden(hidden: boolean) {
  track(hidden ? 'awards_hide' : 'awards_unhide', {});
  await apiPost('/insights/awards/hidden', { hidden }, { requireAuth: true });
}

export function AwardsCard({ awards, name, username, onChange }: { awards: Awards; name: string; username: string; onChange?: () => void }) {
  const { t, locale } = useI18n();
  const w = useWords();
  const [sheet, setSheet] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  if (awards.hidden) {
    return (
      <p className={styles.hiddenLine}>
        {t('aw.hiddenLine')}
        <button type="button" onClick={() => setHidden(false).then(() => onChange?.())}>
          {t('aw.show')}
        </button>
      </p>
    );
  }
  const daysTrack = awards.tracks.find((x) => x.track === 'days');
  const days = daysTrack?.value ?? 0;
  const recent = [...awards.earned].sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0)).slice(0, 8);
  const open = (key: string) => {
    setPicked(key);
    track('award_open', { key, from: 'card' });
  };
  const hero = awards.title ?? 'days_1';

  return (
    <section className={styles.card} aria-label={t('aw.title')}>
      <div className={styles.cardHead}>
        <span className={styles.kicker}>{t('aw.title')}</span>
        {awards.earned.length > 0 && (
          <span className={styles.count}>{t(plural(locale, awards.earned.length, 'aw.count1', 'aw.count2', 'aw.count5'), { n: awards.earned.length })}</span>
        )}
      </div>
      <div className={styles.hero}>
        <AwardPin k={hero} size={84} locked={!awards.title} onClick={() => open(hero)} label={nameOf(t, hero)} />
        <div className={styles.heroBody}>
          <div className={styles.heroNum}>
            {w.num(days)} <span>{w.daysWord(days)}</span>
          </div>
          <div className={styles.heroLine}>{sinceLine(t, w, awards)}</div>
          <div className={styles.heroName}>{awards.title ? t('aw.step', { name: nameOf(t, awards.title) }) : t('aw.firstStep')}</div>
          {daysTrack?.next ? (
            <>
              <div className={styles.bar} aria-hidden="true">
                <i style={{ width: `${share01('days', days, daysTrack.next) * 100}%` }} />
              </div>
              <div className={styles.heroNext}>{t('aw.nextStep', { name: nameOf(t, `days_${daysTrack.next}`), left: w.days(daysTrack.next - days) })}</div>
            </>
          ) : (
            <div className={styles.heroNext}>{t('aw.ladderDone')}</div>
          )}
        </div>
      </div>
      {recent.length > 0 && (
        <div className={styles.strip}>
          {recent.map((e) => (
            <AwardPin key={e.key} k={e.key} size={54} onClick={() => open(e.key)} label={nameOf(t, e.key)} />
          ))}
        </div>
      )}
      <button type="button" className={styles.door} onClick={() => { setSheet(true); track('awards_open', { from: 'card' }); }}>
        {t('aw.all')} <span aria-hidden="true">›</span>
      </button>
      <AwardsSheet
        open={sheet}
        onClose={() => setSheet(false)}
        awards={awards}
        onPick={(k) => { setPicked(k); track('award_open', { key: k, from: 'sheet' }); }}
        onHide={() => { setSheet(false); setHidden(true).then(() => onChange?.()); }}
      />
      <AwardDetail award={picked} onClose={() => setPicked(null)} awards={awards} name={name} username={username} />
    </section>
  );
}

/** Every award held, track by track, and one next step on each line — never a wall of what is missing. */
export function AwardsSheet({ open, onClose, awards, onPick, onHide, title }: {
  open: boolean;
  onClose: () => void;
  awards: Awards;
  onPick: (k: string) => void;
  onHide?: () => void;
  title?: string;
}) {
  const { t } = useI18n();
  const w = useWords();
  const held = new Map(awards.earned.map((e) => [e.key, e]));
  const secretsHeld = SPECIAL.filter((k) => held.has(k));
  return (
    <Sheet open={open} onClose={onClose} label={title ?? t('aw.mine')}>
      <h3 className={styles.sheetTitle}>{title ?? t('aw.mine')}</h3>
      {!title && <p className={styles.sheetLead}>{t('aw.mineHint')}</p>}
      {TRACK_ORDER.map((tr) => {
        const st = awards.tracks.find((x) => x.track === tr);
        const mine = TRACKS[tr].map((n) => `${tr}_${n}`).filter((k) => held.has(k));
        const next = st?.next ?? null;
        const ahead = next ? TRACKS[tr].filter((n) => n > next).length : 0;
        if (!mine.length && !next) return null;
        return (
          <section key={tr} className={styles.track}>
            <h4 className={styles.trackTitle}>{t(`aw.track.${tr}`)}</h4>
            <p className={styles.trackHint}>{t(`aw.track.${tr}.hint`)}</p>
            <div className={styles.grid}>
              {mine.map((key) => (
                <button type="button" key={key} className={styles.cell} onClick={() => onPick(key)}>
                  <AwardPin k={key} size={76} />
                  <b>{nameOf(t, key)}</b>
                  <small>{w.date(held.get(key)!.on)}</small>
                </button>
              ))}
              {next && st && (
                <button type="button" className={`${styles.cell} ${styles.cellNext}`} onClick={() => onPick(`${tr}_${next}`)}>
                  <AwardPin k={`${tr}_${next}`} size={76} locked />
                  <b>{nameOf(t, `${tr}_${next}`)}</b>
                  <span className={styles.miniBar} aria-hidden="true">
                    <i style={{ width: `${share01(tr, st.now, next) * 100}%` }} />
                  </span>
                  <small>{progressLine(t, w, tr, st.now, next)}</small>
                </button>
              )}
            </div>
            {ahead > 0 && <p className={styles.ahead}>{t('aw.ahead', { n: ahead })}</p>}
          </section>
        );
      })}
      <section className={styles.track}>
        <h4 className={styles.trackTitle}>{t('aw.track.special')}</h4>
        <p className={styles.trackHint}>{t('aw.secretHint')}</p>
        {secretsHeld.length > 0 && (
          <div className={styles.grid}>
            {secretsHeld.map((key) => (
              <button type="button" key={key} className={styles.cell} onClick={() => onPick(key)}>
                <AwardPin k={key} size={76} />
                <b>{nameOf(t, key)}</b>
                <small>{w.date(held.get(key)!.on)}</small>
              </button>
            ))}
          </div>
        )}
      </section>
      <p className={styles.trackHint}>{t('aw.aiNote')}</p>
      <button type="button" className={styles.close} onClick={onClose}>
        {t('lg.done')}
      </button>
      {onHide && (
        <p className={styles.hideRow}>
          <button type="button" onClick={onHide}>{t('aw.hide')}</button>
          <span>{t('aw.hideHint')}</span>
        </p>
      )}
    </Sheet>
  );
}

/** One award up close: the pin, what it is for, when it came, who else got there, and its story. */
export function AwardDetail({ award, onClose, awards, name, username, readOnly = false }: {
  award: string | null;
  onClose: () => void;
  awards: Awards;
  name: string;
  username: string;
  readOnly?: boolean;
}) {
  const { t, locale } = useI18n();
  const w = useWords();
  const [busy, setBusy] = useState(false);
  const e = award ? awards.earned.find((x) => x.key === award) : undefined;
  if (!award) return null;
  const { track: tr, n } = trackOf(award);
  const st = awards.tracks.find((x) => x.track === tr);
  const share = async () => {
    if (!e) return;
    setBusy(true);
    try {
      await shareAward(e, { name, username, t, locale, w });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose} label={nameOf(t, award)}>
      <div className={styles.detail}>
        <div className={`${styles.detailPin} ${e ? styles.shine : ''}`}>
          <AwardPin k={award} size={232} big locked={!e} />
        </div>
        <div className={styles.detailName}>{nameOf(t, award)}</div>
        <p className={styles.detailCond}>{condOf(t, award)}</p>
        {e ? (
          <>
            <p className={styles.detailMeta}>{t('aw.earnedOn', { date: w.date(e.on) })}</p>
            <p className={styles.detailMeta}><Rarity n={e.rarity} /></p>
            {readOnly ? (
              <p className={styles.detailMeta}>{w.already(e.holders)}</p>
            ) : (
              w.company(e.holders) && <p className={styles.detailMeta}>{w.company(e.holders)}</p>
            )}
            {!readOnly && (
              <button type="button" className={styles.primary} onClick={share} disabled={busy}>
                {t('aw.share')}
              </button>
            )}
          </>
        ) : (
          st &&
          tr !== 'special' && (
            <>
              <div className={styles.bar} aria-hidden="true">
                <i style={{ width: `${share01(tr, st.now, n) * 100}%` }} />
              </div>
              <p className={styles.detailMeta}>{progressLine(t, w, tr, st.now, n)}</p>
              {awards.holders[award] > 0 && <p className={styles.detailMeta}>{w.already(awards.holders[award])}</p>}
            </>
          )
        )}
        <button type="button" className={styles.close} onClick={onClose}>
          {t('lg.done')}
        </button>
      </div>
    </Sheet>
  );
}

/** Wait until no other window is open (the league's screen, a sheet): one celebration at a time. */
function useQuietMoment(want: boolean) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    if (!want) return;
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      if (!document.querySelector('[role="dialog"][aria-modal="true"]') || tries > 40) {
        window.clearInterval(id);
        setReady(true);
      }
    }, 900);
    return () => window.clearInterval(id);
  }, [want]);
  return want && ready;
}

/**
 * The moment awards arrive. The first time — or whenever many come at once, as when an archive nickname is
 * claimed — one screen: the days read, then the pins pouring onto the cloth, then the step of the ladder.
 * Otherwise each new award once, the day it is earned (after the minutes that earned it are saved).
 */
export function AwardsMoment({ awards, name, username, onSeen }: { awards: Awards | null; name: string; username: string; onSeen?: () => void }) {
  const { t, locale } = useI18n();
  const w = useWords();
  const fresh = useMemo(() => (awards && !awards.hidden ? awards.earned.filter((e) => e.new) : []), [awards]);
  const want = !!awards && fresh.length > 0;
  const show = useQuietMoment(want);
  const [closed, setClosed] = useState<string>('');
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const sig = fresh.map((e) => e.key).join(',');
  const logged = useRef('');
  const reveal = !!awards && ((awards.first_time && fresh.length > 1) || fresh.length > 3);

  useEffect(() => {
    if (show && sig && logged.current !== sig) {
      logged.current = sig;
      track(reveal ? 'awards_reveal' : 'award_new', { n: fresh.length, key: fresh[0]?.key ?? '', first: awards?.first_time ? 1 : 0 });
    }
  }, [show, sig, awards, fresh, reveal]);

  if (!show || !awards || closed === sig) return null;

  const done = () => {
    setClosed(sig);
    setI(0);
    apiPost('/insights/awards/seen', { keys: fresh.map((e) => e.key) }, { requireAuth: true }).then(() => onSeen?.());
  };
  const shareOne = async (e: AwardEarned) => {
    setBusy(true);
    try {
      await shareAward(e, { name, username, t, locale, w });
    } finally {
      setBusy(false);
    }
  };

  if (reveal) {
    const days = awards.tracks.find((x) => x.track === 'days')?.value ?? 0;
    const hero = fresh.find((e) => e.key === awards.title) ?? fresh[fresh.length - 1];
    const shown = [...fresh].sort((a, b) => (a.on < b.on ? -1 : 1));
    const first = awards.first_time;
    return createPortal(
      <div className={styles.night} role="dialog" aria-modal="true" aria-label={t('aw.mine')}>
        <div className={styles.nightKicker}>{first ? t('aw.revealKicker') : t('aw.revealMore')}</div>
        {first ? (
          <>
            <div className={styles.nightNum}>
              {w.num(days)} <span>{w.daysWord(days)}</span>
            </div>
            <div className={styles.nightLine}>{sinceLine(t, w, awards)}</div>
          </>
        ) : (
          <div className={styles.nightNum}>+{fresh.length}</div>
        )}
        <div className={styles.nightCount}>{t(plural(locale, fresh.length, 'aw.revealTitle1', 'aw.revealTitle2', 'aw.revealTitle5'), { n: fresh.length })}</div>
        <div className={styles.revealGrid}>
          {shown.slice(0, 24).map((e, k) => (
            <span key={e.key} className={styles.revealCell} style={{ animationDelay: `${0.35 + k * 0.07}s` }}>
              <AwardPin k={e.key} size={64} label={nameOf(t, e.key)} />
            </span>
          ))}
          {shown.length > 24 && <span className={styles.revealMore}>+{shown.length - 24}</span>}
        </div>
        <div className={styles.revealHero} style={{ animationDelay: `${0.5 + Math.min(24, shown.length) * 0.07}s` }}>
          <div className={styles.nightLabel}>{t('aw.revealHero')}</div>
          <div className={styles.nightName}>{nameOf(t, hero.key)}</div>
          <div className={styles.nightCond}>{condOf(t, hero.key)}</div>
        </div>
        {!awards.has_archive && (awards.since ?? 0) >= 2024 && (
          <Link to="/insights#claim" className={styles.archiveHint} onClick={done}>
            {t('aw.archiveHint')}
          </Link>
        )}
        <div className={styles.nightActions}>
          <button type="button" className={styles.primary} onClick={() => shareOne(hero)} disabled={busy}>
            {t('aw.share')}
          </button>
          <button type="button" className={styles.ghost} onClick={done}>
            {t('aw.revealDone')}
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  const e = fresh[Math.min(i, fresh.length - 1)];
  const last = i >= fresh.length - 1;
  return createPortal(
    <div className={styles.night} role="dialog" aria-modal="true" aria-label={t('aw.new')}>
      <div className={styles.nightKicker}>{fresh.length > 1 ? t('aw.newOf', { i: i + 1, n: fresh.length }) : t('aw.new')}</div>
      <div key={e.key} className={`${styles.nightPin} ${styles.shine}`}>
        <AwardPin k={e.key} size={248} big label={nameOf(t, e.key)} />
      </div>
      <div className={styles.nightName}>{nameOf(t, e.key)}</div>
      <div className={styles.nightCond}>{condOf(t, e.key)}</div>
      <div className={styles.nightMeta}>{t('aw.earnedOn', { date: w.date(e.on) })}</div>
      <div className={styles.nightMeta}><Rarity n={e.rarity} /></div>
      {w.company(e.holders) && <div className={styles.nightMeta}>{w.company(e.holders)}</div>}
      <div className={styles.nightActions}>
        <button type="button" className={styles.primary} onClick={() => shareOne(e)} disabled={busy}>
          {t('aw.share')}
        </button>
        <button type="button" className={styles.ghost} onClick={() => (last ? done() : setI(i + 1))}>
          {last ? t('lg.done') : t('aw.nextOne')}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** For admins on another reader's page: their awards as they would see them, to check against the old tables
 * before the awards go to everyone. Nothing is written, nothing is shared. */
export function AwardsPeek({ userId, name }: { userId: string; name: string }) {
  const { t } = useI18n();
  const [awards, setAwards] = useState<Awards | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const load = () => {
    setOpen(true);
    if (!awards) apiGet<Awards>(`/insights/awards/of/${userId}`, { requireAuth: true }).then(({ data }) => data && setAwards(data));
  };
  return (
    <>
      <button type="button" className={styles.peek} onClick={load}>
        {t('aw.peek')} <span aria-hidden="true">›</span>
      </button>
      {awards && (
        <AwardsSheet open={open} onClose={() => setOpen(false)} awards={awards} onPick={setPicked} title={`${name} · ${t('aw.title')}`} />
      )}
      {awards && <AwardDetail award={picked} onClose={() => setPicked(null)} awards={awards} name={name} username="" readOnly />}
    </>
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

type ShareCtx = { name: string; username: string; t: T; locale: Locale; w: Words };

async function shareAward(e: AwardEarned, ctx: ShareCtx) {
  await loadLeagueFonts();
  const f = await drawAwardStory(e, ctx);
  if (f && navigator.canShare?.({ files: [f] })) {
    try {
      await navigator.share({ files: [f] });
      track('award_share', { key: e.key, method: 'share' });
    } catch {
      /* closed the sheet */
    }
  } else if (f) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    track('award_share', { key: e.key, method: 'download' });
  }
}

/** Lines no wider than maxWidth and as even as they can be: the narrowest width that still needs no more lines
 * («1000 дней чтения / по 30+ минут», not «…по 30+ / минут»). */
function balanced(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines = wrap(ctx, text, maxWidth);
  let best = lines;
  for (let width = maxWidth - 20; width > maxWidth / 3; width -= 20) {
    const tried = wrap(ctx, text, width);
    if (tried.length > lines.length) break;
    best = tried;
  }
  return best;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The story, 1080×1920: the pin on its bookcloth, then the fact in plain words (someone outside PowerBook will
 * read it), the pin's name as its caption, the day, whose, and our address. Not how rare: a fact, not a boast.
 * Instagram covers the top ~250 px and the bottom ~340 px: nothing that matters lives there. */
export async function drawAwardStory(e: AwardEarned, ctx: ShareCtx): Promise<File | null> {
  const { t, w } = ctx;
  const W = 1080;
  const H = 1920;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#0B1C26';
  g.fillRect(0, 0, W, H);

  // the pin with its own cloth, its edges melting into the night of the story
  const img = await loadImage(pinLarge(e.key)).catch(() => null);
  const S = 740;
  const x0 = (W - S) / 2;
  const y0 = 250;
  if (img) {
    g.drawImage(img, x0, y0, S, S);
    const fade = (x: number, y: number, x2: number, y2: number) => {
      const lg = g.createLinearGradient(x, y, x2, y2);
      lg.addColorStop(0, 'rgba(11,28,38,1)');
      lg.addColorStop(1, 'rgba(11,28,38,0)');
      return lg;
    };
    const F = 150;
    g.fillStyle = fade(x0, 0, x0 + F, 0);
    g.fillRect(x0, y0, F, S);
    g.fillStyle = fade(x0 + S, 0, x0 + S - F, 0);
    g.fillRect(x0 + S - F, y0, F, S);
    g.fillStyle = fade(0, y0, 0, y0 + F);
    g.fillRect(x0, y0, S, F);
    g.fillStyle = fade(0, y0 + S, 0, y0 + S - F);
    g.fillRect(x0, y0 + S - F, S, F);
  }

  g.textAlign = 'center';
  g.fillStyle = '#8fa3af';
  g.font = '600 30px system-ui, -apple-system, sans-serif';
  g.fillText(t('aw.storyKicker').toUpperCase().split('').join(String.fromCharCode(0x200a)), W / 2, 228);

  // top to bottom, each line below the last: the fact first, big and plain; the pin's name under it; the day;
  // whose; our address — all above the bottom ~340 px that Instagram covers
  let y = 1076;
  g.fillStyle = '#f6f8fa';
  g.font = '800 66px system-ui, -apple-system, sans-serif';
  for (const line of balanced(g, condOf(t, e.key), 930).slice(0, 3)) {
    g.fillText(line, W / 2, y);
    y += 80;
  }
  y += 14;
  g.fillStyle = '#e8c27a';
  g.font = 'italic 700 60px "Cormorant Garamond", Georgia, serif';
  g.fillText(`«${nameOf(t, e.key)}»`, W / 2, y);
  y += 54;
  g.fillStyle = '#8fa3af';
  g.font = '500 32px system-ui, -apple-system, sans-serif';
  g.fillText(w.date(e.on), W / 2, y);
  y += 84;
  g.fillStyle = '#f6f8fa';
  g.font = 'italic 700 48px "Cormorant Garamond", Georgia, serif';
  g.fillText(ctx.name, W / 2, y);
  y += 56;
  g.fillStyle = '#F26430';
  g.font = '700 36px system-ui, -apple-system, sans-serif';
  g.fillText(ctx.username ? dayLink(ctx.username) : 'powerbook.kz', W / 2, y);

  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92));
  return blob ? new File([blob], `powerbook-${e.key}.jpg`, { type: 'image/jpeg' }) : null;
}
