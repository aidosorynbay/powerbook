/** «Битва кланов»: two teams, «Маяк» and «Парус», 14 days. Every member who
 * logs 30+ minutes before 00:00 brings a point; at midnight each point becomes a
 * book in the team's shared library. Open to anyone; only team numbers are public
 * (app/services/clan_war.py). Lives as the second tab of «Круг».
 * Layout after the council of 2026-10-17: one subtitle line, the pictures as the
 * hero, each team in its own colour, one status line, one strip; nothing twice. */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, getApiBaseUrl, track, useAuth, useI18n } from '@/shared/lib';
import { Container, PageTransition } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import { Sheet } from '@/widgets/RoundToday';
import { LeagueGlyph, loadLeagueFonts } from '@/widgets/League';
import type { LeagueTierKey } from '@/shared/lib/types';
import { TeamChat } from './TeamChat';
import styles from './WarPage.module.css';

type Person = { user_id: string; display_name: string; avatar: string | null; league?: LeagueTierKey | null };
type Day = { date: string; hits: number; size: number; locked: boolean };
type Team = { key: 'lighthouse' | 'sail'; size: number; hp: number; bricks: number; bricks_left: number; points: number; shelf: number; fill: number; today: number | null; members: Person[]; days: Day[] };
export type War = {
  id: string;
  start_date: string;
  end_date: string;
  status: 'signup' | 'live' | 'done';
  prize: string | null;
  days_total: number;
  day: number;
  joined_count: number;
  signup_until: string;
  starts_at: string;
  is_admin: boolean;
  me: { joined: boolean; team: Team['key'] | null; guest?: boolean; minutes?: number; hits?: number; days?: number; today?: boolean; shelf_today?: Person[]; ask_day?: boolean; minutes_yesterday?: number };
  joined: Person[];
  teams: Team[];
  winner: Team['key'] | 'draw' | null;
};

/** Seconds left until an ISO moment, ticking each second; 0 once it has passed. */
function useLeft(iso: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return iso ? Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000)) : 0;
}

const clock = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const x = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
};

const ART: Record<Team['key'], string> = { lighthouse: '/leagues/diamond.jpg', sail: '/leagues/bronze.jpg' };

export function useWar() {
  const [war, setWar] = useState<War | null>(null);
  const load = useCallback(() => {
    apiGet<War>('/war', { requireAuth: true }).then(({ data }) => data && setWar(data));
  }, []);
  useEffect(() => {
    load();
    // a page left open across 00:00 moves to the new day by itself (and the locked one shows its books)
    const tick = window.setInterval(() => document.visibilityState === 'visible' && load(), 60000);
    const back = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', back);
    // the circle's dial saved minutes: the card and the page show the book at once
    window.addEventListener('pb:minutes-saved', load);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('pb:minutes-saved', load);
    };
  }, [load]);
  return { war, setWar, load };
}

/** A face with the reader's league ring and bookmark tail, as everywhere else on the site. */
export function Avatar({ p }: { p: Person }) {
  return (
    <span className={styles.av} title={p.display_name}>
      {p.avatar ? <img src={`${getApiBaseUrl()}/social/avatar/${p.user_id}?v=${p.avatar}`} alt="" loading="lazy" /> : (p.display_name || '?').trim().charAt(0).toUpperCase()}
      {p.league && <LeagueGlyph tier={p.league} onAvatar face={32} />}
    </span>
  );
}

function dateRange(war: War, t: (k: string) => string) {
  const [, m1, d1] = war.start_date.split('-').map(Number);
  const [, m2, d2] = war.end_date.split('-').map(Number);
  return m1 === m2 ? `${d1}–${d2} ${t(`month.gen.${m2}`)}` : `${d1} ${t(`month.gen.${m1}`)} – ${d2} ${t(`month.gen.${m2}`)}`;
}

/** Which of the four pictures a library shows: its shelves fill as the team reads. */
const stage = (fill: number) => (fill < 25 ? 1 : fill < 50 ? 2 : fill < 75 ? 3 : 4);

function useBooks() {
  const { t, locale } = useI18n();
  return (n: number) =>
    locale === 'ru'
      ? `${n} ${t(n % 10 === 1 && n % 100 !== 11 ? 'war.book1' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'war.book2' : 'war.book5')}`
      : `${n} ${t('war.book5')}`;
}

