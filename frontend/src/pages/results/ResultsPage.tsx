import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  useI18n,
  useAuth,
  apiGet,
  type LastCompletedRound,
  type RoundResultsResponse,
  type CalendarResponse,
  type CalendarDay,
} from '@/shared/lib';
import { Container, PageTransition } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import styles from './ResultsPage.module.css';

function TrophyIcon({ rank }: { rank: number }) {
  if (rank === 1) return <span className={`${styles.trophy} ${styles.trophyGold}`}>{'\uD83C\uDFC6'}</span>;
  if (rank === 2) return <span className={`${styles.trophy} ${styles.trophySilver}`}>{'\uD83C\uDFC6'}</span>;
  if (rank === 3) return <span className={`${styles.trophy} ${styles.trophyBronze}`}>{'\uD83C\uDFC6'}</span>;
  return null;
}

/* ---------- SVG Line Chart: Progress per day of month ---------- */
function ProgressChart({ days }: { days: CalendarDay[] }) {
  const W = 500, H = 160, PX = 30, PY = 20;
  const chartW = W - PX * 2;
  const chartH = H - PY * 2;

  const maxMin = Math.max(...days.map(d => d.minutes), 1);
  const yTicks = [0, Math.round(maxMin / 2), maxMin];

  const points = days.map((d, i) => {
    const x = PX + (i / Math.max(days.length - 1, 1)) * chartW;
    const y = PY + chartH - (d.minutes / maxMin) * chartH;
    return `${x},${y}`;
  }).join(' ');

  // Area fill under line
  const firstX = PX;
  const lastX = PX + chartW;
  const areaPath = `M ${firstX},${PY + chartH} ` +
    days.map((d, i) => {
      const x = PX + (i / Math.max(days.length - 1, 1)) * chartW;
      const y = PY + chartH - (d.minutes / maxMin) * chartH;
      return `L ${x},${y}`;
    }).join(' ') +
    ` L ${lastX},${PY + chartH} Z`;

  // Show every ~5th day label to avoid crowding
  const step = days.length > 20 ? 5 : days.length > 10 ? 3 : 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.chart}>
      {/* Y axis ticks */}
      {yTicks.map(v => {
        const y = PY + chartH - (v / maxMin) * chartH;
        return (
          <g key={v}>
            <line x1={PX} y1={y} x2={W - PX} y2={y} stroke="var(--color-border-primary)" strokeWidth="0.5" />
            <text x={PX - 6} y={y + 4} textAnchor="end" fill="var(--color-text-muted)" fontSize="10">{v}</text>
          </g>
        );
      })}
      {/* Area */}
      <path d={areaPath} fill="var(--color-accent-primary)" opacity="0.15" />
      {/* Line */}
      <polyline points={points} fill="none" stroke="var(--color-accent-primary)" strokeWidth="2" strokeLinejoin="round" />
      {/* Dots */}
      {days.map((d, i) => {
        const x = PX + (i / Math.max(days.length - 1, 1)) * chartW;
        const y = PY + chartH - (d.minutes / maxMin) * chartH;
        return <circle key={i} cx={x} cy={y} r="2.5" fill="var(--color-accent-primary)" />;
      })}
      {/* X axis labels */}
      {days.map((d, i) => {
        if (i % step !== 0 && i !== days.length - 1) return null;
        const x = PX + (i / Math.max(days.length - 1, 1)) * chartW;
        const dayNum = new Date(d.date).getDate();
        return (
          <text key={i} x={x} y={H - 2} textAnchor="middle" fill="var(--color-text-muted)" fontSize="10">
            {dayNum}
          </text>
        );
      })}
    </svg>
  );
}

