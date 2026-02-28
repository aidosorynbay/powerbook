import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  useAuth,
  useI18n,
  apiGet,
  apiPost,
  DEFAULT_GROUP_SLUG,
  type RoundStatus,
  type CurrentRoundStatusResponse,
  type LeaderboardEntry,
  type CalendarResponse,
} from '@/shared/lib';
import { useScrollReveal } from '@/shared/hooks';
import { Button, Container, Badge, PageTransition } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import anim from '@/shared/styles/animations.module.css';
import styles from './DashboardPage.module.css';

function getStatusVariant(status: RoundStatus): 'success' | 'accent' | 'default' {
  if (status === 'registration_open') return 'success';
  if (status === 'locked') return 'accent';
  return 'default';
}

function getDayColorClass(minutes: number, dateStr: string, isLastDay: boolean, s: Record<string, string>): string {
  if (isLastDay) return s.dayLastDay;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(dateStr + 'T00:00:00');

  if (day > today) return s.dayFuture;
  if (minutes >= 30) return s.dayGreen;
  if (minutes >= 2) return s.dayYellow;
  return s.dayRed;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

type LastDayPhase = 'normal' | 'correction' | 'registration';

export function DashboardPage() {
  const { user } = useAuth();
  const { t } = useI18n();

  const weekdays = useMemo(() => [
    t('weekday.mon'), t('weekday.tue'), t('weekday.wed'),
    t('weekday.thu'), t('weekday.fri'), t('weekday.sat'), t('weekday.sun')
  ], [t]);

  const [roundStatus, setRoundStatus] = useState<CurrentRoundStatusResponse | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isJoiningNextRound, setIsJoiningNextRound] = useState(false);

  // Modal for logging minutes
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [minutesInput, setMinutesInput] = useState('');
  const [modalBookFinished, setModalBookFinished] = useState(false);
  const [modalComment, setModalComment] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Dual countdown timers
  const [lastDayPhase, setLastDayPhase] = useState<LastDayPhase>('normal');
  const [countdownMs, setCountdownMs] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastDayPhaseRef = useRef<LastDayPhase>('normal');

  // User calendar panel (clicking leaderboard entry — shown inline, not modal)
  const [viewUser, setViewUser] = useState<{ id: string; name: string } | null>(null);
  const [viewUserCalendar, setViewUserCalendar] = useState<CalendarResponse | null>(null);
  const [isLoadingUserCal, setIsLoadingUserCal] = useState(false);

  // Modal for leave confirmation
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  // Today panel state
  const [todayMinutes, setTodayMinutes] = useState('');
  const [todayBookFinished, setTodayBookFinished] = useState(false);
  const [todayComment, setTodayComment] = useState('');
  const [isSavingToday, setIsSavingToday] = useState(false);

  const fetchRoundStatus = useCallback(async () => {
    const { data } = await apiGet<CurrentRoundStatusResponse>(
      `/groups/by-slug/${DEFAULT_GROUP_SLUG}/current-round-status`,
      { requireAuth: true }
    );
    if (data) setRoundStatus(data);
  }, []);

  const fetchLeaderboard = useCallback(async (roundId: string) => {
    const { data } = await apiGet<LeaderboardEntry[]>(
      `/rounds/${roundId}/leaderboard`,
      { requireAuth: true }
    );
    if (data) setLeaderboard(data);
  }, []);

  const fetchCalendar = useCallback(async (roundId: string) => {
    const { data } = await apiGet<CalendarResponse>(
      `/rounds/${roundId}/calendar`,
      { requireAuth: true }
    );
    if (data) setCalendar(data);
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    await fetchRoundStatus();
    setIsLoading(false);
  }, [fetchRoundStatus]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (roundStatus?.round) {
      fetchLeaderboard(roundStatus.round.id);
      if (roundStatus.participation?.is_participant) {
        fetchCalendar(roundStatus.round.id);
      }
    }
  }, [roundStatus, fetchLeaderboard, fetchCalendar]);

  // Last day of the round's month
  const lastDayOfMonth = useMemo(() => {
    if (!roundStatus?.round) return 0;
    const { year, month } = roundStatus.round;
    return new Date(year, month, 0).getDate();
  }, [roundStatus?.round]);

  // Is today the last day of the round's month?
  const isLastDay = useMemo(() => {
    if (!roundStatus?.round || !lastDayOfMonth) return false;
    const now = new Date();
    const { year, month } = roundStatus.round;
    return now.getFullYear() === year && now.getMonth() + 1 === month && now.getDate() === lastDayOfMonth;
  }, [roundStatus?.round, lastDayOfMonth]);

  // Dual countdown: correction phase (until 8 PM) then registration phase (8 PM to midnight)
  useEffect(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }

    const correctionDeadlineStr = roundStatus?.correction_deadline_utc;
    const roundDeadlineStr = roundStatus?.deadline_utc;

    if (!correctionDeadlineStr || !roundDeadlineStr) {
      setCountdownMs(null);
      setLastDayPhase('normal');
      return;
    }

    const correctionMs = new Date(correctionDeadlineStr).getTime();
    const roundMs = new Date(roundDeadlineStr).getTime();

    const tick = () => {
      const now = Date.now();

      if (isLastDay && now < correctionMs) {
        // Phase 1: correction period (last day, before 8 PM)
        lastDayPhaseRef.current = 'correction';
        setLastDayPhase('correction');
        setCountdownMs(correctionMs - now);
      } else if (isLastDay && now >= correctionMs && now < roundMs) {
        // Phase 2: registration period (last day, 8 PM to midnight)
        if (lastDayPhaseRef.current !== 'registration') {
          // Phase just changed — refetch to pick up newly created next_round
          fetchRoundStatus();
        }
        lastDayPhaseRef.current = 'registration';
        setLastDayPhase('registration');
        setCountdownMs(roundMs - now);
      } else {
        lastDayPhaseRef.current = 'normal';
        setLastDayPhase('normal');
        setCountdownMs(null);
      }
    };

    tick();
    countdownRef.current = setInterval(tick, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [roundStatus?.correction_deadline_utc, roundStatus?.deadline_utc, isLastDay]);

  const handleJoin = async () => {
    if (!roundStatus?.round) return;
    setIsJoining(true);
    const { data } = await apiPost(`/rounds/${roundStatus.round.id}/join`, {}, { requireAuth: true });
    if (data) {
      await fetchRoundStatus();
    }
    setIsJoining(false);
  };

  const handleJoinNextRound = async () => {
    if (!roundStatus?.next_round) return;
    setIsJoiningNextRound(true);
    const { data } = await apiPost(`/rounds/${roundStatus.next_round.id}/join`, {}, { requireAuth: true });
    if (data) {
      await fetchRoundStatus();
    }
    setIsJoiningNextRound(false);
  };

  const openLeaveModal = () => setShowLeaveModal(true);
  const closeLeaveModal = () => setShowLeaveModal(false);

  const confirmLeave = async () => {
    if (!roundStatus?.round) return;
    setIsLeaving(true);
    const { data } = await apiPost(`/rounds/${roundStatus.round.id}/leave`, {}, { requireAuth: true });
    if (data) {
      closeLeaveModal();
      await fetchRoundStatus();
      setLeaderboard([]);
      setCalendar(null);
    }
    setIsLeaving(false);
  };

  const openLogModal = (date: string, currentMinutes: number) => {
    setSelectedDate(date);
    setMinutesInput(currentMinutes > 0 ? String(currentMinutes) : '');
    // Pre-populate book_finished and comment from calendar data
    const dayData = calendar?.days.find(d => d.date === date);
    setModalBookFinished(dayData?.book_finished ?? false);
    setModalComment(dayData?.comment ?? '');
  };

  const closeLogModal = () => {
    setSelectedDate(null);
    setMinutesInput('');
    setModalBookFinished(false);
    setModalComment('');
  };

  const selectUser = async (userId: string, displayName: string) => {
    if (!roundStatus?.round) return;
    // If clicking own entry, clear selection to go back to own calendar
    if (userId === user?.id) {
      setViewUser(null);
      setViewUserCalendar(null);
      return;
    }
    setViewUser({ id: userId, name: displayName });
    setViewUserCalendar(null);
    setIsLoadingUserCal(true);
    const { data } = await apiGet<CalendarResponse>(
      `/rounds/${roundStatus.round.id}/calendar/${userId}`,
      { requireAuth: true }
    );
    if (data) setViewUserCalendar(data);
    setIsLoadingUserCal(false);
  };

  const clearViewUser = () => {
    setViewUser(null);
    setViewUserCalendar(null);
  };

  const handleSaveMinutes = async () => {
    if (!roundStatus?.round || !selectedDate) return;
    const minutes = parseInt(minutesInput, 10) || 0;
    setIsSaving(true);
    const { data } = await apiPost(
      `/rounds/${roundStatus.round.id}/reading_logs`,
      { date: selectedDate, minutes, book_finished: modalBookFinished, comment: modalComment || null },
      { requireAuth: true }
    );
    if (data) {
      await fetchCalendar(roundStatus.round.id);
      await fetchLeaderboard(roundStatus.round.id);
      closeLogModal();
    }
    setIsSaving(false);
  };

  // Build calendar grid from a CalendarResponse
  const buildGrid = useCallback((cal: CalendarResponse, year: number, month: number) => {
    const firstDay = new Date(year, month - 1, 1);
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek < 0) startDayOfWeek = 6;

    const daysInMonth = new Date(year, month, 0).getDate();
    const dayMap = new Map(cal.days.map(d => [d.date, d]));

    const grid: Array<{ day: number; date: string; minutes: number; score: number; book_finished: boolean; comment: string | null } | null> = [];

    for (let i = 0; i < startDayOfWeek; i++) {
      grid.push(null);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayData = dayMap.get(dateStr);
      grid.push({
        day: d,
        date: dateStr,
        minutes: dayData?.minutes ?? 0,
        score: dayData?.score ?? 0,
        book_finished: dayData?.book_finished ?? false,
        comment: dayData?.comment ?? null,
      });
    }

    return grid;
  }, []);

  const calendarGrid = useMemo(() => {
    if (!roundStatus?.round || !calendar) return [];
    return buildGrid(calendar, roundStatus.round.year, roundStatus.round.month);
  }, [roundStatus?.round, calendar, buildGrid]);

  const viewUserGrid = useMemo(() => {
    if (!roundStatus?.round || !viewUserCalendar) return [];
    return buildGrid(viewUserCalendar, roundStatus.round.year, roundStatus.round.month);
  }, [roundStatus?.round, viewUserCalendar, buildGrid]);

  const isParticipant = roundStatus?.participation?.is_participant &&
    roundStatus.participation.status === 'active';

  const isBeforeDeadline = useMemo(() => {
    if (!roundStatus?.round) return false;
    const today = new Date();
    const { year, month, registration_open_until_day } = roundStatus.round;
    if (today.getFullYear() === year && today.getMonth() + 1 === month) {
      return today.getDate() <= registration_open_until_day;
    }
    return false;
  }, [roundStatus?.round]);

  const canJoin = roundStatus?.round?.status === 'registration_open' && isBeforeDeadline && !isParticipant;

  const canLeave = isParticipant && isBeforeDeadline;

  // Whether corrections are still allowed (last day before 8 PM)
  const correctionsOpen = isLastDay && lastDayPhase === 'correction';
  // Whether we're in the registration window (last day after 8 PM)
  const inRegistrationWindow = isLastDay && lastDayPhase === 'registration';

  // Scroll reveal for sections
  const { ref: sectionsRef, isVisible: sectionsVisible } = useScrollReveal<HTMLDivElement>();
  const revealClass = `${anim.scrollReveal} ${sectionsVisible ? anim.scrollRevealVisible : ''}`;

  // Today's date string
  const todayStr = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

  // Sync Today panel from calendar data when calendar loads/changes
  const todayData = useMemo(() => {
    return calendar?.days.find(d => d.date === todayStr) ?? null;
  }, [calendar, todayStr]);

  useEffect(() => {
    if (todayData) {
      setTodayMinutes(todayData.minutes > 0 ? String(todayData.minutes) : '');
      setTodayBookFinished(todayData.book_finished);
      setTodayComment(todayData.comment ?? '');
    }
  }, [todayData]);

  const handleSaveToday = async () => {
    if (!roundStatus?.round) return;
    const minutes = parseInt(todayMinutes, 10) || 0;
    setIsSavingToday(true);
    const { data } = await apiPost(
      `/rounds/${roundStatus.round.id}/reading_logs`,
      { date: todayStr, minutes, book_finished: todayBookFinished, comment: todayComment || null },
      { requireAuth: true }
    );
    if (data) {
      await fetchCalendar(roundStatus.round.id);
      await fetchLeaderboard(roundStatus.round.id);
    }
    setIsSavingToday(false);
  };

  if (isLoading) {
    return (
      <PageTransition>
        <div className={styles.page}>
          <Header />
        <main className={styles.main}>
          <Container>
            <div className={styles.loading}>{t('dashboard.loading')}</div>
          </Container>
        </main>
          <Footer />
        </div>
      </PageTransition>
    );
  }

  const monthName = roundStatus?.round
    ? t(`month.${roundStatus.round.month}`)
    : '';

  const displayStatus = roundStatus?.round?.status === 'registration_open' && !isBeforeDeadline
    ? 'locked' as const
    : roundStatus?.round?.status;
  const statusLabel = displayStatus ? t(`status.${displayStatus}`) : '';

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />

        <main className={styles.main}>
        <Container>
          <div className={styles.header}>
            <div className={styles.greeting}>
              {t('dashboard.greeting', { name: user?.display_name ?? 'User' })}
            </div>
          </div>

          {/* Full-screen takeover: registration window after 8 PM on last day */}
          {inRegistrationWindow ? (
            <div className={styles.nextRoundTakeover}>
              <div className={styles.nextRoundTakeoverTitle}>{t('dashboard.untilNextRound')}</div>
              {countdownMs !== null && (
                <div className={styles.nextRoundTakeoverTimer}>{formatCountdown(countdownMs)}</div>
              )}
              {roundStatus?.next_round && roundStatus.next_round.status === 'registration_open' ? (
                roundStatus.next_round_participation?.is_participant ? (
                  <p className={styles.nextRoundTakeoverRegistered}>{t('dashboard.registeredNextRound')}</p>
                ) : (
                  <Button onClick={handleJoinNextRound} disabled={isJoiningNextRound}>
                    {isJoiningNextRound ? t('dashboard.registeringNextRound') : t('dashboard.registerNextRound')}
                  </Button>
                )
              ) : (
                <p className={styles.nextRoundTakeoverHint}>{t('dashboard.nextRoundSoon')}</p>
              )}
            </div>
          ) : !roundStatus?.round ? (
            <div className={styles.noRound}>
              <div className={styles.noRoundTitle}>{t('dashboard.noRoundTitle')}</div>
              <p>{t('dashboard.noRoundText')}</p>
            </div>
          ) : (
            <>
              <div className={styles.roundInfo}>
                <div className={styles.roundHeader}>
                  <div className={styles.roundTitle}>
                    {monthName} {roundStatus.round.year}
                  </div>
                  <Badge variant={getStatusVariant(displayStatus!)}>
                    {statusLabel}
                  </Badge>
                </div>
                {isBeforeDeadline && roundStatus.round.status === 'registration_open' && (
                  <div className={styles.roundMeta}>
                    <span>{t('dashboard.registrationUntil', { day: roundStatus.round.registration_open_until_day })}</span>
                  </div>
                )}
              </div>

              {canJoin && (
                <div className={styles.joinSection}>
                  <div className={styles.joinTitle}>{t('dashboard.joinTitle')}</div>
                  <div className={styles.joinSubtitle}>
                    {t('dashboard.joinSubtitle')}
                  </div>
                  <Button onClick={handleJoin} disabled={isJoining}>
                    {isJoining ? t('dashboard.joining') : t('dashboard.joinBtn')}
                  </Button>
                </div>
              )}

              {/* Color & symbol legend */}
              <div className={styles.legend}>
                <span className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.legendGreen}`} />
                  {t('dashboard.legend30')}
                </span>
                <span className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.legendYellow}`} />
                  {t('dashboard.legend2')}
                </span>
                <span className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.legendRed}`} />
                  {t('dashboard.legendMissed')}
                </span>
                <span className={styles.legendItem}>
                  <span className={styles.legendSymbol}>&#9733;</span>
                  {t('dashboard.legendStar')}
                </span>
                <span className={styles.legendItem}>
                  <span className={styles.legendCommentDot} />
                  {t('dashboard.legendComment')}
                </span>
              </div>

              <div ref={sectionsRef} className={styles.sections}>
                <div className={`${styles.section} ${revealClass} ${anim.scrollRevealDelay1}`}>
                  <div className={styles.sectionTitle}>{t('dashboard.leaderboard')}</div>
                  {leaderboard.length === 0 ? (
                    <div className={styles.emptyState}>{t('dashboard.noParticipants')}</div>
                  ) : (
                    <div className={styles.leaderboard}>
                      {leaderboard.map((entry, idx) => {
                        const isSelf = entry.user_id === user?.id;
                        const isSelected = entry.user_id === viewUser?.id;
                        return (
                          <div
                            key={entry.user_id}
                            className={`${styles.leaderboardItem} ${styles.clickable} ${isSelf ? styles.isMe : ''} ${isSelected ? styles.isSelected : ''}`}
                            onClick={() => selectUser(entry.user_id, entry.display_name)}
                          >
                            <div className={styles.rank}>{idx + 1}</div>
                            <div className={styles.participantName}>
                              {entry.telegram_id ? (
                                <a
                                  href={`https://t.me/${entry.telegram_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={styles.telegramLink}
                                  onClick={e => e.stopPropagation()}
                                >
                                  @{entry.telegram_id}
                                </a>
                              ) : (
                                entry.display_name
                              )}
                            </div>
                            <div className={styles.participantScore}>{entry.total_score} {t('dashboard.daysShort')}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Right panel: viewed user's calendar OR own calendar */}
                {viewUser ? (
                  <div className={`${styles.section} ${revealClass} ${anim.scrollRevealDelay2}`}>
                    <div className={styles.calendarHeaderRow}>
                      <div className={styles.sectionTitle}>
                        {t('dashboard.userCalendar', { name: viewUser.name })}
                        {viewUserCalendar && (
                          <Badge variant="default" size="sm">
                            {viewUserCalendar.total_score} / {viewUserCalendar.days.length} {t('dashboard.daysShort')}
                          </Badge>
                        )}
                      </div>
                      <Button variant="ghost" size="sm" onClick={clearViewUser}>
                        {isParticipant ? t('dashboard.myCalendar') : t('dashboard.cancel')}
                      </Button>
                    </div>

                    {isLoadingUserCal ? (
                      <div className={styles.emptyState}>{t('dashboard.loading')}</div>
                    ) : viewUserCalendar ? (
                      <div className={styles.calendar}>
                        {weekdays.map(day => (
                          <div key={day} className={styles.calendarHeader}>{day}</div>
                        ))}
                        {viewUserGrid.map((cell, idx) => {
                          if (cell === null) {
                            return <div key={`empty-${idx}`} className={`${styles.calendarDay} ${styles.empty}`} />;
                          }
                          const cellIsLastDay = cell.day === lastDayOfMonth;
                          const colorClass = getDayColorClass(cell.minutes, cell.date, cellIsLastDay, styles);
                          return (
                            <div
                              key={cell.date}
                              className={`${styles.calendarDay} ${colorClass}`}
                              style={{ cursor: 'default' }}
                            >
                              {cellIsLastDay ? (
                                <span className={styles.dayFinishIcon}>&#127937;</span>
                              ) : (
                                <span className={styles.dayNumber}>{cell.day}</span>
                              )}
                              {cell.minutes > 0 && !cellIsLastDay && (
                                <span className={styles.dayMinutes}>{cell.minutes}m</span>
                              )}
                              {cell.book_finished && <span className={styles.dayStar}>&#9733;</span>}
                              {cell.comment && <span className={styles.dayCommentDot} />}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : isParticipant && !inRegistrationWindow ? (
                  <div className={`${styles.section} ${revealClass} ${anim.scrollRevealDelay2}`}>
                    <div className={styles.calendarHeaderRow}>
                      <div className={styles.sectionTitle}>
                        {t('dashboard.myCalendar')}
                        {calendar && (
                          <Badge variant="default" size="sm">
                            {calendar.total_score} / {calendar.days.length} {t('dashboard.daysShort')}
                          </Badge>
                        )}
                      </div>
                      {canLeave && (
                        <div className={styles.leaveActions}>
                          <span className={styles.leaveHint}>
                            {t('dashboard.leaveDeadline', { day: roundStatus.round.registration_open_until_day })}
                          </span>
                          <Button variant="ghost" size="sm" onClick={openLeaveModal} disabled={isLeaving}>
                            {isLeaving ? t('dashboard.leaving') : t('dashboard.leaveBtn')}
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className={styles.calendar}>
                      {weekdays.map(day => (
                        <div key={day} className={styles.calendarHeader}>{day}</div>
                      ))}
                      {calendarGrid.map((cell, idx) => {
                        if (cell === null) {
                          return <div key={`empty-${idx}`} className={`${styles.calendarDay} ${styles.empty}`} />;
                        }
                        const cellIsLastDay = cell.day === lastDayOfMonth;
                        const colorClass = getDayColorClass(cell.minutes, cell.date, cellIsLastDay, styles);
                        const lastDayClickable = cellIsLastDay && correctionsOpen;
                        const canClick = !cellIsLastDay || lastDayClickable;
                        return (
                          <div
                            key={cell.date}
                            className={`${styles.calendarDay} ${colorClass}`}
                            style={lastDayClickable ? { cursor: 'pointer', opacity: 1 } : undefined}
                            onClick={canClick ? () => openLogModal(cell.date, cell.minutes) : undefined}
                            title={cellIsLastDay ? t('dashboard.lastDayCorrection') : undefined}
                          >
                            {cellIsLastDay ? (
                              <span className={styles.dayFinishIcon}>&#127937;</span>
                            ) : (
                              <span className={styles.dayNumber}>{cell.day}</span>
                            )}
                            {cell.minutes > 0 && !cellIsLastDay && (
                              <span className={styles.dayMinutes}>{cell.minutes}m</span>
                            )}
                            {cell.book_finished && <span className={styles.dayStar}>&#9733;</span>}
                            {cell.comment && <span className={styles.dayCommentDot} />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {/* Today panel — third column */}
                {isParticipant && !inRegistrationWindow && (
                  <div className={`${styles.section} ${revealClass} ${anim.scrollRevealDelay3}`}>
                    <div className={styles.sectionTitle}>{t('dashboard.today')}</div>
                    <div className={styles.todayPanel}>
                      <div className={styles.todayDate}>{todayStr}</div>

                      {/* Correction countdown — subtle, inside Today panel */}
                      {correctionsOpen && countdownMs !== null && (
                        <div className={styles.correctionNotice}>
                          <span className={styles.correctionLabel}>{t('dashboard.correctionPeriod')}</span>
                          <span className={styles.correctionTimer}>{formatCountdown(countdownMs)}</span>
                        </div>
                      )}

                      {isLastDay && lastDayPhase === 'normal' && (
                        <div className={styles.correctionNotice}>
                          <span className={styles.correctionLabel}>{t('dashboard.lastDay')}</span>
                        </div>
                      )}

                      <div className={styles.todayField}>
                        <label className={styles.todayLabel}>{t('dashboard.logMinutes')}</label>
                        <input
                          type="number"
                          min="0"
                          max="1440"
                          className={styles.todayInput}
                          value={todayMinutes}
                          onChange={e => setTodayMinutes(e.target.value)}
                          placeholder="30"
                        />
                      </div>

                      <label className={styles.todayCheckbox}>
                        <input
                          type="checkbox"
                          checked={todayBookFinished}
                          onChange={e => setTodayBookFinished(e.target.checked)}
                        />
                        {t('dashboard.bookFinished')}
                      </label>

                      <div className={styles.todayField}>
                        <label className={styles.todayLabel}>{t('dashboard.addComment')}</label>
                        <textarea
                          className={styles.todayTextarea}
                          value={todayComment}
                          onChange={e => setTodayComment(e.target.value)}
                          placeholder={t('dashboard.commentPlaceholder')}
                        />
                      </div>

                      <Button onClick={handleSaveToday} disabled={isSavingToday}>
                        {isSavingToday ? t('dashboard.saving') : t('dashboard.save')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </Container>
      </main>

      <Footer />

      {/* Log minutes modal */}
      {selectedDate && (
        <div className={styles.modal} onClick={closeLogModal}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>
              {t('dashboard.logTitle', { date: selectedDate })}
            </div>
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>{t('dashboard.logMinutes')}</label>
              <input
                type="number"
                min="0"
                max="1440"
                className={styles.modalInput}
                value={minutesInput}
                onChange={e => setMinutesInput(e.target.value)}
                placeholder="30"
                autoFocus
              />
            </div>
            <div className={styles.modalField}>
              <label className={styles.todayCheckbox}>
                <input
                  type="checkbox"
                  checked={modalBookFinished}
                  onChange={e => setModalBookFinished(e.target.checked)}
                />
                {t('dashboard.bookFinished')}
              </label>
            </div>
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>{t('dashboard.addComment')}</label>
              <textarea
                className={styles.todayTextarea}
                value={modalComment}
                onChange={e => setModalComment(e.target.value)}
                placeholder={t('dashboard.commentPlaceholder')}
              />
            </div>
            <div className={styles.modalActions}>
              <Button variant="ghost" onClick={closeLogModal}>
                {t('dashboard.cancel')}
              </Button>
              <Button onClick={handleSaveMinutes} disabled={isSaving}>
                {isSaving ? t('dashboard.saving') : t('dashboard.save')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Leave round confirmation modal */}
      {showLeaveModal && (
        <div className={styles.modal} onClick={closeLeaveModal}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>{t('dashboard.leaveConfirm')}</div>
            <div className={styles.modalActions}>
              <Button variant="ghost" onClick={closeLeaveModal}>
                {t('dashboard.cancel')}
              </Button>
              <Button variant="primary" onClick={confirmLeave} disabled={isLeaving}>
                {isLeaving ? t('dashboard.leaving') : t('dashboard.leaveConfirmBtn')}
              </Button>
            </div>
          </div>
        </div>
      )}
      </div>
    </PageTransition>
  );
}
