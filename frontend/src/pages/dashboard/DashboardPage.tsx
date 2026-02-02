import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { Button, Container, Badge } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import styles from './DashboardPage.module.css';

function getStatusVariant(status: RoundStatus): 'success' | 'accent' | 'default' {
  if (status === 'registration_open') return 'success';
  if (status === 'locked') return 'accent';
  return 'default';
}

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

  // Modal for logging minutes
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [minutesInput, setMinutesInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Modal for leave confirmation
  const [showLeaveModal, setShowLeaveModal] = useState(false);

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
    if (roundStatus?.round && roundStatus.participation?.is_participant) {
      fetchLeaderboard(roundStatus.round.id);
      fetchCalendar(roundStatus.round.id);
    }
  }, [roundStatus, fetchLeaderboard, fetchCalendar]);

  const handleJoin = async () => {
    if (!roundStatus?.round) return;
    setIsJoining(true);
    const { data } = await apiPost(`/rounds/${roundStatus.round.id}/join`, {}, { requireAuth: true });
    if (data) {
      await fetchRoundStatus();
    }
    setIsJoining(false);
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
  };

  const closeLogModal = () => {
    setSelectedDate(null);
    setMinutesInput('');
  };

  const handleSaveMinutes = async () => {
    if (!roundStatus?.round || !selectedDate) return;
    const minutes = parseInt(minutesInput, 10) || 0;
    setIsSaving(true);
    const { data } = await apiPost(
      `/rounds/${roundStatus.round.id}/reading_logs`,
      { date: selectedDate, minutes },
      { requireAuth: true }
    );
    if (data) {
      await fetchCalendar(roundStatus.round.id);
      await fetchLeaderboard(roundStatus.round.id);
      closeLogModal();
    }
    setIsSaving(false);
  };

  // Build calendar grid
  const calendarGrid = useMemo(() => {
    if (!roundStatus?.round || !calendar) return [];

    const { year, month } = roundStatus.round;
    const firstDay = new Date(year, month - 1, 1);
    // getDay() returns 0 for Sunday, we want Monday = 0
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek < 0) startDayOfWeek = 6;

    const daysInMonth = new Date(year, month, 0).getDate();
    const dayMap = new Map(calendar.days.map(d => [d.date, d]));

    const grid: Array<{ day: number; date: string; minutes: number; score: number } | null> = [];

    // Empty cells before first day
    for (let i = 0; i < startDayOfWeek; i++) {
      grid.push(null);
    }

    // Days of the month
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayData = dayMap.get(dateStr);
      grid.push({
        day: d,
        date: dateStr,
        minutes: dayData?.minutes ?? 0,
        score: dayData?.score ?? 0,
      });
    }

    return grid;
  }, [roundStatus?.round, calendar]);

  const isParticipant = roundStatus?.participation?.is_participant &&
    roundStatus.participation.status === 'active';

  const canJoin = roundStatus?.round?.status === 'registration_open' && !isParticipant;

  // Can leave only if participant and before the deadline (day of month <= registration_open_until_day)
  const canLeave = useMemo(() => {
    if (!isParticipant || !roundStatus?.round) return false;
    const today = new Date();
    const { year, month, registration_open_until_day } = roundStatus.round;
    // Check if we're in the same month as the round and before the deadline
    if (today.getFullYear() === year && today.getMonth() + 1 === month) {
      return today.getDate() <= registration_open_until_day;
    }
    return false;
  }, [isParticipant, roundStatus?.round]);

  if (isLoading) {
    return (
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container>
            <div className={styles.loading}>{t('dashboard.loading')}</div>
          </Container>
        </main>
        <Footer />
      </div>
    );
  }

  const monthName = roundStatus?.round
    ? t(`month.${roundStatus.round.month}`)
    : '';
  const statusLabel = roundStatus?.round
    ? t(`status.${roundStatus.round.status}`)
    : '';

  return (
    <div className={styles.page}>
      <Header />

      <main className={styles.main}>
        <Container>
          <div className={styles.header}>
            <div className={styles.greeting}>
              {t('dashboard.greeting', { name: user?.display_name ?? 'User' })}
            </div>
          </div>

          {!roundStatus?.round ? (
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
                  <Badge variant={getStatusVariant(roundStatus.round.status)}>
                    {statusLabel}
                  </Badge>
                </div>
                <div className={styles.roundMeta}>
                  <span>{t('dashboard.registrationUntil', { day: roundStatus.round.registration_open_until_day })}</span>
                </div>
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

              {isParticipant && (
                <div className={styles.sections}>
                  <div className={styles.section}>
                    <div className={styles.sectionTitle}>{t('dashboard.leaderboard')}</div>
                    {leaderboard.length === 0 ? (
                      <div className={styles.emptyState}>{t('dashboard.noParticipants')}</div>
                    ) : (
                      <div className={styles.leaderboard}>
                        {leaderboard.map((entry, idx) => (
                          <div
                            key={entry.user_id}
                            className={`${styles.leaderboardItem} ${entry.user_id === user?.id ? styles.isMe : ''}`}
                          >
                            <div className={styles.rank}>{idx + 1}</div>
                            <div className={styles.participantName}>{entry.display_name}</div>
                            <div className={styles.participantScore}>{entry.total_score} {t('dashboard.daysShort')}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className={styles.section}>
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
                      {calendarGrid.map((cell, idx) => (
                        cell === null ? (
                          <div key={`empty-${idx}`} className={`${styles.calendarDay} ${styles.empty}`} />
                        ) : (
                          <div
                            key={cell.date}
                            className={`${styles.calendarDay} ${cell.score > 0 ? styles.hasScore : ''}`}
                            onClick={() => openLogModal(cell.date, cell.minutes)}
                          >
                            <span className={styles.dayNumber}>{cell.day}</span>
                            {cell.minutes > 0 && (
                              <span className={styles.dayMinutes}>{cell.minutes}m</span>
                            )}
                          </div>
                        )
                      ))}
                    </div>
                  </div>
                </div>
              )}
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
  );
}