/** Two cozy library corners, each in its team's colour; a tap opens the team. */
function Field({ war, live, onTeam }: { war: War; live: boolean; onTeam: (k: Team['key']) => void }) {
  const { t } = useI18n();
  const books = useBooks();
  return (
    <div className={styles.field}>
      {war.teams.map((x) => (
        <button
          key={x.key}
          type="button"
          className={`${styles.side} ${x.key === 'lighthouse' ? styles.sideA : styles.sideB} ${war.me.team === x.key ? styles.mine : ''}`}
          onClick={() => onTeam(x.key)}
        >
          <img src={`/war-art/${x.key}-${stage(x.fill)}.jpg`} alt="" />
          {war.me.team === x.key && <span className={styles.tag}>{t('war.yourTeam')}</span>}
          <span className={styles.sideLbl}>
            <b>{t(`war.team.${x.key}`)}</b>
            <span>
              {books(x.points)}
              {live && x.today ? <em> · +{x.today} {t('war.todayShort')}</em> : null}
            </span>
            <i className={styles.fillBar}><i style={{ width: `${Math.max(2, Math.min(100, x.fill))}%` }} /></i>
            <small>{t('war.squad', { n: x.size })}</small>
          </span>
        </button>
      ))}
      <span className={styles.vsDisc}>VS</span>
    </div>
  );
}

/** «Сколько минут ты читал сегодня?» for every member. A circle reader's figure is the circle's own (the dial
 * shows the same number); a guest's stays with the war. Between 00:00 and 04:00 a circle reader first picks the
 * day: yesterday goes to the circle only, the war's day having closed at midnight. */