/* ---------- SVG Bar Chart: Activity by weekday ---------- */
function WeekdayChart({ days, weekdayLabels }: { days: CalendarDay[]; weekdayLabels: string[] }) {
  const W = 500, H = 160, PX = 30, PY = 20;
  const chartW = W - PX * 2;
  const chartH = H - PY * 2;

  // Aggregate minutes by weekday (0=Mon ... 6=Sun)
  const totals = [0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  days.forEach(d => {
    const dt = new Date(d.date);
    const dow = (dt.getDay() + 6) % 7; // JS Sunday=0 → shift so Mon=0
    totals[dow] += d.minutes;
    counts[dow]++;
  });
  const avgs = totals.map((t, i) => counts[i] > 0 ? Math.round(t / counts[i]) : 0);
  const maxVal = Math.max(...avgs, 1);

  const barW = chartW / 7 * 0.6;
  const gap = chartW / 7;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.chart}>
      {/* Y grid lines */}
      {[0, Math.round(maxVal / 2), maxVal].map(v => {
        const y = PY + chartH - (v / maxVal) * chartH;
        return (
          <g key={v}>
            <line x1={PX} y1={y} x2={W - PX} y2={y} stroke="var(--color-border-primary)" strokeWidth="0.5" />
            <text x={PX - 6} y={y + 4} textAnchor="end" fill="var(--color-text-muted)" fontSize="10">{v}</text>
          </g>
        );
      })}
      {/* Bars */}
      {avgs.map((v, i) => {
        const x = PX + i * gap + (gap - barW) / 2;
        const barH = (v / maxVal) * chartH;
        const y = PY + chartH - barH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} rx="4" fill="var(--color-accent-primary)" opacity="0.85" />
            {/* Value on top */}
            {v > 0 && (
              <text x={x + barW / 2} y={y - 4} textAnchor="middle" fill="var(--color-text-muted)" fontSize="9">{v}</text>
            )}
            {/* Weekday label */}
            <text x={x + barW / 2} y={H - 2} textAnchor="middle" fill="var(--color-text-muted)" fontSize="10">
              {weekdayLabels[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ResultsPage() {
  const { t } = useI18n();
  const { user } = useAuth();

  const [lastRound, setLastRound] = useState<LastCompletedRound>(null);
  const [results, setResults] = useState<RoundResultsResponse | null>(null);
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    const { data: round } = await apiGet<LastCompletedRound>(
      '/rounds/last-completed',
      { requireAuth: true }
    );
    if (round) {
      setLastRound(round);
      const { data: res } = await apiGet<RoundResultsResponse>(
        `/rounds/${round.id}/results`,
        { requireAuth: true }
      );
      if (res) {
        setResults(res);
        // Only fetch calendar if user participated
        if (res.my_result) {
          const { data: cal } = await apiGet<CalendarResponse>(
            `/rounds/${round.id}/calendar`,
            { requireAuth: true }
          );
          if (cal) setCalendar(cal);
        }
      }
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const monthName = results ? t(`month.${results.month}`) : '';
  const myResult = results?.my_result;
  const myExchange = results?.my_exchange;
  const isWinner = myResult?.group === 'winner';

  const weekdayLabels = useMemo(() => [
    t('weekday.mon'), t('weekday.tue'), t('weekday.wed'), t('weekday.thu'),
    t('weekday.fri'), t('weekday.sat'), t('weekday.sun'),
  ], [t]);

  const formatPartner = (name: string, telegramId: string | null) => {
    if (telegramId) return `@${telegramId}`;
    return name;
  };

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />

        <main className={styles.main}>
          <Container>
            {isLoading ? (
              <div className={styles.loading}>{t('dashboard.loading')}</div>
            ) : !lastRound || !results ? (
              <div className={styles.empty}>{t('results.noResults')}</div>
            ) : (
              <>
                <div className={styles.title}>{t('results.marathon')}</div>
                <div className={styles.subtitle}>{monthName} {results.year}</div>

                <div className={styles.sections}>
                  {/* Left column */}
                  <div className={styles.leftCol}>
                    {/* Not participated message */}
                    {!myResult && (
                      <div className={styles.notParticipated}>
                        {t('results.notParticipated')}
                      </div>
                    )}

                    {/* Congrats / Exchange card */}
                    {myResult && (
                      <div className={styles.congratsCard}>
                        <div className={styles.congratsIcon}>
                          {isWinner ? '\uD83C\uDFC6' : '\uD83D\uDCD6'}
                        </div>
                        <div className={styles.congratsTitle}>
                          {isWinner ? t('results.congratsWinner') : t('results.congratsLoser')}
                        </div>
                        <div className={styles.congratsText}>
                          {isWinner ? t('results.congratsWinnerText') : t('results.congratsLoserText')}
                        </div>
                        {myExchange && (
                          <div className={styles.congratsPartner}>
                            {myExchange.role === 'giver'
                              ? t('results.giftTo')
                              : t('results.receiveFrom')
                            }{' '}
                            <span className={styles.congratsPartnerName}>
                              {formatPartner(myExchange.partner_name, myExchange.partner_telegram_id)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Personal stats */}
                    {myResult && (
                      <div className={styles.statsSection}>
                        <div className={styles.statsSectionTitle}>
                          {t('results.yourStats')}
                          <span className={styles.rankBadge}>
                            {t('results.place', { rank: myResult.rank })}
                          </span>
                        </div>
                        <div className={styles.statsRow}>
                          <div className={styles.statCard}>
                            <div className={styles.statValue}>
                              {myResult.total_minutes.toLocaleString()}
                            </div>
                            <div className={styles.statLabel}>{t('results.minutes')}</div>
                          </div>
                          <div className={styles.statCard}>
                            <div className={styles.statValue}>{myResult.total_score}</div>
                            <div className={styles.statLabel}>{t('results.days')}</div>
                          </div>
                          <div className={styles.statCard}>
                            <div className={styles.statValue}>#{myResult.rank}</div>
                            <div className={styles.statLabel}>{t('results.placeLabel')}</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Progress chart */}
                    {myResult && calendar && calendar.days.length > 0 && (
                      <div className={styles.chartSection}>
                        <div className={styles.chartTitle}>{t('results.progressMonth')}</div>
                        <ProgressChart days={calendar.days} />
                      </div>
                    )}

                    {/* Weekday activity chart */}
                    {myResult && calendar && calendar.days.length > 0 && (
                      <div className={styles.chartSection}>
                        <div className={styles.chartTitle}>{t('results.weekdayActivity')}</div>
                        <WeekdayChart days={calendar.days} weekdayLabels={weekdayLabels} />
                      </div>
                    )}
                  </div>

                  {/* Right column — Leaderboard */}
                  <div className={styles.leaderboardSection}>
                    <div className={styles.leaderboardTitle}>
                      <span className={styles.leaderboardTitleIcon}>{'\u2B50'}</span>
                      {t('results.topReaders')}
                    </div>
                    <div className={styles.leaderboardList}>
                      {results.results.map((entry) => {
                        const isSelf = user && entry.user_id === user.id;
                        const displayName = entry.telegram_id
                          ? `@${entry.telegram_id}`
                          : entry.display_name;
                        return (
                          <div
                            key={entry.user_id}
                            className={`${styles.leaderboardItem} ${isSelf ? styles.leaderboardItemSelf : ''}`}
                          >
                            <span className={styles.leaderboardRank}>#{entry.rank}</span>
                            <TrophyIcon rank={entry.rank} />
                            <span className={styles.leaderboardName}>{displayName}</span>
                            <span className={styles.leaderboardScore}>
                              {entry.total_score} {t('dashboard.daysShort')}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </>
            )}
          </Container>
        </main>

        <Footer />
      </div>
    </PageTransition>
  );
}
