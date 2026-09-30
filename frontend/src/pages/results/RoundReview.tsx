import { useEffect, useState } from 'react';
import { apiGet, useI18n, type RoundInsight, type RoundLetter, type RoundReview as Review, type RoundStats } from '@/shared/lib';
import { LetterError, Working, useDigest } from '../reading/digest';
import styles from './RoundReview.module.css';

/** Month names come from the site's own words: browsers without Kazakh month
 * names would otherwise print "M08". */
function monthLabel(year: number, month: number, t: (key: string) => string, style: 'long' | 'short' = 'long'): string {
  const name = t(`month.${month}`);
  return style === 'long' ? `${name} ${year}` : name.slice(0, 3);
}

/** "1 170" in Russian and Kazakh, "1,170" in English — done here, since not
 * every browser knows how Kazakh groups its digits. */
function useNumber() {
  const { locale } = useI18n();
  return (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, locale === 'en' ? ',' : '\u00a0');
}

/** "▲ +3 к прошлому кругу", "▼ −2 …", or "как в прошлом" — shape and sign, never colour alone. */
function Delta({ now, before, lowerIsBetter = false }: { now: number; before: number | null | undefined; lowerIsBetter?: boolean }) {
  const { t } = useI18n();
  const num = useNumber();
  if (before === null || before === undefined) return null;
  const diff = now - before;
  if (diff === 0) return <span className={styles.delta}>{t('review.same')}</span>;
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <span className={`${styles.delta} ${better ? styles.up : styles.down}`}>
      {diff > 0 ? '▲' : '▼'} {diff > 0 ? '+' : '−'}
      {num(Math.abs(diff))} {t('review.vsPrev')}
    </span>
  );
}

export function insightText(insight: RoundInsight, kind: 's' | 'i', t: (key: string, params?: Record<string, string | number>) => string): string {
  const params: Record<string, string | number> = { ...insight.params };
  if (typeof insight.params.weekday === 'number') params.weekday = t(`review.wd.${insight.params.weekday}`);
  return t(`review.${kind}.${insight.key}`, params);
}

function Tiles({ cur, prev, avg, best }: { cur: RoundStats; prev: RoundStats | null; avg: RoundStats | null; best: Review['best'] }) {
  const { t } = useI18n();
  const num = useNumber();
  return (
    <div className={styles.tiles}>
      <div className={styles.tile}>
        <strong>
          {cur.goal_days}
          <small> / {cur.days}</small>
        </strong>
        <span>{t('review.goalDays')}</span>
        <Delta now={cur.goal_days} before={prev?.goal_days} />
        {avg && <em>{t('review.avgWas', { n: avg.goal_days })}</em>}
      </div>
      <div className={styles.tile}>
        <strong>{num(cur.minutes)}</strong>
        <span>{t('review.minutes')}</span>
        <Delta now={cur.minutes} before={prev?.minutes} />
        {best && <em>{t('review.bestWas', { n: num(best.minutes) })}</em>}
      </div>
      {cur.rank !== null && cur.participants !== null && (
        <div className={styles.tile}>
          <strong>{t('review.placeOf', { rank: cur.rank, n: cur.participants })}</strong>
          <span>{t('review.place')}</span>
          <Delta now={cur.rank} before={prev?.rank ?? null} lowerIsBetter />
        </div>
      )}
      <div className={styles.tile}>
        <strong>{cur.longest_streak}</strong>
        <span>{t('review.streak')}</span>
        <Delta now={cur.longest_streak} before={prev?.longest_streak} />
        {best && <em>{t('review.bestWas', { n: best.streak })}</em>}
      </div>
      <div className={styles.tile}>
        <strong>{cur.books}</strong>
        <span>{t('review.books')}</span>
        <Delta now={cur.books} before={prev?.books} />
      </div>
    </div>
  );
}