function MinutesLog({ war, onSaved }: { war: War; onSaved: (w: War) => void }) {
  const { t, locale } = useI18n();
  const ask = !!war.me.ask_day;
  const [day, setDay] = useState<'today' | 'yesterday' | null>(ask ? null : 'today');
  const figure = (d: 'today' | 'yesterday' | null) => (d === 'yesterday' ? war.me.minutes_yesterday : d === 'today' ? war.me.minutes : 0) || 0;
  const [val, setVal] = useState(String(figure(day) || ''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const pick = (d: 'today' | 'yesterday') => {
    setDay(d);
    setVal(String(figure(d) || ''));
  };
  // the war's own today (Astana), not the phone's clock
  const label = (offset: number) => {
    const [y, m, d] = war.start_date.split('-').map(Number);
    const x = new Date(Date.UTC(y, m - 1, d + war.day - 1 - offset));
    return x.toLocaleDateString(locale === 'en' ? 'en-GB' : locale === 'kk' ? 'kk-KZ' : 'ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  };
  const save = async () => {
    const minutes = parseInt(val, 10);
    if (Number.isNaN(minutes) || !day) return;
    setBusy(true);
    setErr(false);
    const { data } = await apiPost<War>('/war/read', { minutes, day }, { requireAuth: true });
    if (data) {
      onSaved(data);
      window.dispatchEvent(new Event('pb:minutes-saved'));
    } else setErr(true);
    track('war_read', { minutes, day, guest: !!war.me.guest });
    setBusy(false);
  };
  return (
    <div className={styles.logBox}>
      {ask && (
        <div className={styles.whichDay}>
          <span>{t('war.whichDay')}</span>
          <div>
            <button type="button" className={day === 'yesterday' ? styles.dayOn : ''} onClick={() => pick('yesterday')}>{t('war.yesterdayChip', { d: label(1) })}</button>
            <button type="button" className={day === 'today' ? styles.dayOn : ''} onClick={() => pick('today')}>{t('war.todayChip', { d: label(0) })}</button>
          </div>
          {day === 'yesterday' && <small>{t('war.yesterdayNote')}</small>}
        </div>
      )}
      <div className={styles.guestLog}>
        <label>
          <span>{day === 'yesterday' ? t('war.minutesQYesterday') : t('war.guestQ')}</span>
          <input type="number" inputMode="numeric" min={0} max={1440} value={val} onChange={(e) => setVal(e.target.value)} placeholder="30" disabled={!day} />
        </label>
        <button type="button" className={styles.go} onClick={save} disabled={busy || val === '' || !day}>{t('war.guestSave')}</button>
      </div>
      {!war.me.guest && <small className={styles.syncNote}>{t('war.syncNote')}</small>}
      {err && <small className={styles.syncNote}>{t('war.saveErr')}</small>}
    </div>
  );
}

/** «Мой круг | Битва»: the war is the second tab of the circle, never the first. */
export function WarSwitch({ active }: { active: 'round' | 'war' }) {
  const { t } = useI18n();
  return (
    <div className={styles.seg} role="tablist">
      <Link to="/round" role="tab" aria-selected={active === 'round'} className={active === 'round' ? styles.segOn : ''}>{t('war.tabRound')}</Link>
      <Link to="/war" role="tab" aria-selected={active === 'war'} className={active === 'war' ? styles.segOn : ''}>{t('war.tabWar')}</Link>
    </div>
  );
}

export function WarPage() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const { war, setWar } = useWar();
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState(false);
  const [roster, setRoster] = useState<Team['key'] | null>(null);
  const [allNames, setAllNames] = useState(false);
  const signupLeft = useLeft(war?.signup_until);
  const startLeft = useLeft(war?.starts_at);
  const books = useBooks();
  useEffect(() => {
    loadLeagueFonts();
  }, []);

  const act = async (path: string, event: string) => {
    setBusy(true);
    const { data } = await apiPost<War>(path, {}, { requireAuth: true });
    if (data) setWar(data);
    track(event);
    setBusy(false);
  };

  const rosterTeam = war?.teams.find((x) => x.key === roster);
  const prestart = war?.status === 'live' && startLeft > 0;
  const running = war?.status === 'live' && startLeft === 0;
  const sub = !war
    ? ''
    : war.status === 'signup' || prestart
      ? t('war.subSignup', { dates: dateRange(war, t) })
      : war.status === 'done'
        ? `${dateRange(war, t)} · ${t('war.over')}`
        : t('war.subLive', { dates: dateRange(war, t), n: war.day, total: war.days_total });
  const NAMES = 12;

  const facesEl = !war ? null : (running && war.me.team && (war.me.shelf_today?.length ?? 0) > 0 && (
                        <div className={styles.faces}>
                          <span>{t('war.shelfToday', { team: t(`war.teamGen.${war.me.team}`) })}</span>
                          <ul>
                            {war.me.shelf_today!.map((p) => (
                              <li key={p.user_id}><Link to={`/readers/${p.user_id}`} title={p.display_name}><Avatar p={p} /><small>{p.display_name}</small></Link></li>
                            ))}
                          </ul>
                        </div>
                      ));
  const stripEl = !war ? null : (!prestart && (
                        <div>
                          <h4 className={styles.h4}>{t('war.track')}</h4>
                          <div className={styles.strip}>
                            {war.teams.map((x) => (
                              <div key={x.key} className={`${styles.stripRow} ${x.key === 'lighthouse' ? styles.sideA : styles.sideB}`}>
                                <span>{t(`war.team.${x.key}`)}</span>
                                <div className={styles.cells}>
                                  {Array.from({ length: war.days_total }, (_, i) => {
                                    const d = x.days[i];
                                    const share = d && d.size ? d.hits / d.size : 0;
                                    return (
                                      <i
                                        key={i}
                                        className={d ? (d.locked ? styles.cellDone : styles.cellToday) : ''}
                                        style={d ? { ['--a' as string]: String(0.4 + 0.6 * share) } : undefined}
                                        title={d ? `${d.date}: ${d.hits}/${d.size}` : undefined}
                                      >
                                        {d ? d.hits : ''}
                                      </i>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                          {running && <p className={styles.note}>{t('war.lockNote')}</p>}
                        </div>
                      ));

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container size="md">
            {!war ? (
              <div className={styles.loading}>{t('dashboard.loading')}</div>
            ) : (
              <div className={styles.stack}>
                {isAuthenticated && <WarSwitch active="war" />}
                <header className={styles.head}>
                  <div>
                    <h1 className={styles.title}>{t('war.title')}</h1>
                    <div className={styles.sub}>{sub}</div>
                  </div>
                  <button type="button" className={styles.rulesLink} onClick={() => setRules(true)}>
                    {t('war.rulesShort')} <span aria-hidden="true">›</span>
                  </button>
                </header>

                {war.status === 'signup' ? (
                  <section className={styles.grid}>
                    <div className={styles.versus}>
                      <div className={styles.vsArt} style={{ backgroundImage: `url(${ART.lighthouse})` }}><span>{t('war.team.lighthouse')}</span></div>
                      <span className={styles.vsDisc}>VS</span>
                      <div className={styles.vsArt} style={{ backgroundImage: `url(${ART.sail})` }}><span>{t('war.team.sail')}</span></div>
                    </div>
                    <div className={styles.col}>
                      <ol className={styles.steps}>
                        <li><i>1</i>{t('war.ann1')}</li>
                        <li><i>2</i>{t('war.ann2')}</li>
                        <li><i>3</i>{t('war.ann3')}</li>
                      </ol>
                      <div className={styles.panel}>
                        {war.me.joined ? (
                          <div className={styles.cardTop}>
                            <b className={styles.ok}>{t('war.youreIn')}</b>
                            <button type="button" className={styles.quiet} onClick={() => act('/war/leave', 'war_leave')} disabled={busy}>{t('war.leave')}</button>
                          </div>
                        ) : signupLeft > 0 ? (
                          isAuthenticated ? (
                            <button type="button" className={styles.primary} onClick={() => act('/war/join', 'war_join')} disabled={busy}>{t('war.join')}</button>
                          ) : (
                            <Link to={`/login?redirect=${encodeURIComponent('/war')}`} className={styles.primary}>{t('war.join')}</Link>
                          )
                        ) : null}
                        {signupLeft > 0 ? (
                          <div className={styles.count}>
                            <span>{t('war.signupLeft')}</span>
                            <b>{clock(signupLeft)}</b>
                            <small>{t('war.autoSplit')}</small>
                          </div>
                        ) : (
                          <div className={styles.count}><span>{t('war.splitting')}</span></div>
                        )}
                      </div>
                      {war.joined.length > 0 && (
                        <div>
                          <h4 className={styles.h4}>{t('war.joinedHead', { n: war.joined_count })}</h4>
                          <ul className={styles.joinedList}>
                            {(allNames ? war.joined : war.joined.slice(0, NAMES)).map((p) => (
                              <li key={p.user_id}><Link to={`/readers/${p.user_id}`}><Avatar p={p} /><span>{p.display_name}</span></Link></li>
                            ))}
                            {!allNames && war.joined.length > NAMES && (
                              <li><button type="button" className={styles.more} onClick={() => setAllNames(true)}>{t('war.more', { n: war.joined.length - NAMES })}</button></li>
                            )}
                          </ul>
                        </div>
                      )}
                      {war.is_admin && (
                        <button type="button" className={styles.admin} onClick={() => window.confirm(t('war.splitConfirm', { n: war.joined_count })) && act('/war/split', 'war_split')} disabled={busy || war.joined_count < 2}>
                          {t('war.split', { n: war.joined_count })}
                        </button>
                      )}
                    </div>
                  </section>
                ) : (
                  <section className={styles.grid}>
                    {/* on a wide screen the faces and the days sit under the pictures; on a phone after today's form */}
                    <div className={styles.col}>
                      <Field war={war} live={running} onTeam={setRoster} />
                      <div className={styles.wide}>{facesEl}{stripEl}</div>
                    </div>
                    <div className={styles.col}>
                      {war.winner && (
                        <div className={styles.winner}>{war.winner === 'draw' ? t('war.draw') : t('war.won', { team: t(`war.team.${war.winner}`) })}</div>
                      )}
                      {prestart && (
                        <div className={styles.panel}>
                          <div className={styles.count}>
                            <span>{t('war.startIn')}</span>
                            <b>{clock(startLeft)}</b>
                            <small>{war.me.team ? t('war.getReady') : t('war.closed')}</small>
                          </div>
                        </div>
                      )}
                      {running && war.me.team && (
                        <div className={`${styles.status} ${war.me.today ? '' : styles.statusTodo}`}>
                          <div>
                            <b>
                              {war.me.today
                                ? t('war.meDone', { team: t(`war.team.${war.me.team}`) })
                                : war.me.minutes
                                  ? t('war.meSome', { m: war.me.minutes, left: 30 - war.me.minutes })
                                  : t('war.meNot')}
                            </b>
                            <small>{t('war.contrib', { books: books(war.me.hits ?? 0) })}</small>
                          </div>
                        </div>
                      )}
                      {running && war.me.team && <MinutesLog key={`${war.day}-${war.me.ask_day ? 1 : 0}`} war={war} onSaved={setWar} />}
                      {running && !war.me.team && <p className={styles.note}>{t('war.closed')}</p>}
                      <div className={styles.narrow}>{facesEl}{stripEl}</div>
                      {war.me.team && <TeamChat />}
                    </div>
                  </section>
                )}

                {war.prize && <div className={styles.prize}>{t('war.prize')}: {war.prize}</div>}
              </div>
            )}
          </Container>
        </main>
        <Footer />
      </div>
      <Sheet open={rules} onClose={() => setRules(false)} label={t('war.rules')}>
        <h3 className={styles.sheetTitle}>{t('war.rules')}</h3>
        <ul className={styles.rules}>
          <li>{t('war.rule1')}</li>
          <li>{t('war.rule2')}</li>
          <li>{t('war.rule3')}</li>
          <li>{t('war.rule4')}</li>
        </ul>
        <div className={styles.tip}>
          <p>{t('war.tip')}</p>
          <div className={styles.guides}>
            <a href="/guides/powerbook-iphone.pdf" target="_blank" rel="noopener" onClick={() => track('war_guide', { os: 'ios' })}>{t('war.guideIphone')}</a>
            <a href="/guides/powerbook-android.pdf" target="_blank" rel="noopener" onClick={() => track('war_guide', { os: 'android' })}>{t('war.guideAndroid')}</a>
          </div>
        </div>
        <button type="button" className={styles.close} onClick={() => setRules(false)}>{t('lg.done')}</button>
      </Sheet>
      <Sheet open={!!rosterTeam} onClose={() => setRoster(null)} label={roster ? t(`war.team.${roster}`) : ''}>
        {rosterTeam && (
          <>
            <h3 className={styles.sheetTitle}>{t(`war.team.${rosterTeam.key}`)} · {rosterTeam.size}</h3>
            <ul className={styles.roster}>
              {rosterTeam.members.map((p) => (
                <li key={p.user_id}><Link to={`/readers/${p.user_id}`} onClick={() => setRoster(null)}><Avatar p={p} /><span>{p.display_name}</span></Link></li>
              ))}
            </ul>
            <button type="button" className={styles.close} onClick={() => setRoster(null)}>{t('lg.done')}</button>
          </>
        )}
      </Sheet>
    </PageTransition>
  );
}

/** At the top of «Круг» while a war is on: the switch to its tab. */
export function RoundWarSwitch() {
  const { war } = useWar();
  if (!war || war.status === 'done') return null;
  return <WarSwitch active="round" />;
}

/** On the round tab while sign-up is open: the race announced, with a way in. */
export function WarAnnounce() {
  const { t } = useI18n();
  const { war } = useWar();
  const left = useLeft(war?.signup_until);
  if (!war || war.status !== 'signup' || left <= 0) return null;
  return (
    <Link to="/war" className={styles.ann} onClick={() => track('war_announce')}>
      <span className={styles.annGlow} />
      <span className={styles.annKicker}>{t('war.annKicker', { dates: dateRange(war, t) })}</span>
      <span className={styles.annTitle}>{t('war.title')}</span>
      <span className={styles.annVersus}>
        <span className={styles.annArt} style={{ backgroundImage: `url(${ART.lighthouse})` }}><b>{t('war.team.lighthouse')}</b></span>
        <span className={styles.annVs}>VS</span>
        <span className={styles.annArt} style={{ backgroundImage: `url(${ART.sail})` }}><b>{t('war.team.sail')}</b></span>
      </span>
      <span className={styles.annRules}>
        <span><i>1</i>{t('war.ann1')}</span>
        <span><i>2</i>{t('war.ann2')}</span>
        <span><i>3</i>{t('war.ann3')}</span>
      </span>
      <span className={styles.annCta}>{war.me.joined ? t('war.annIn') : t('war.join')}</span>
      <span className={styles.annCount}>{t('war.joinedCount', { n: war.joined_count })} · {t('war.signupUntil')} {clock(left)}</span>
    </Link>
  );
}

/** On the round tab: the war in one line, a door to its page. */
export function WarCard() {
  const { t } = useI18n();
  const { war } = useWar();
  if (!war || war.status !== 'live') return null;
  const [a, b] = war.teams;
  return (
    <Link to="/war" className={styles.card} onClick={() => track('war_card')}>
      <span className={styles.cardArt} style={{ backgroundImage: `url(${ART.lighthouse})` }} />
      <span className={styles.cardText}>
        <b>{t('war.title')}</b>
        {war.day > 0 && war.me.team && (
          <span className={war.me.today ? styles.cardMeDone : styles.cardMe}>
            {war.me.today
              ? t('war.cardMeDone', { team: t(`war.teamGen.${war.me.team}`) })
              : war.me.minutes
                ? t('war.cardMeSome', { left: 30 - war.me.minutes, team: t(`war.teamGen.${war.me.team}`) })
                : t('war.cardMeNot', { team: t(`war.teamGen.${war.me.team}`) })}
          </span>
        )}
        <small>
          {war.day === 0 ? t('war.cardSoon') : t('war.cardLive', { a: a?.points ?? 0, b: b?.points ?? 0, n: war.day, total: war.days_total })}
        </small>
      </span>
      <span className={styles.cardArt} style={{ backgroundImage: `url(${ART.sail})` }} />
    </Link>
  );
}
