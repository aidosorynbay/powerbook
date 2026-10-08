import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  useAuth,
  useI18n,
  apiGet,
  apiPost,
  useWaitlist,
  DEFAULT_GROUP_SLUG,
  type RoundStatus,
  type CurrentRoundStatusResponse,
  type LeaderboardEntry,
  type CalendarResponse,
  type CalendarDay,
  type DayBook,
  type ReadingBooksResponse,
  type RosterResponse,
  type AllTimeProfile,
  track,
} from '@/shared/lib';
import { useScrollReveal } from '@/shared/hooks';
import { Button, Container, Badge, PageTransition, Icon } from '@/shared/ui';
import { Header, Footer, ActivityRings, ReadingRoom, type ActivityRing, type RingTotal, WaitlistCard, ArchiveNews } from '@/widgets';
import { JoinedCount, RoundRules } from '@/widgets/JoinPrompt';
import { BarysCard } from '@/widgets/Mascot';
import { ShareDay } from '@/widgets/ShareDay';
import anim from '@/shared/styles/animations.module.css';
import { quietDayIcon, quietDayQuoteKeys, finishFlagIcon } from '@/shared/lib/quietDays';
import { ReadingBooks, booksPayload, sumMinutes } from './ReadingBooks';
import styles from './DashboardPage.module.css';

function getStatusVariant(status: RoundStatus): 'success' | 'accent' | 'default' {
  if (status === 'registration_open') return 'success';
  if (status === 'locked') return 'accent';
  return 'default';
}

/** Minutes a day has to reach to score a point. */
const DAILY_GOAL_MINUTES = 30;

function getDayColorClass(minutes: number, dateStr: string, isLastDay: boolean, s: Record<string, string>): string {
  if (isLastDay) return s.dayLastDay;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(dateStr + 'T00:00:00');

  if (day > today) return s.dayFuture;
  if (minutes >= DAILY_GOAL_MINUTES) return s.dayGreen;
  if (minutes >= 2) return s.dayYellow;
  return s.dayRed;
}

