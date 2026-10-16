/** «Битва кланов»: two teams, «Маяк» and «Парус», 14 days. Every member who
 * logs 30+ minutes before 00:00 brings a point; at midnight each point strikes a
 * brick out of the other fortress. Open to anyone; only team numbers are public
 * (app/services/clan_war.py). Lives as the second tab of «Круг». */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, getApiBaseUrl, track, useAuth, useI18n } from '@/shared/lib';
import { Container, PageTransition } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import { Sheet } from '@/widgets/RoundToday';
import { fortressSvg } from './fortress';
import styles from './WarPage.module.css';

type Person = { user_id: string; display_name: string; avatar: string | null };
type Day = { date: string; hits: number; size: number; locked: boolean };
type Team = { key: 'lighthouse' | 'sail'; size: number; hp: number; bricks: number; bricks_left: number; points: number; today: number | null; members: Person[]; days: Day[] };
export type War = {
  id: string;
  start_date: string;
  end_date: string;
  status: 'signup' | 'live' | 'done';
  prize: string | null;
  days_total: number;
  day: number;
  joined_count: number;
  is_admin: boolean;
  me: { joined: boolean; team: Team['key'] | null; hits?: number; days?: number; today?: boolean };
  joined: Person[];
  teams: Team[];
  winner: Team['key'] | 'draw' | null;
};

const ART: Record<Team['key'], string> = { lighthouse: '/leagues/diamond.jpg', sail: '/leagues/bronze.jpg' };