/** One bar per round, the share of its days that reached the goal; the round under review in full. */
function TrendChart({ review }: { review: Review }) {
  const { t } = useI18n();
  const num = useNumber();
  const points = review.trend;
  if (points.length < 2) return null;
  const columns = { gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` };
  return (
    <section className={styles.card}>
      <h3>{t('review.trend')}</h3>
      <div className={styles.chart} style={columns} role="img" aria-label={t('review.trend')}>
        {points.map((p, i) => {
          const share = p.days ? p.goal_days / p.days : 0;
          const current = i === points.length - 1;
          return (
            <div key={`${p.year}-${p.month}`} className={styles.col} tabIndex={0}>
              <span className={styles.colValue}>{p.goal_days}</span>
              <div className={`${styles.bar} ${current ? styles.barNow : ''}`} style={{ height: `${Math.max(3, share * 100)}%` }} />
              <span className={styles.tip}>
                <b>{monthLabel(p.year, p.month, t)}</b>
                <br />
                {t('review.daysOf', { goal: p.goal_days, days: p.days })}
                <br />
                {num(p.minutes)} {t('rings.minutesShort')}
                {p.rank !== null && p.participants !== null && <> · {t('review.placeOf', { rank: p.rank, n: p.participants })}</>}
              </span>
            </div>
          );
        })}
      </div>
      <div className={styles.ticks} style={columns} aria-hidden="true">
        {points.map((p) => (
          <span key={`${p.year}-${p.month}`}>{monthLabel(p.year, p.month, t, 'short')}</span>
        ))}
      </div>
    </section>
  );
}

function WeekdayChart({ cur }: { cur: RoundStats }) {
  const { t } = useI18n();
  const labels = [t('weekday.mon'), t('weekday.tue'), t('weekday.wed'), t('weekday.thu'), t('weekday.fri'), t('weekday.sat'), t('weekday.sun')];
  const peak = Math.max(1, ...cur.weekday_minutes);
  const weakest = cur.weekday_minutes.indexOf(Math.min(...cur.weekday_minutes));
  const columns = { gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' };
  return (
    <section className={styles.card}>
      <h3>{t('review.weekdays')}</h3>
      <p className={styles.cardNote}>{t('review.weekdaysNote')}</p>
      <div className={styles.chart} style={columns} role="img" aria-label={t('review.weekdays')}>
        {cur.weekday_minutes.map((m, i) => (
          <div key={i} className={styles.col} tabIndex={0}>
            {(i === weakest || m === peak) && <span className={styles.colValue}>{m}</span>}
            <div className={`${styles.bar} ${styles.barNow}`} style={{ height: `${Math.max(3, (m / peak) * 100)}%` }} />
            <span className={styles.tip}>
              <b>{t(`review.wd.${i}`)}</b>
              <br />
              {m} {t('rings.minutesShort')}
            </span>
          </div>
        ))}
      </div>
      <div className={styles.ticks} style={columns} aria-hidden="true">
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </section>
  );
}

function AiReview({ roundId, available }: { roundId: string; available: boolean }) {
  const { t } = useI18n();
  const { digest, error, start, starting } = useDigest('round', roundId);
  const letter = digest?.status === 'done' ? (digest.content as RoundLetter | null) : null;
  if (!available && !letter) return null;
  return (
    <section className={styles.letter}>
      <div className={styles.letterHead}>
        <h3>✦ {t('review.aiTitle')}</h3>
        {digest?.status !== 'working' && (
          <button type="button" className={letter ? styles.ghost : styles.primary} onClick={() => start(!!letter)} disabled={starting}>
            {letter ? t('rd.letterAgain') : t('review.aiWrite')}
          </button>
        )}
      </div>
      {!letter && digest?.status !== 'working' && <p className={styles.muted}>{t('review.aiIntro')}</p>}
      {digest?.status === 'working' && <Working />}
      {digest?.status === 'error' && <LetterError code="failed" />}
      <LetterError code={error} />
      {letter && (
        <div className={styles.letterBody}>
          <p className={styles.headline}>{letter.headline}</p>
          <p className={styles.prose}>{letter.summary}</p>
          {letter.compared && (
            <div>
              <h4>{t('review.compared')}</h4>
              <p className={styles.prose}>{letter.compared}</p>
            </div>
          )}
          {letter.strengths.length > 0 && (
            <div>
              <h4>{t('review.good')}</h4>
              <ul className={styles.bullets}>{letter.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
          {letter.improve.length > 0 && (
            <div>
              <h4>{t('review.bad')}</h4>
              <ul className={styles.bullets}>
                {letter.improve.map((x, i) => (
                  <li key={i}>
                    <b>{x.what}</b> — {x.how}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {letter.lifehacks.length > 0 && (
            <div>
              <h4>{t('review.lifehacks')}</h4>
              <ul className={styles.bullets}>{letter.lifehacks.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
          {letter.next_goal && (
            <div>
              <h4>{t('review.nextGoal')}</h4>
              <p className={styles.goal}>{letter.next_goal}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * A reader's own round, looked back on: the numbers beside their earlier rounds,
 * what went well, where the days went, and reading habits picked for exactly that.
 */
export function RoundReview({ roundId }: { roundId: string | null }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string | null>(roundId);
  const [review, setReview] = useState<Review | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => setPicked(roundId), [roundId]);

  useEffect(() => {
    let cancelled = false;
    const qs = picked ? `?round_id=${picked}` : '';
    apiGet<Review>(`/reading/round-review${qs}`, { requireAuth: true }).then(({ data, error }) => {
      if (cancelled) return;
      if (data) {
        setReview(data);
        setMissing(false);
      } else if (error === 'not_in_round' && picked) {
        // Not in this round: show their latest one instead.
        setPicked(null);
      } else {
        setMissing(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [picked]);

  if (missing || !review) return null;
  const cur = review.round;
  const hasPast = review.previous !== null;

  return (
    <section id="round-review" className={styles.review} aria-label={t('review.title')}>
      <div className={styles.head}>
        <div>
          <h2>{t('review.title')}</h2>
          <p className={styles.muted}>
            {hasPast ? t('review.subtitle', { n: review.rounds_count - 1 }) : t('review.subtitleFirst')}
          </p>
          {cur.ongoing && <p className={styles.muted}>{t('review.ongoing')}</p>}
        </div>
        {review.rounds.length > 1 && (
          <label className={styles.pick}>
            <span>{t('review.pick')}</span>
            <select value={cur.round_id} onChange={(e) => setPicked(e.target.value)}>
              {review.rounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {monthLabel(r.year, r.month, t)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <Tiles cur={cur} prev={review.previous} avg={review.average} best={review.best} />

      <div className={styles.columns}>
        <section className={styles.card}>
          <h3>{t('review.good')}</h3>
          {review.strengths.length ? (
            <ul className={styles.list}>
              {review.strengths.map((s) => (
                <li key={s.key} className={styles.good}>
                  <i aria-hidden="true">✓</i>
                  {insightText(s, 's', t)}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>{t('review.noGood')}</p>
          )}
          <h3 className={styles.second}>{t('review.bad')}</h3>
          {review.improve.length ? (
            <ul className={styles.list}>
              {review.improve.map((s) => (
                <li key={s.key} className={styles.bad}>
                  <i aria-hidden="true">!</i>
                  {insightText(s, 'i', t)}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>{t('review.noBad')}</p>
          )}
        </section>
        <div className={styles.charts}>
          <TrendChart review={review} />
          <WeekdayChart cur={cur} />
        </div>
      </div>

      <section className={styles.tipsBlock}>
        <h3>{t('review.tips')}</h3>
        <p className={styles.muted}>{t('review.tipsNote')}</p>
        <div className={styles.tips}>
          {review.tips.map((tip) => (
            <article key={tip} className={styles.tipCard}>
              <h4>{t(`review.tip.${tip}.t`)}</h4>
              <p>{t(`review.tip.${tip}.d`)}</p>
            </article>
          ))}
        </div>
      </section>

      <AiReview roundId={cur.round_id} available={review.ai_available} />
    </section>
  );
}