function ProgressRing({ pct, trackColor, fillColor, children }: {
  pct: number;
  trackColor?: string;
  fillColor?: string;
  children: React.ReactNode;
}) {
  const R = 42;
  const C = 2 * Math.PI * R;
  const clamped = Math.min(Math.max(pct, 0), 1);
  return (
    <svg width="110" height="110" viewBox="0 0 110 110">
      <circle cx="55" cy="55" r={R} fill="none" stroke={trackColor ?? 'var(--color-bg-secondary)'} strokeWidth="10" />
      <circle
        cx="55" cy="55" r={R} fill="none"
        stroke={fillColor ?? 'var(--color-accent-primary)'} strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${C * clamped} ${C}`}
        transform="rotate(-90 55 55)"
        style={{ transition: 'stroke-dasharray var(--transition-slow, 0.6s ease)' }}
      />
      <text x="55" y="61" textAnchor="middle" fontSize="26" fontWeight="800" fill="var(--color-text-primary)">
        {children}
      </text>
    </svg>
  );
}

function RoundProgressRing({ daysLeft, daysTotal }: { daysLeft: number; daysTotal: number }) {
  // Fill tracks what is still ahead: a round that hasn't started shows a
  // full ring and empties as the days are used up.
  const pct = daysTotal > 0 ? daysLeft / daysTotal : 0;
  return <ProgressRing pct={pct}>{daysLeft}</ProgressRing>;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Countdown split into labelled parts, so "5 h 12 m" reads at a glance
 *  where "5:12:44" has to be decoded. Seconds only appear in the final hour,
 *  when they are the thing that actually matters. */
function countdownParts(ms: number): { value: number; unit: 'h' | 'm' | 's' }[] {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return [{ value: h, unit: 'h' }, { value: m, unit: 'm' }];
  return [{ value: m, unit: 'm' }, { value: s, unit: 's' }];
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

  // Standard competition ranking: same score → same rank, next rank skips
  const leaderboardRanks = useMemo(() => {
    const ranks: number[] = [];
    let rank = 1;
    for (let i = 0; i < leaderboard.length; i++) {
      if (i > 0 && leaderboard[i].total_score < leaderboard[i - 1].total_score) rank = i + 1;
      ranks.push(rank);
    }
    return ranks;
  }, [leaderboard]);
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [allTime, setAllTime] = useState<AllTimeProfile | null>(null);
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [rosterModalDate, setRosterModalDate] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isJoiningNextRound, setIsJoiningNextRound] = useState(false);

  // Modal for logging minutes
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [minutesInput, setMinutesInput] = useState('');
  // Day tapped on a decorative (out-of-round) cell, or null
  const [quietDay, setQuietDay] = useState<number | null>(null);
  const [calendarView, setCalendarView] = useState<'circle' | 'mine'>('mine');
  const [modalBookFinished, setModalBookFinished] = useState(false);
  const [modalComment, setModalComment] = useState('');
  const [modalCommentPrivate, setModalCommentPrivate] = useState(false);
  const [modalBooks, setModalBooks] = useState<DayBook[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  // «Что читаю»: the book the forms start with, and recent others to offer.
  const [readingBooks, setReadingBooks] = useState<ReadingBooksResponse | null>(null);

  // Dual countdown timers
  const [lastDayPhase, setLastDayPhase] = useState<LastDayPhase>('normal');
  const [countdownMs, setCountdownMs] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastDayPhaseRef = useRef<LastDayPhase>('normal');

  // User calendar panel (clicking leaderboard entry — shown inline, not modal)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const [viewUser, setViewUser] = useState<{ id: string; name: string } | null>(null);
  const [viewUserCalendar, setViewUserCalendar] = useState<CalendarResponse | null>(null);
  const [isLoadingUserCal, setIsLoadingUserCal] = useState(false);

  // Modal for leave confirmation
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  // Today panel state
  const [todayMinutes, setTodayMinutes] = useState('');
  const [todayBookFinished, setTodayBookFinished] = useState(false);
  const [todayComment, setTodayComment] = useState('');
  const [todayCommentPrivate, setTodayCommentPrivate] = useState(false);
  const [isSavingToday, setIsSavingToday] = useState(false);
  // «Поделиться днём»: the sheet, and whether this save is the one that reached 30 minutes.
  // The day the share sheet is open on: today, or a day picked on the calendar.
  const [sharing, setSharing] = useState<string | null>(null);
  const [goalJustMet, setGoalJustMet] = useState(false);
  const [todayBooks, setTodayBooks] = useState<DayBook[]>([]);

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
    const { data: books } = await apiGet<ReadingBooksResponse>(`/rounds/${roundId}/reading_books`, { requireAuth: true });
    if (books) setReadingBooks(books);
  }, []);

  // All-time minutes for the tally under the rings. It is a nice-to-have:
  // if it never arrives the rings still render, just without that line.
  const fetchAllTime = useCallback(async () => {
    const { data } = await apiGet<AllTimeProfile>('/insights/profile', { requireAuth: true });
    if (data) setAllTime(data);
  }, []);

  const fetchRoster = useCallback(async (roundId: string) => {
    const { data } = await apiGet<RosterResponse>(
      `/rounds/${roundId}/roster`,
      { requireAuth: true }
    );
    if (data) setRoster(data);
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    await fetchRoundStatus();
    setIsLoading(false);
  }, [fetchRoundStatus]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // A phone keeps this page open for hours and brings it back as it was. Back after a while, the page asks for its
  // numbers again (minutes written meanwhile in the reading room or on another device), and «Сегодня» moves on to a
  // new day.
  const [dayNow, setDayNow] = useState(() => new Date());
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > 60_000) {
        setDayNow(new Date());
        fetchRoundStatus();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [fetchRoundStatus]);

  useEffect(() => {
    if (roundStatus?.round) {
      fetchLeaderboard(roundStatus.round.id);
      fetchRoster(roundStatus.round.id);
      if (roundStatus.participation?.is_participant) {
        fetchCalendar(roundStatus.round.id);
        fetchAllTime();
      }
    }
  }, [roundStatus, fetchLeaderboard, fetchCalendar, fetchRoster, fetchAllTime]);

  // Last day of the round's month
  const lastDayOfMonth = useMemo(() => {
    if (!roundStatus?.round) return 0;
    const { year, month } = roundStatus.round;
    return new Date(year, month, 0).getDate();
  }, [roundStatus?.round]);

  // The round's own slice of the month. A normal round is the whole
  // month; a mini-round is narrower, and days outside it don't count.
  const roundWindow = useMemo(() => {
    const r = roundStatus?.round;
    const start = Math.max(1, r?.start_day ?? 1);
    const end = Math.min(r?.end_day ?? lastDayOfMonth, lastDayOfMonth);
    // The round's last day is for corrections only and scores nothing (the
    // server's resync_scores), so the days that count stop the day before:
    // a 30-day September is 29 days to read, as the leaderboard's "29 дн." says.
    const scoringEnd = Math.max(start, end - 1);
    return { start, end, scoringEnd, total: Math.max(1, scoringEnd - start + 1) };
  }, [roundStatus?.round, lastDayOfMonth]);

  const roundDaysLeft = useMemo(() => {
    const now = new Date();
    const r = roundStatus?.round;
    if (!r) return 0;
    if (now.getFullYear() !== r.year || now.getMonth() + 1 !== r.month) return 0;
    // Before the round opens every day is still ahead of you.
    if (now.getDate() < roundWindow.start) return roundWindow.total;
    return Math.max(0, roundWindow.scoringEnd - now.getDate());
  }, [roundStatus?.round, roundWindow]);

  const roundDaysElapsed = useMemo(() => {
    if (!roundStatus?.round) return 0;
    const { year, month } = roundStatus.round;
    const now = new Date();
    const inThisMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
    // Count days inside the round's window, not days of the month: a round
    // starting on the 15th must not be judged against the 1st.
    if (inThisMonth) {
      const today = now.getDate();
      if (today < roundWindow.start) return 0;
      return Math.min(today, roundWindow.scoringEnd) - roundWindow.start + 1;
    }
    return now > new Date(year, month - 1, 1) ? roundWindow.total : 0;
  }, [roundStatus?.round, roundWindow]);

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
      refreshWait();
    }
    setIsJoining(false);
  };

  const handleJoinNextRound = async () => {
    if (!roundStatus?.next_round) return;
    setIsJoiningNextRound(true);
    const { data } = await apiPost(`/rounds/${roundStatus.next_round.id}/join`, {}, { requireAuth: true });
    if (data) {
      await fetchRoundStatus();
      refreshWait();
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

  /** The books a day's form starts with: what the day was read on, or — for a
   * day not logged yet, and for today — the book the reader is on. */
  const startBooks = (day: CalendarDay | null | undefined): DayBook[] => {
    if (day?.books?.length) return day.books;
    if (!day || day.minutes === 0 || day.date === todayStr) {
      return (readingBooks?.current ?? []).map((title) => ({ title, minutes: 0, finished: false }));
    }
    return [];
  };
  const bookSuggestions = useMemo(
    () => [...(readingBooks?.current ?? []), ...(readingBooks?.recent ?? [])],
    [readingBooks],
  );

  const openLogModal = (date: string, currentMinutes: number) => {
    setSelectedDate(date);
    setMinutesInput(currentMinutes > 0 ? String(currentMinutes) : '');
    // Pre-populate book_finished and comment from calendar data
    const dayData = calendar?.days.find(d => d.date === date);
    setModalBookFinished(dayData?.book_finished ?? false);
    setModalComment(dayData?.comment ?? '');
    setModalCommentPrivate(dayData?.comment_private ?? false);
    setModalBooks(startBooks(dayData));
  };

  const closeLogModal = () => {
    setSelectedDate(null);
    setMinutesInput('');
    setModalBookFinished(false);
    setModalComment('');
    setModalCommentPrivate(false);
    setModalBooks([]);
  };

  const openRosterModal = (date: string) => setRosterModalDate(date);
  const closeRosterModal = () => setRosterModalDate(null);

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
    const multi = modalBooks.length > 1;
    const minutes = multi ? sumMinutes(modalBooks) : parseInt(minutesInput, 10) || 0;
    const finished = multi ? modalBooks.some((b) => b.finished) : modalBookFinished;
    setIsSaving(true);
    const { data } = await apiPost(
      `/rounds/${roundStatus.round.id}/reading_logs`,
      {
        date: selectedDate, minutes, book_finished: finished,
        comment: modalComment || null, comment_private: modalCommentPrivate,
        books: booksPayload(modalBooks, minutes, modalBookFinished),
      },
      { requireAuth: true }
    );
    if (data) {
      track('minutes_logged', { minutes, where: 'calendar', book_finished: finished, books: modalBooks.length });
      await fetchCalendar(roundStatus.round.id);
      await fetchLeaderboard(roundStatus.round.id);
      await fetchRoster(roundStatus.round.id);
      closeLogModal();
    }
    setIsSaving(false);
  };

  const circleCalendarGrid = useMemo(() => {
    if (!roundStatus?.round) return [];
    const { year, month } = roundStatus.round;
    const firstDay = new Date(year, month - 1, 1);
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek < 0) startDayOfWeek = 6;
    const daysInMonth = new Date(year, month, 0).getDate();

    const grid: Array<{ day: number; date: string } | null> = [];
    for (let i = 0; i < startDayOfWeek; i++) {
      grid.push(null);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      grid.push({ day: d, date: dateStr });
    }
    return grid;
  }, [roundStatus?.round]);

  // Build calendar grid from a CalendarResponse
  const buildGrid = useCallback((cal: CalendarResponse, year: number, month: number) => {
    const firstDay = new Date(year, month - 1, 1);
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek < 0) startDayOfWeek = 6;

    const daysInMonth = new Date(year, month, 0).getDate();
    const dayMap = new Map(cal.days.map(d => [d.date, d]));

    const grid: Array<{ day: number; date: string; minutes: number; score: number; book_finished: boolean; comment: string | null; in_round: boolean } | null> = [];

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
        in_round: dayData?.in_round !== false,
      });
    }

    return grid;
  }, []);

  const calendarGrid = useMemo(() => {
    if (!roundStatus?.round || !calendar) return [];
    return buildGrid(calendar, roundStatus.round.year, roundStatus.round.month);
  }, [roundStatus?.round, calendar, buildGrid]);

  // Current streak within THIS round only — consecutive "good" days (30+ min)
  // counting back from the most recent day that's already happened.
  const personalStreak = useMemo(() => {
    const today = new Date().getDate();
    const cells = calendarGrid.filter((c): c is NonNullable<typeof c> => c !== null);
    let streak = 0;
    for (let i = cells.length - 1; i >= 0; i--) {
      const cell = cells[i];
      if (cell.day > today || cell.day < roundWindow.start) continue;
      if (cell.score === 1) {
        streak++;
        continue;
      }
      // An unlogged today is simply a day still in progress — the streak only
      // breaks once the day is over.
      if (cell.day === today) continue;
      break;
    }
    return streak;
  }, [calendarGrid, roundWindow]);

  // Yesterday under 30 minutes (and within the round): Барыс went hungry.
  const brokeYesterday = useMemo(() => {
    const yesterday = new Date().getDate() - 1;
    if (yesterday < roundWindow.start) return false;
    const cell = calendarGrid.find((c) => c !== null && c.day === yesterday);
    return !!cell && cell.score !== 1;
  }, [calendarGrid, roundWindow]);

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

  // How many are already in the circle that is open for sign-up.
  const { state: wait, refresh: refreshWait } = useWaitlist();
  const joinedCount =
    wait?.phase === 'registration' && wait.joined > 0 ? <JoinedCount n={wait.joined} month={wait.month} /> : null;

  // Scroll reveal for sections
  const { ref: sectionsRef, isVisible: sectionsVisible } = useScrollReveal<HTMLDivElement>();
  const joinHookKey = useMemo(() => `dashboard.joinHook${1 + Math.floor(Math.random() * 5)}`, []);
  const revealClass = `${anim.scrollReveal} ${sectionsVisible ? anim.scrollRevealVisible : ''}`;

  // The status menu closes the way every menu should: a click anywhere else,
  // or Escape.
  useEffect(() => {
    if (!statusMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!statusMenuRef.current?.contains(e.target as Node)) setStatusMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setStatusMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [statusMenuOpen]);

  // Today's date string (it moves on when the page comes back on a new day, see dayNow)
  const todayStr = useMemo(() => {
    const now = dayNow;
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, [dayNow]);

  // Sync Today panel from calendar data when calendar loads/changes
  const todayData = useMemo(() => {
    return calendar?.days.find(d => d.date === todayStr) ?? null;
  }, [calendar, todayStr]);

  // The round put as three goals, drawn as concentric rings. Ordered outside
  // in by the span of time each one covers: the whole round on the outer ring,
  // the current run inside it, today in the middle. A reader can read the
  // picture without the labels — the further out, the longer the horizon.
  const activityRings = useMemo<ActivityRing[]>(() => [
    {
      key: 'days',
      label: t('rings.days'),
      value: calendar?.total_score ?? 0,
      // Before the first day of the window there is nothing to be behind on,
      // and a zero target would divide the ring by nothing.
      target: Math.max(roundDaysElapsed, 1),
      unit: t('rings.unitDays'),
      color: 'var(--color-success)',
    },
    {
      key: 'streak',
      label: t('rings.streak'),
      value: personalStreak,
      // Closing this one takes the whole round without a miss.
      target: Math.max(roundWindow.total, 1),
      unit: t('rings.unitDays'),
      color: 'var(--color-warning)',
    },
    {
      key: 'today',
      // The last day is for corrections: what is read on it is kept but not scored.
      label: isLastDay ? t('rings.todayOff') : t('rings.today'),
      value: todayData?.minutes ?? 0,
      target: DAILY_GOAL_MINUTES,
      unit: t('rings.unitMin'),
      color: 'var(--color-accent-primary)',
    },
  ], [t, todayData, calendar, roundDaysElapsed, personalStreak, roundWindow, isLastDay]);

  // Hours and minutes, e.g. "8 ч 20 мин". A bare minute count stops being
  // readable somewhere around the second week of a round.
  const formatDuration = useCallback((minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m} ${t('rings.minutesShort')}`;
    if (m === 0) return `${h} ${t('rings.hoursShort')}`;
    // Past a hundred hours the minutes are noise — a fiftieth of a percent of
    // the number beside them — and they are what pushes the tally out of its
    // panel. Precision drops as the figure grows.
    if (h >= 100) return `${h} ${t('rings.hoursShort')}`;
    return `${h} ${t('rings.hoursShort')} ${m} ${t('rings.minutesShort')}`;
  }, [t]);

  const ringTotals = useMemo<RingTotal[]>(() => {
    const totals: RingTotal[] = [
      {
        key: 'round',
        label: t('rings.roundTotal'),
        value: formatDuration(calendar?.total_minutes ?? 0),
      },
    ];
    if (allTime) {
      totals.push({
        key: 'allTime',
        label: t('rings.allTimeTotal'),
        value: formatDuration(allTime.total_minutes),
      });
    }
    return totals;
  }, [t, formatDuration, calendar, allTime]);

  // The «Сегодня» form takes the server's day when what the server has changes, not on every fetch: the page fetches
  // again when a phone brings it back, and that must not throw away what the reader was typing.
  const todayFilled = useRef('');
  useEffect(() => {
    if (!todayData) return;
    const day = JSON.stringify([todayData.date, todayData.minutes, todayData.book_finished, todayData.comment, todayData.comment_private]);
    if (day === todayFilled.current) return;
    todayFilled.current = day;
    setTodayMinutes(todayData.minutes > 0 ? String(todayData.minutes) : '');
    setTodayBookFinished(todayData.book_finished);
    setTodayComment(todayData.comment ?? '');
    setTodayCommentPrivate(todayData.comment_private ?? false);
  }, [todayData]);

  const booksFilled = useRef('');
  useEffect(() => {
    const books = JSON.stringify([todayData?.date, todayData?.minutes, todayData?.books, readingBooks?.current]);
    if (books === booksFilled.current) return;
    booksFilled.current = books;
    setTodayBooks(startBooks(todayData));
    // startBooks reads only todayData and readingBooks.
  }, [todayData, readingBooks]);

  const handleSaveToday = async () => {
    if (!roundStatus?.round) return;
    const multi = todayBooks.length > 1;
    const minutes = multi ? sumMinutes(todayBooks) : parseInt(todayMinutes, 10) || 0;
    const finished = multi ? todayBooks.some((b) => b.finished) : todayBookFinished;
    const before = todayData?.minutes ?? 0;
    setIsSavingToday(true);
    const { data } = await apiPost(
      `/rounds/${roundStatus.round.id}/reading_logs`,
      {
        date: todayStr, minutes, book_finished: finished,
        comment: todayComment || null, comment_private: todayCommentPrivate,
        books: booksPayload(todayBooks, minutes, todayBookFinished),
      },
      { requireAuth: true }
    );
    if (data) {
      track('minutes_logged', { minutes, where: 'today', book_finished: finished, books: todayBooks.length });
      // The moment a runner posts the run: the day has just reached its 30 minutes.
      if (before < DAILY_GOAL_MINUTES && minutes >= DAILY_GOAL_MINUTES) setGoalJustMet(true);
      await fetchCalendar(roundStatus.round.id);
      await fetchLeaderboard(roundStatus.round.id);
      await fetchRoster(roundStatus.round.id);
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
  // Lit only while today really has its 30: a page left open overnight starts the new day plain.
  const goalLit = goalJustMet && (todayData?.minutes ?? 0) >= DAILY_GOAL_MINUTES;
  // A day before today with minutes: something to share even on a day not read yet.
  const readBefore = !!calendar?.days.some(d => d.date < todayStr && d.minutes > 0);
  const selectedDay = selectedDate ? calendar?.days.find(d => d.date === selectedDate) : undefined;

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
              {joinedCount}
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
              {/* The link to this page goes around tonight: say what signing up means, and where the round that just ended stands. */}
              {!roundStatus?.next_round_participation?.is_participant && (
                <div className={styles.takeoverRules}>
                  <RoundRules compact />
                </div>
              )}
              {roundStatus?.round && (
                <Link className={styles.takeoverResults} to="/results">
                  {t('dashboard.seeResults', { month: t(`month.${roundStatus.round.month}`) })}
                </Link>
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
                  <div className={styles.roundHeaderActions}>
                    {roundStatus.round.status === 'registration_open' && !isParticipant ? (
                      <button
                        type="button"
                        className={styles.statusJoinBtn}
                        onClick={handleJoin}
                        disabled={isJoining}
                      >
                        {statusLabel}
                      </button>
                    ) : (
                      <div className={styles.statusMenuWrap} ref={statusMenuRef}>
                        <button
                          type="button"
                          className={styles.statusTrigger}
                          onClick={() => setStatusMenuOpen((open) => !open)}
                          aria-haspopup="menu"
                          aria-expanded={statusMenuOpen}
                        >
                          <Badge variant={getStatusVariant(displayStatus!)}>
                            {statusLabel}
                          </Badge>
                          <span
                            className={`${styles.statusCaret} ${statusMenuOpen ? styles.statusCaretOpen : ''}`}
                            aria-hidden="true"
                          >
                            &#9662;
                          </span>
                        </button>

                        {statusMenuOpen && (
                          <div className={styles.statusMenu} role="menu">
                            <div className={styles.statusMenuRow}>
                              <span>{t('dashboard.statDaysLeft')}</span>
                              <b>{roundDaysLeft}</b>
                            </div>
                            <div className={styles.statusMenuRow}>
                              <span>{t('dashboard.statParticipants')}</span>
                              <b>{leaderboard.length}</b>
                            </div>
                            {canLeave && (
                              <>
                                <div className={styles.statusMenuSep} />
                                <button
                                  type="button"
                                  role="menuitem"
                                  className={styles.statusMenuLeave}
                                  onClick={() => { setStatusMenuOpen(false); openLeaveModal(); }}
                                  disabled={isLeaving}
                                >
                                  {isLeaving ? t('dashboard.leaving') : t('dashboard.leaveBtn')}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {canLeave && (
                      <button
                        type="button"
                        className={styles.statusLeaveBtn}
                        onClick={openLeaveModal}
                        disabled={isLeaving}
                      >
                        {isLeaving ? t('dashboard.leaving') : t('dashboard.leaveBtn')}
                      </button>
                    )}
                  </div>
                </div>
                {isBeforeDeadline && roundStatus.round.status === 'registration_open' && (
                  <div className={styles.roundMeta}>
                    {/* Both deadlines fall on the same day; a participant is
                        told the one that is still theirs to act on. */}
                    <span>
                      {canLeave
                        ? t('dashboard.leaveDeadline', { day: roundStatus.round.registration_open_until_day })
                        : t('dashboard.registrationUntil', { day: roundStatus.round.registration_open_until_day })}
                    </span>
                  </div>
                )}
              </div>

              {/* Say it outright. Without this a non-participant just finds
                  a page with no calendar on it and no reason given. */}
              {!isParticipant && (
                <div className={styles.notInRound}>
                  {/* The month is already the heading directly above, and
                      Russian has no genitive month form here to borrow. */}
                  <div className={styles.notInRoundTitle}>
                    {t('dashboard.notInRoundTitle')}
                  </div>
                  <p className={styles.notInRoundText}>
                    {canJoin
                      ? t('dashboard.notInRoundCanJoin', {
                          day: roundStatus.round.registration_open_until_day,
                        })
                      : t('dashboard.notInRoundClosed')}
                  </p>
                  {(canJoin ||
                    (roundStatus.next_round?.status === 'registration_open' &&
                      !roundStatus.next_round_participation?.is_participant)) && <RoundRules compact />}
                  {joinedCount}
                  {canJoin ? (
                    <Button onClick={handleJoin} disabled={isJoining}>
                      {isJoining ? t('dashboard.joining') : t('dashboard.joinBtn')}
                    </Button>
                  ) : roundStatus.next_round?.status === 'registration_open' &&
                    !roundStatus.next_round_participation?.is_participant ? (
                    <Button onClick={handleJoinNextRound} disabled={isJoiningNextRound}>
                      {isJoiningNextRound
                        ? t('dashboard.registeringNextRound')
                        : t('dashboard.registerNextRound')}
                    </Button>
                  ) : roundStatus.next_round_participation?.is_participant ? (
                    <p className={styles.notInRoundOk}>{t('dashboard.registeredNextRound')}</p>
                  ) : null}
                </div>
              )}

              {isParticipant && user && <ArchiveNews userId={user.id} />}

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

              {!isParticipant && (
                /* The three steps are one sentence, not three things to
                   compare — so they read as a line, not as a card. */
                <p className={styles.stepsLine}>
                  <span>{t('dashboard.step1')}</span>
                  <span className={styles.stepSep}>&nbsp;&rarr;&nbsp;</span>
                  <span>{t('dashboard.step2')}</span>
                  <span className={styles.stepSep}>&nbsp;&rarr;&nbsp;</span>
                  <span>{t('dashboard.step3')}</span>
                </p>
              )}

              <div ref={sectionsRef} className={styles.sections}>
                {/* Today panel — first, so logging today's reading is the primary action */}
                {isParticipant && !inRegistrationWindow && (
                  <div className={`${styles.section} ${revealClass} ${anim.scrollRevealDelay1}`}>
                    <div className={styles.sectionTitle}>{t('dashboard.today')}</div>
                    <div className={styles.todayPanel}>
                      <BarysCard
                        todayMinutes={todayData?.minutes ?? 0}
                        streak={personalStreak}
                        totalMinutes={allTime?.total_minutes ?? null}
                        brokeYesterday={brokeYesterday}
                      />
                      <div className={styles.todayDate}>{todayStr}</div>

                      {/* Correction countdown. Loud on purpose: this is the last
                          chance to fix the month, and it expires tonight. */}
                      {correctionsOpen && countdownMs !== null && (
                        <div
                          className={`${styles.correctionNotice} ${countdownMs < 3600_000 ? styles.correctionUrgent : ''}`}
                          role="timer"
                          aria-live="off"
                        >
                          <div className={styles.correctionHead}>
                            <Icon name="flame" size="em" className={styles.correctionFlame} aria-hidden="true" />
                            <span className={styles.correctionLabel}>{t('dashboard.correctionPeriod')}</span>
                          </div>
                          <div className={styles.correctionClock}>
                            {countdownParts(countdownMs).map(({ value, unit }) => (
                              <span key={unit} className={styles.clockPart}>
                                <span className={styles.clockValue}>{value}</span>
                                <span className={styles.clockUnit}>{t(`countdown.${unit}`)}</span>
                              </span>
                            ))}
                            <span className={styles.clockLeft}>{t('countdown.left')}</span>
                          </div>
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
                          value={todayBooks.length > 1 ? String(sumMinutes(todayBooks)) : todayMinutes}
                          readOnly={todayBooks.length > 1}
                          onChange={e => setTodayMinutes(e.target.value)}
                          placeholder="30"
                        />
                      </div>

                      <ReadingBooks
                        books={todayBooks}
                        onChange={setTodayBooks}
                        totalMinutes={parseInt(todayMinutes, 10) || 0}
                        onTotalChange={(m) => setTodayMinutes(m ? String(m) : '')}
                        suggestions={bookSuggestions}
                      />

                      {todayBooks.length <= 1 && (
                        <label className={styles.todayCheckbox}>
                          <input
                            type="checkbox"
                            checked={todayBookFinished}
                            onChange={e => setTodayBookFinished(e.target.checked)}
                          />
                          {t('dashboard.bookFinished')}
                        </label>
                      )}

                      <div className={styles.todayField}>
                        <label className={styles.todayLabel}>{t('dashboard.addComment')}</label>
                        <textarea
                          className={styles.todayTextarea}
                          value={todayComment}
                          onChange={e => setTodayComment(e.target.value)}
                          placeholder={t('dashboard.commentPlaceholder')}
                        />
                      </div>

                      <label className={styles.todayCheckbox}>
                        <input
                          type="checkbox"
                          checked={todayCommentPrivate}
                          onChange={e => setTodayCommentPrivate(e.target.checked)}
                        />
                        {t('dashboard.hideComment')}
                      </label>

                      <Button onClick={handleSaveToday} disabled={isSavingToday}>
                        {isSavingToday ? t('dashboard.saving') : t('dashboard.save')}
                      </Button>

                      {/* Once a day has minutes saved, it can go out: Strava's post-a-run, for reading.
                          Today first; with nothing yet today, the sheet opens on the latest day read. */}
                      {((todayData?.minutes ?? 0) > 0 || readBefore) && (
                        <div className={`${styles.shareDay} ${goalLit ? styles.shareDayLit : ''}`}>
                          {goalLit && <p className={styles.shareDayNote}>{t('shareDay.goalMet')}</p>}
                          <button type="button" className={styles.shareDayBtn} onClick={() => setSharing(todayStr)}>
                            <Icon name="share" size="sm" aria-hidden="true" />
                            {t('shareDay.button')}
                          </button>
                        </div>
                      )}
                      {sharing && (
                        <ShareDay day={sharing} roundId={roundStatus?.round?.id} onClose={() => setSharing(null)} />
                      )}
                    </div>
                  </div>
                )}
                <div className={`${styles.section} ${styles.orderLeaderboard} ${revealClass} ${anim.scrollRevealDelay2}`}>
                  <div className={styles.sectionTitle}>{t('dashboard.leaderboard')}</div>
                  {canJoin && (
                    <div className={styles.joinInline}>
                      <span className={styles.joinInlineText}>{t('dashboard.joinSubtitle')}</span>
                      <Button size="sm" onClick={handleJoin} disabled={isJoining}>
                        {isJoining ? t('dashboard.joining') : t('dashboard.joinBtn')}
                      </Button>
                    </div>
                  )}
                  {canLeave && (
                    <div className={`${styles.joinInline} ${styles.leaveInline}`}>
                      <span className={styles.joinInlineText}>{t('dashboard.youAreIn')}</span>
                    </div>
                  )}
                  {leaderboard.length === 0 ? (
                    <div className={styles.emptyState}>{t('dashboard.noParticipants')}</div>
                  ) : (
                    <>
                      {/* Pinned: current user's row */}
                      {(() => {
                        const myIdx = leaderboard.findIndex(e => e.user_id === user?.id);
                        if (myIdx === -1) return null;
                        // Pinning your row only helps when it would otherwise be
                        // scrolled out of sight. Near the top it just shows the
                        // same row twice, which reads like a duplicate entry.
                        if (myIdx < 5) return null;
                        const entry = leaderboard[myIdx];
                        return (
                          <div
                            className={`${styles.leaderboardItem} ${styles.clickable} ${styles.isMe}`}
                            onClick={() => selectUser(entry.user_id, entry.display_name)}
                          >
                            <div className={styles.rank}>{leaderboardRanks[myIdx]}</div>
                            <div className={styles.participantName}>
                              {entry.telegram_id ? (
                                <>
                                  <a href={`https://t.me/${entry.telegram_id}`} target="_blank" rel="noopener noreferrer" className={styles.telegramLink} onClick={e => e.stopPropagation()}>@{entry.telegram_id}</a>
                                  <Link to={`/readers/${entry.user_id}`} className={styles.profileLink} onClick={e => e.stopPropagation()}>›</Link>
                                </>
                              ) : (
                                <Link to={`/readers/${entry.user_id}`} className={styles.profileLinkName} onClick={e => e.stopPropagation()}>{entry.display_name}</Link>
                              )}
                            </div>
                            <div className={styles.participantScore}>{entry.total_score} {t('dashboard.daysShort')}</div>
                          </div>
                        );
                      })()}
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
                              <div className={styles.rank}>{leaderboardRanks[idx]}</div>
                              <div className={styles.participantName}>
                                {entry.telegram_id ? (
                                  <>
                                    <a
                                      href={`https://t.me/${entry.telegram_id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={styles.telegramLink}
                                      onClick={e => e.stopPropagation()}
                                    >
                                      @{entry.telegram_id}
                                    </a>
                                    <Link to={`/readers/${entry.user_id}`} className={styles.profileLink} onClick={e => e.stopPropagation()}>›</Link>
                                  </>
                                ) : (
                                  <Link to={`/readers/${entry.user_id}`} className={styles.profileLinkName} onClick={e => e.stopPropagation()}>
                                    {entry.display_name}
                                  </Link>
                                )}
                              </div>
                              <div className={styles.participantScore}>{entry.total_score} {t('dashboard.daysShort')}</div>
                            </div>
                          );
                        })}
                      </div>
                    </>
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
                      <button className={styles.closeBtn} onClick={clearViewUser} aria-label="Close">&times;</button>
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
                          const colorClass = getDayColorClass(cell.minutes, cell.date, cellIsLastDay, styles)
                          + (cell.in_round ? '' : ` ${styles.outOfRound}`);
                          return (
                            <div
                              key={cell.date}
                              className={`${styles.calendarDay} ${colorClass}`}
                              style={{ cursor: 'default' }}
                            >
                              {cellIsLastDay ? (
                                <svg className={styles.dayFinishIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{finishFlagIcon()}</svg>
                              ) : (
                                <span className={styles.dayNumber}>{cell.day}</span>
                              )}
                              {cell.minutes > 0 && !cellIsLastDay && (
                                <span className={styles.dayMinutes}>{cell.minutes}{cell.minutes < 1000 && <span className={styles.dayMinutesUnit}> {t('rings.minutesShort')}</span>}</span>
                              )}
                              {cell.book_finished && <span className={styles.dayStar}>&#9733;</span>}
                              {cell.comment && <span className={styles.dayCommentDot} />}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : !isParticipant ? (
                  <>
                    {/* Outside this circle once sign-up has closed: the next one and its waiting list. */}
                    <WaitlistCard />
                    {/* Round stats — for non-participants */}
                    <div className={`${styles.section} ${styles.orderStats} ${revealClass} ${anim.scrollRevealDelay3}`}>
                      <div className={styles.sectionTitle}>{t('dashboard.roundStats')}</div>
                      <div className={styles.roundOverview}>
                        <div className={styles.roundOverviewRing}>
                          <RoundProgressRing daysLeft={roundDaysLeft} daysTotal={roundWindow.total} />
                          <span className={styles.roundOverviewRingLabel}>{t('dashboard.statDaysLeft')}</span>
                        </div>
                        <div className={styles.roundOverviewSide}>
                          <span className={styles.roundOverviewBig}>{leaderboard.length}</span>
                          <span className={styles.roundOverviewLabel}>{t('dashboard.statParticipants')}</span>
                        </div>
                      </div>
                      {canJoin && (
                        <div className={styles.roundHook}>{t(joinHookKey)}</div>
                      )}
                    </div>
                  </>
                ) : isParticipant && !inRegistrationWindow ? (
                  <div className={`${styles.section} ${revealClass} ${anim.scrollRevealDelay2}`}>
                    <div className={styles.calendarHeaderRow}>
                      <div className={styles.sectionTitle}>{t('dashboard.myRound')}</div>
                    </div>

                    {calendar && <ActivityRings rings={activityRings} totals={ringTotals} />}

                    <div className={styles.calTabs}>
                      <button
                        type="button"
                        className={`${styles.calTab} ${calendarView === 'mine' ? styles.calTabActive : ''}`}
                        onClick={() => setCalendarView('mine')}
                      >
                        {t('dashboard.myCalendar')}
                      </button>
                      <button
                        type="button"
                        className={`${styles.calTab} ${calendarView === 'circle' ? styles.calTabActive : ''}`}
                        onClick={() => setCalendarView('circle')}
                      >
                        {t('dashboard.circleCalendar')}
                      </button>
                    </div>

                    <div className={styles.calendar}>
                      {weekdays.map(day => (
                        <div key={day} className={styles.calendarHeader}>{day}</div>
                      ))}
                      {calendarView === 'circle' ? circleCalendarGrid.map((cell, idx) => {
                        if (cell === null) {
                          return <div key={`c-empty-${idx}`} className={`${styles.calendarDay} ${styles.empty}`} />;
                        }
                        const count = roster?.days[cell.date]?.length ?? 0;
                        const outsideWindow =
                          cell.day < roundWindow.start || cell.day > roundWindow.end;
                        if (outsideWindow && count === 0) {
                          return (
                            <div
                              key={`c-${cell.date}`}
                              className={`${styles.calendarDay} ${styles.quietDay}`}
                              onClick={() => setQuietDay(cell.day)}
                              title={cell.date}
                            >
                              <svg className={styles.quietIcon} viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="1.6"
                                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                {cell.day === lastDayOfMonth ? finishFlagIcon() : quietDayIcon(cell.day)}
                              </svg>
                            </div>
                          );
                        }
                        const clickable = count > 0;
                        const intensity = count > 0 ? 0.35 + 0.65 * Math.min(count / 15, 1) : 0;
                        return (
                          <div
                            key={`c-${cell.date}`}
                            className={`${styles.calendarDay} ${styles.circleDay} ${count > 0 ? styles.circleDayActive : ''} ${outsideWindow ? styles.outOfRound : ''}`}
                            style={clickable ? ({ cursor: 'pointer', '--intensity': intensity } as CSSProperties) : undefined}
                            title={`${cell.date}: ${count}`}
                            onClick={clickable ? () => openRosterModal(cell.date) : undefined}
                          >
                            <span className={styles.dayNumber}>{cell.day}</span>
                            {count > 0 && <span className={styles.circleDayCount}>{count}</span>}
                          </div>
                        );
                      }) : calendarGrid.map((cell, idx) => {
                        if (cell === null) {
                          return <div key={`empty-${idx}`} className={`${styles.calendarDay} ${styles.empty}`} />;
                        }
                        const cellIsLastDay = cell.day === lastDayOfMonth;
                        if (!cell.in_round && cell.minutes === 0) {
                          // Outside this round's window: not a missed day, so
                          // show a sticker rather than an empty grey square.
                          return (
                            <div
                              key={cell.date}
                              className={`${styles.calendarDay} ${styles.quietDay}`}
                              onClick={() => setQuietDay(cell.day)}
                              title={cell.date}
                            >
                              <svg className={styles.quietIcon} viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="1.6"
                                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                {cell.day === lastDayOfMonth ? finishFlagIcon() : quietDayIcon(cell.day)}
                              </svg>
                            </div>
                          );
                        }
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
                              <svg className={styles.dayFinishIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{finishFlagIcon()}</svg>
                            ) : (
                              <span className={styles.dayNumber}>{cell.day}</span>
                            )}
                            {cell.minutes > 0 && !cellIsLastDay && (
                              <span className={styles.dayMinutes}>{cell.minutes}{cell.minutes < 1000 && <span className={styles.dayMinutesUnit}> {t('rings.minutesShort')}</span>}</span>
                            )}
                            {cell.book_finished && <span className={styles.dayStar}>&#9733;</span>}
                            {cell.comment && <span className={styles.dayCommentDot} />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {/* Shared circle calendar — only when the personal card (which
                    carries its own circle/mine switch) isn't on screen. */}
                {roundStatus.round && !(isParticipant && !inRegistrationWindow) && (
                  <div className={`${styles.section} ${styles.orderCalendar} ${revealClass} ${anim.scrollRevealDelay3}`}>
                    <div className={styles.calTabs}>
                      <button
                        type="button"
                        className={`${styles.calTab} ${calendarView === 'circle' ? styles.calTabActive : ''}`}
                        onClick={() => setCalendarView('circle')}
                      >
                        {t('dashboard.circleCalendar')}
                      </button>
                      {calendar && (
                        <button
                          type="button"
                          className={`${styles.calTab} ${calendarView === 'mine' ? styles.calTabActive : ''}`}
                          onClick={() => setCalendarView('mine')}
                        >
                          {t('dashboard.myCalendar')}
                        </button>
                      )}
                    </div>
                    <div className={styles.calendar}>
                      {weekdays.map(day => (
                        <div key={`circle-${day}`} className={styles.calendarHeader}>{day}</div>
                      ))}
                      {(calendarView === 'mine' && calendarGrid.length
                        ? calendarGrid
                        : circleCalendarGrid
                      ).map((cell, idx) => {
                        if (cell === null) {
                          return <div key={`circle-empty-${idx}`} className={`${styles.calendarDay} ${styles.empty}`} />;
                        }
                        const count = roster?.days[cell.date]?.length ?? 0;
                        const outsideWindow =
                          cell.day < roundWindow.start || cell.day > roundWindow.end;
                        if (outsideWindow && count === 0) {
                          // Not part of this round, and nobody read — decorate
                          // it instead of leaving a blank that reads as a miss.
                          return (
                            <div
                              key={`circle-${cell.date}`}
                              className={`${styles.calendarDay} ${styles.quietDay}`}
                              onClick={() => setQuietDay(cell.day)}
                              title={cell.date}
                            >
                              <svg className={styles.quietIcon} viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="1.6"
                                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                {cell.day === lastDayOfMonth ? finishFlagIcon() : quietDayIcon(cell.day)}
                              </svg>
                            </div>
                          );
                        }
                        const clickable = count > 0;
                        const intensity = count > 0 ? 0.35 + 0.65 * Math.min(count / 15, 1) : 0;
                        return (
                          <div
                            key={`circle-${cell.date}`}
                            className={`${styles.calendarDay} ${styles.circleDay} ${count > 0 ? styles.circleDayActive : ''} ${outsideWindow ? styles.outOfRound : ''}`}
                            style={clickable ? ({ cursor: 'pointer', '--intensity': intensity } as CSSProperties) : undefined}
                            title={`${cell.date}: ${count}`}
                            onClick={clickable ? () => openRosterModal(cell.date) : undefined}
                          >
                            <span className={styles.dayNumber}>{cell.day}</span>
                            {count > 0 && <span className={styles.circleDayCount}>{count}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              </div>
            </>
          )}
        </Container>
      </main>

      {/* The circle's reading room unfolds under the round. Minutes from its timer land in «Сегодня», so the page
          reloads its own numbers when the reader gets up. */}
      {roundStatus?.round && !inRegistrationWindow && (
        <ReadingRoom hall="round" layout="scroll" onToday={() => {
          if (!roundStatus?.round) return;
          fetchCalendar(roundStatus.round.id);
          fetchLeaderboard(roundStatus.round.id);
          fetchRoster(roundStatus.round.id);
        }} />
      )}

      <Footer />

      {/* Log minutes modal */}
      {selectedDate && createPortal(
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
                value={modalBooks.length > 1 ? String(sumMinutes(modalBooks)) : minutesInput}
                readOnly={modalBooks.length > 1}
                onChange={e => setMinutesInput(e.target.value)}
                placeholder="30"
                autoFocus
              />
            </div>
            <div className={styles.modalField}>
              <ReadingBooks
                books={modalBooks}
                onChange={setModalBooks}
                totalMinutes={parseInt(minutesInput, 10) || 0}
                onTotalChange={(m) => setMinutesInput(m ? String(m) : '')}
                suggestions={bookSuggestions}
              />
            </div>
            {modalBooks.length <= 1 && (
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
            )}
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>{t('dashboard.addComment')}</label>
              <textarea
                className={styles.todayTextarea}
                value={modalComment}
                onChange={e => setModalComment(e.target.value)}
                placeholder={t('dashboard.commentPlaceholder')}
              />
            </div>
            <div className={styles.modalField}>
              <label className={styles.todayCheckbox}>
                <input
                  type="checkbox"
                  checked={modalCommentPrivate}
                  onChange={e => setModalCommentPrivate(e.target.checked)}
                />
                {t('dashboard.hideComment')}
              </label>
            </div>
            {/* A day already logged can go out from here: yesterday's long read, the day a book was finished. */}
            {selectedDate && selectedDate <= todayStr && (selectedDay?.minutes ?? 0) > 0 && (
              <div className={styles.modalShare}>
                <button
                  type="button"
                  className={styles.shareDayBtn}
                  onClick={() => {
                    const day = selectedDate;
                    closeLogModal();
                    setSharing(day);
                  }}
                >
                  <Icon name="share" size="sm" aria-hidden="true" />
                  {t('shareDay.thisDay')}
                </button>
              </div>
            )}
            <div className={styles.modalActions}>
              <Button variant="ghost" onClick={closeLogModal}>
                {t('dashboard.cancel')}
              </Button>
              <Button onClick={handleSaveMinutes} disabled={isSaving}>
                {isSaving ? t('dashboard.saving') : t('dashboard.save')}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Leave round confirmation modal */}
      {showLeaveModal && createPortal(
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
        </div>,
        document.body
      )}

      {rosterModalDate && createPortal(
        <div className={styles.modal} onClick={closeRosterModal}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>{rosterModalDate}</div>
            <ul className={styles.rosterList}>
              {(roster?.days[rosterModalDate] ?? []).map(entry => (
                <li key={entry.user_id} className={styles.rosterRow}>
                  <div className={styles.rosterInfo}>
                    <Link to={`/readers/${entry.user_id}`} className={styles.rosterName}>
                      {entry.book_finished && '\u2605 '}
                      {entry.display_name}
                    </Link>
                    {entry.comment && <span className={styles.rosterComment}>{entry.comment}</span>}
                  </div>
                  <span className={styles.rosterMinutes}>{entry.minutes}m</span>
                </li>
              ))}
            </ul>
          </div>
        </div>,
        document.body
      )}
      </div>
      {quietDay !== null && (
        <div className={styles.quietModal} onClick={() => setQuietDay(null)}>
          <div className={styles.quietModalCard} onClick={e => e.stopPropagation()}>
            <svg className={styles.quietModalIcon} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.4"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {quietDay === lastDayOfMonth ? finishFlagIcon() : quietDayIcon(quietDay)}
            </svg>
            {quietDay === lastDayOfMonth ? (
              <>
                <div className={styles.quietModalLabel}>{t('quiet.finishLabel')}</div>
                <blockquote className={styles.quietQuote}>{t('quiet.finishText')}</blockquote>
              </>
            ) : (
              <>
                <div className={styles.quietModalLabel}>{t('quiet.modalTitle')}</div>
                <blockquote className={styles.quietQuote}>
                  {t(quietDayQuoteKeys(quietDay).text)}
                </blockquote>
                <div className={styles.quietAuthor}>
                  {t(quietDayQuoteKeys(quietDay).author)}
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </PageTransition>
  );
}