export function useWar() {
  const [war, setWar] = useState<War | null>(null);
  const load = useCallback(() => {
    apiGet<War>('/war', { requireAuth: true }).then(({ data }) => data && setWar(data));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return { war, setWar, load };
}

function Avatar({ p }: { p: Person }) {
  return (
    <span className={styles.av} title={p.display_name}>
      {p.avatar ? <img src={`${getApiBaseUrl()}/social/avatar/${p.user_id}?v=${p.avatar}`} alt="" loading="lazy" /> : (p.display_name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

function dateRange(war: War, locale: string) {
  const f = (s: string) => new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : locale, { day: 'numeric', month: 'long' }).format(new Date(`${s}T12:00:00`));
  return `${f(war.start_date).replace(/\D+$/, '')}–${f(war.end_date)}`;
}

/** The battlefield: two brick fortresses under the night sky, banners flying. */
function Field({ war }: { war: War }) {
  const { t } = useI18n();
  const [a, b] = war.teams;
  const lastLocked = (team: Team) => [...team.days].reverse().find((d) => d.locked);
  const svgs = useMemo(() => {
    const fall = (attacker: Team, defender: Team) => {
      const last = lastLocked(attacker);
      if (!last || !last.hits || !defender.bricks) return 0;
      return Math.max(1, Math.min(8, Math.round((last.hits / defender.bricks) * 180)));
    };
    return [fortressSvg(a.key, a.hp, fall(b, a)), fortressSvg(b.key, b.hp, fall(a, b))];
  }, [a, b]);
  return (
    <div className={styles.field}>
      <div className={styles.stars} />
      <div className={styles.ground} />
      {war.me.team && <span className={styles.you}>{t(`war.youIn.${war.me.team}`)}</span>}
      {war.status === 'live' && (
        <>
          <span className={styles.vs}>VS</span>
          <i className={`${styles.shot} ${styles.shotA}`} />
          <i className={`${styles.shot} ${styles.shotB}`} />
        </>
      )}
      <div className={styles.fortsRow}>
        <div dangerouslySetInnerHTML={{ __html: svgs[0] }} />
        <div dangerouslySetInnerHTML={{ __html: svgs[1] }} />
      </div>
      <div className={styles.labels}>
        {[a, b].map((x) => (
          <div key={x.key}>
            <b>{t(`war.team.${x.key}`)}</b>
            <span>{x.bricks_left}</span>
            <small>/ {x.bricks}</small>
          </div>
        ))}
      </div>
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
  const { t, locale } = useI18n();
  const { isAuthenticated } = useAuth();
  const { war, setWar } = useWar();
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState(false);
  const [roster, setRoster] = useState<Team['key'] | null>(null);

  const act = async (path: string, event: string) => {
    setBusy(true);
    const { data } = await apiPost<War>(path, {}, { requireAuth: true });
    if (data) setWar(data);
    track(event);
    setBusy(false);
  };

  const rosterTeam = war?.teams.find((x) => x.key === roster);
  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container size="sm">
            {!war ? (
              <div className={styles.loading}>{t('dashboard.loading')}</div>
            ) : (
              <>
                {isAuthenticated && <WarSwitch active="war" />}
                <div className={styles.kicker}>{t('war.kicker', { dates: dateRange(war, locale) })}</div>
                <h1 className={styles.title}>{t('war.title')}</h1>
                {war.status !== 'signup' && <div className={styles.day}>{war.status === 'done' ? t('war.over') : t('war.day', { n: war.day, total: war.days_total })}</div>}

                {war.status === 'signup' ? (
                  <section className={styles.signup}>
                    <div className={styles.versus}>
                      <div className={styles.vsArt} style={{ backgroundImage: `url(${ART.lighthouse})` }}><span>{t('war.team.lighthouse')}</span></div>
                      <b className={styles.vs}>VS</b>
                      <div className={styles.vsArt} style={{ backgroundImage: `url(${ART.sail})` }}><span>{t('war.team.sail')}</span></div>
                    </div>
                    <p className={styles.lead}>{t('war.pitch')}</p>
                    {isAuthenticated ? (
                      war.me.joined ? (
                        <>
                          <div className={styles.joinedNote}>{t('war.youreIn')}</div>
                          <button type="button" className={styles.linkBtn} onClick={() => act('/war/leave', 'war_leave')} disabled={busy}>
                            {t('war.leave')}
                          </button>
                        </>
                      ) : (
                        <button type="button" className={styles.primary} onClick={() => act('/war/join', 'war_join')} disabled={busy}>
                          {t('war.join')}
                        </button>
                      )
                    ) : (
                      <Link to={`/login?redirect=${encodeURIComponent('/war')}`} className={styles.primary}>
                        {t('war.join')}
                      </Link>
                    )}
                    <div className={styles.count}>{t('war.joinedCount', { n: war.joined_count })}</div>
                    <div className={styles.faces}>
                      {war.joined.slice(0, 40).map((p) => (
                        <Avatar key={p.user_id} p={p} />
                      ))}
                    </div>
                    {war.is_admin && (
                      <button type="button" className={styles.admin} onClick={() => window.confirm(t('war.splitConfirm', { n: war.joined_count })) && act('/war/split', 'war_split')} disabled={busy || war.joined_count < 2}>
                        {t('war.split', { n: war.joined_count })}
                      </button>
                    )}
                  </section>
                ) : (
                  <>
                    {war.winner && (
                      <div className={styles.winner}>
                        {war.winner === 'draw' ? t('war.draw') : t('war.won', { team: t(`war.team.${war.winner}`) })}
                      </div>
                    )}
                    {war.me.team && war.status === 'live' && (
                      <div className={styles.meLine}>
                        <span>{war.me.today ? t('war.meDone', { team: t(`war.team.${war.me.team}`) }) : t('war.meNot')}</span>
                        {!war.me.today && <Link to="/round">{t('war.toDial')}</Link>}
                      </div>
                    )}
                    <Field war={war} />
                    {war.status === 'live' && (
                      <div className={styles.todayBox}>
                        <div className={styles.todayRow}>
                          {war.teams.map((x) => (
                            <span key={x.key}><b>{x.today ?? 0}</b> {t('war.pts')} · {t(`war.team.${x.key}`)}</span>
                          ))}
                        </div>
                        <div className={styles.lockNote}>{t('war.lockNote')}</div>
                      </div>
                    )}
                    {(() => {
                      const y = war.teams.map((x) => [...x.days].reverse().find((d) => d.locked));
                      return y[0] && y[1] ? (
                        <p className={styles.yesterday}>
                          {t('war.yesterday', { a: t(`war.team.${war.teams[0].key}`), n: y[0].hits, b: t(`war.team.${war.teams[1].key}`), m: y[1].hits })}
                        </p>
                      ) : null;
                    })()}
                    <h4 className={styles.h4}>{t('war.track')}</h4>
                    <div className={styles.strip}>
                      {war.teams.map((x) => (
                        <div key={x.key} className={styles.stripRow}>
                          <span>{t(`war.team.${x.key}`)}</span>
                          <div className={styles.cells}>
                            {Array.from({ length: war.days_total }, (_, i) => {
                              const d = x.days[i];
                              const share = d && d.size ? d.hits / d.size : 0;
                              return (
                                <i key={i} className={d ? (d.locked ? styles.cellDone : styles.cellToday) : ''} style={d ? { ['--a' as string]: String(0.25 + 0.75 * share) } : undefined} title={d ? `${d.date}: ${d.hits}/${d.size}` : undefined}>
                                  {d ? d.hits : ''}
                                </i>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    {war.me.team && (
                      <div className={styles.myPart}>{t('war.myPart', { team: t(`war.team.${war.me.team}`), n: war.me.hits ?? 0, days: war.me.days ?? 0 })}</div>
                    )}
                    <div className={styles.rosterBtns}>
                      {war.teams.map((team) => (
                        <button key={team.key} type="button" onClick={() => setRoster(team.key)}>
                          {t(`war.team.${team.key}`)} · {t('war.members', { n: team.size })} ›
                        </button>
                      ))}
                    </div>
                    {!war.me.team && war.status === 'live' && isAuthenticated && (
                      <button type="button" className={styles.primary} onClick={() => act('/war/join', 'war_join_late')} disabled={busy}>
                        {t('war.joinLate')}
                      </button>
                    )}
                  </>
                )}

                {war.prize && <div className={styles.prize}>{t('war.prize')}: {war.prize}</div>}
                <button type="button" className={styles.rulesBtn} onClick={() => setRules(true)}>
                  {t('war.rules')} <span aria-hidden="true">›</span>
                </button>
              </>
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
        <button type="button" className={styles.close} onClick={() => setRules(false)}>{t('lg.done')}</button>
      </Sheet>
      <Sheet open={!!rosterTeam} onClose={() => setRoster(null)} label={roster ? t(`war.team.${roster}`) : ''}>
        {rosterTeam && (
          <>
            <h3 className={styles.sheetTitle}>{t(`war.team.${rosterTeam.key}`)}</h3>
            <ul className={styles.roster}>
              {rosterTeam.members.map((p) => (
                <li key={p.user_id}><Avatar p={p} />{p.display_name}</li>
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

/** On the round tab: the war in one line, a door to its page. */
export function WarCard() {
  const { t } = useI18n();
  const { war } = useWar();
  if (!war || war.status === 'done') return null;
  const [a, b] = war.teams;
  return (
    <Link to="/war" className={styles.card} onClick={() => track('war_card')}>
      <span className={styles.cardArt} style={{ backgroundImage: `url(${ART.lighthouse})` }} />
      <span className={styles.cardText}>
        <b>{t('war.title')}</b>
        <small>
          {war.status === 'signup'
            ? war.me.joined
              ? t('war.cardIn', { n: war.joined_count })
              : t('war.cardJoin', { n: war.joined_count })
            : t('war.cardLive', { a: a?.bricks_left ?? 0, b: b?.bricks_left ?? 0, n: war.day, total: war.days_total })}
        </small>
      </span>
      <span className={styles.cardArt} style={{ backgroundImage: `url(${ART.sail})` }} />
    </Link>
  );
}
