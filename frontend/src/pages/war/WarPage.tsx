/** «Битва кланов»: two teams, «Маяк» and «Парус», 14 days. Every day of 30+
 * minutes strikes the other fortress; a day when 80% of a team read raises its
 * shield. Open to anyone; only team numbers are public (app/services/clan_war.py). */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, getApiBaseUrl, track, useAuth, useI18n } from '@/shared/lib';
import { Container, PageTransition } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import { Sheet } from '@/widgets/RoundToday';
import styles from './WarPage.module.css';

type Person = { user_id: string; display_name: string; avatar: string | null };
type Day = { date: string; hits: number; size: number; shield: boolean };
type Team = { key: 'lighthouse' | 'sail'; size: number; hp: number; members: Person[]; days: Day[] };
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
  me: { joined: boolean; team: Team['key'] | null; hits?: number; days?: number };
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

function Fortress({ team, war, mine, lead }: { team: Team; war: War; mine: boolean; lead: boolean }) {
  const { t } = useI18n();
  const today = team.days[team.days.length - 1];
  return (
    <div className={`${styles.fort} ${mine ? styles.mine : ''} ${lead ? styles.lead : ''}`}>
      <div className={styles.art} style={{ backgroundImage: `url(${ART[team.key]})` }} />
      <div className={styles.fortBody}>
        <div className={styles.teamName}>{t(`war.team.${team.key}`)}</div>
        <div className={styles.hp}>
          <b>{Math.round(team.hp)}</b>
          <small>{t('war.hp')}</small>
        </div>
        <div className={styles.hpBar}>
          <i style={{ width: `${team.hp}%` }} />
        </div>
        {today && war.status === 'live' && (
          <div className={styles.today}>
            {t('war.todayHits', { n: today.hits, size: today.size })}
            {today.shield && <span className={styles.shieldTag}>{t('war.shield')}</span>}
          </div>
        )}
        <div className={styles.track} aria-label={t('war.track')}>
          {Array.from({ length: war.days_total }, (_, i) => {
            const d = team.days[i];
            const share = d && d.size ? d.hits / d.size : 0;
            return (
              <i
                key={i}
                className={d ? (d.shield ? styles.cellShield : styles.cellDay) : styles.cellAhead}
                style={d && !d.shield ? { opacity: 0.25 + 0.75 * share } : undefined}
                title={d ? `${d.date}: ${d.hits}/${d.size}` : undefined}
              />
            );
          })}
        </div>
        <div className={styles.size}>{t('war.members', { n: team.size })}</div>
      </div>
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
                    <div className={styles.forts}>
                      {war.teams.map((team) => (
                        <button key={team.key} type="button" className={styles.fortBtn} onClick={() => setRoster(team.key)}>
                          <Fortress team={team} war={war} mine={war.me.team === team.key} lead={team.hp > (war.teams.find((x) => x.key !== team.key)?.hp ?? 0)} />
                        </button>
                      ))}
                    </div>
                    {war.me.team ? (
                      <div className={styles.myPart}>
                        {t('war.myPart', { team: t(`war.team.${war.me.team}`), n: war.me.hits ?? 0, days: war.me.days ?? 0 })}
                      </div>
                    ) : (
                      war.status === 'live' &&
                      isAuthenticated && (
                        <button type="button" className={styles.primary} onClick={() => act('/war/join', 'war_join_late')} disabled={busy}>
                          {t('war.joinLate')}
                        </button>
                      )
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
          <li>{t('war.rule5')}</li>
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
            : t('war.cardLive', { a: Math.round(a?.hp ?? 0), b: Math.round(b?.hp ?? 0), n: war.day, total: war.days_total })}
        </small>
      </span>
      <span className={styles.cardArt} style={{ backgroundImage: `url(${ART.sail})` }} />
    </Link>
  );
}
