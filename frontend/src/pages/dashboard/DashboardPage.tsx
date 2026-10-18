import { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  useAuth,
  useI18n,
  circleOrdinal,
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
  type MyRoundStats,
  type RoundReview,
} from '@/shared/lib';
import { useScrollReveal } from '@/shared/hooks';
import { Button, Container, Badge, PageTransition, Icon } from '@/shared/ui';
import { Header, Footer, ActivityRings, ReadingRoom, type ActivityRing, type RingTotal, WaitlistCard, ArchiveNews, useHelpOn } from '@/widgets';
import { LeagueInBook, LeaguePromo, useLeague } from '@/widgets/League';
import { AwardsMoment, awardsOn, useAwards } from '@/widgets/Awards';
import { RoundWarSwitch, WarAnnounce, WarCard } from '@/pages/war';
import { JoinedCount, RoundRules } from '@/widgets/JoinPrompt';
import { InstallNudge } from '@/widgets/InstallNudge';
import { FeedbackPrompt, feedbackDue, feedbackDueHere, type FeedbackSource } from '@/widgets/FeedbackPrompt';
import { useMediaQuery } from '@/shared/hooks';
import { MinutesDial, MonthStats, ReminderChip, ReadersSheet, WelcomeBack, Sheet, usePulse, pulseClass, useBookCover, flyMinutes, dropToTreasury, unlockSound, ReminderOffer, reminderOfferDue, NewCircleCard, MissedYesterday, CheckinCard, CheckinAsk } from '@/widgets/RoundToday';
import rt from '@/widgets/RoundToday/RoundToday.module.css';
import { ShareDay } from '@/widgets/ShareDay';
import anim from '@/shared/styles/animations.module.css';
import { quietDayIcon, quietDayQuoteKeys, finishFlagIcon } from '@/shared/lib/quietDays';
import { ReadingBooks, booksPayload, sumMinutes } from './ReadingBooks';
import { FinishBook, finishedBook, pickTitle, savedFinish } from './FinishBook';
import styles from './DashboardPage.module.css';

function getStatusVariant(status: RoundStatus): 'success' | 'accent' | 'default' {
  if (status === 'registration_open') return 'success';
  if (status === 'locked') return 'accent';
  return 'default';
}

/** Minutes a day has to reach to score a point. */
const DAILY_GOAL_MINUTES = 30;

function getDayColorClass(
  minutes: number,
  dateStr: string,
  isLastDay: boolean,
  s: Record<string, string>,
  joinedDay?: string | null,
  todayStr?: string,
): string {
  if (isLastDay) return s.dayLastDay;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(dateStr + 'T00:00:00');

  if (day > today) return s.dayFuture;
  if (minutes >= DAILY_GOAL_MINUTES) return s.dayGreen;
  if (minutes >= 2) return s.dayYellow;
  // An empty day from before the reader joined is not a miss: it is still
  // theirs to fill in. Red there greeted every late joiner with a row of
  // failures on their very first visit.
  if (joinedDay && dateStr < joinedDay) return s.dayBeforeJoin;
  // Today is not missed yet: an open cell, its orange ring added where the calendar is drawn.
  if (todayStr && dateStr === todayStr) return s.dayOpen;
  // A missed day is a quiet neutral cell, not red: red sat 4.1 ΔE from the orange and read as a failure on the
  // screen members open every day (brand book, founder 15.10.2026).
  return s.dayMissed;
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
  const league = useLeague();
  // a new award, the moment the minutes that earned it are saved (useAwards fetches again on pb:minutes-saved)
  const { awards, reload: reloadAwards } = useAwards(awardsOn(user));
  const { t, locale } = useI18n();

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
  const [checkinShown, setCheckinShown] = useState(false);
  const [minutesInput, setMinutesInput] = useState('');
  // Day tapped on a decorative (out-of-round) cell, or null
  const [quietDay, setQuietDay] = useState<number | null>(null);
  const [calendarView, setCalendarView] = useState<'circle' | 'mine'>('mine');
  const [modalBookFinished, setModalBookFinished] = useState(false);
  const [modalComment, setModalComment] = useState('');
  const [modalCommentPrivate, setModalCommentPrivate] = useState(false);
  const [modalBooks, setModalBooks] = useState<DayBook[]>([]);
  // The day the book finished in the form was begun (FinishBook).
  const [modalStart, setModalStart] = useState<string | null>(null);
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
  const [reminderOffer, setReminderOffer] = useState(false);
  // the new «Сегодня» (2026-10-13): the card's two pages, the readers and the legend as sheets, the day's details
  const [readersOpen, setReadersOpen] = useState(false);
  // «Сохранить» turns into a ✓ that draws itself for a moment after a save
  const [justSaved, setJustSaved] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const helpOn = useHelpOn();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [topPage, setTopPage] = useState(0);
  const topPager = useRef<HTMLDivElement>(null);
  const goTop = (i: number) => {
    const el = topPager.current;
    if (!el) return;
    const next = Math.max(0, Math.min(1, i));
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
    if (next === 1) track('stats_open', {});
  };
  const [goalJustMet, setGoalJustMet] = useState(false);
  // «Как вам PowerBook?»: after an ordinary saved day at most once a month, or at once from the founder's link
  const [feedback, setFeedback] = useState<FeedbackSource | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('feedback') !== '1') return;
    q.delete('feedback');
    const rest = q.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
    setFeedback('link');
  }, []);
  const [todayBooks, setTodayBooks] = useState<DayBook[]>([]);
  const [todayStart, setTodayStart] = useState<string | null>(null);

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
      track('round_join', { via: 'circle_page' });
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
      track('round_join', { via: 'circle_page_next' });
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
        started_on: finished ? modalStart : null,
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

  // the circle's minutes per day, and its best day, for the circle calendar's shades
  const [circleMinutes, circleMinutesMax] = useMemo(() => {
    const m = new Map<string, number>();
    for (const [date, list] of Object.entries(roster?.days ?? {})) m.set(date, list.reduce((a, e) => a + e.minutes, 0));
    return [m, Math.max(1, ...m.values())] as const;
  }, [roster]);
  const calSwipe = useRef<{ x: number; y: number } | null>(null);

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

  // a computer: «Мой месяц» stands as a third block after the calendar instead of a page behind the dial
  const wide = useMediaQuery('(min-width: 1025px)');
  // the cover of the book being read, over the dial
  const bookCover = useBookCover(todayBooks[0]?.title);
  // the last circle the reader took part in, for «+N мин к прошлому кругу на 13-е» in «Мой месяц»
  const [prevDays, setPrevDays] = useState<CalendarDay[] | null>(null);
  // the round review and /my-stats feed «Мой месяц»: the comparison, the records, the sentence; refetched after a save
  const [review, setReview] = useState<RoundReview | null>(null);
  const [myStats, setMyStats] = useState<MyRoundStats | null>(null);
  const fetchMyStats = useCallback(async (roundId: string) => {
    const [a, b] = await Promise.all([
      apiGet<RoundReview>(`/reading/round-review?round_id=${roundId}`, { requireAuth: true }),
      apiGet<MyRoundStats>(`/rounds/${roundId}/my-stats`, { requireAuth: true }),
    ]);
    if (a.data) setReview(a.data);
    if (b.data) setMyStats(b.data);
  }, []);
  useEffect(() => {
    if (isParticipant && roundStatus?.round?.id) void fetchMyStats(roundStatus.round.id);
  }, [isParticipant, roundStatus?.round?.id, fetchMyStats, calendar?.total_minutes]);
  // the card is as tall as the page on show: «Мой месяц» is taller than the dial, the dial page stays short
  useLayoutEffect(() => {
    const el = topPager.current;
    if (!el) return;
    if (wide) {
      el.style.height = '';
      return;
    }
    const panes = Array.from(el.children) as HTMLElement[];
    const apply = () => {
      // «Мой месяц» is never shorter than the dial's page (the founder: the same size as the dial); with thin
      // data its blocks spread out in the same height instead of leaving the card half empty
      if (panes[1] && panes[0]) panes[1].style.minHeight = `${panes[0].offsetHeight}px`;
      const pane = panes[topPage];
      if (pane) el.style.height = `${pane.offsetHeight}px`;
    };
    apply();
    // the observer writes a pane's min-height, so it applies on the next frame, never inside its own callback
    const ro = new ResizeObserver(() => requestAnimationFrame(apply));
    panes.forEach((x) => ro.observe(x));
    return () => ro.disconnect();
  }, [topPage, wide, calendar, isParticipant]);
  useEffect(() => {
    if (!isParticipant) return;
    let alive = true;
    void (async () => {
      const { data: last } = await apiGet<{ id: string } | null>('/rounds/last-completed', { requireAuth: true });
      if (!last?.id || last.id === roundStatus?.round?.id) return;
      const { data } = await apiGet<CalendarResponse>(`/rounds/${last.id}/calendar`, { requireAuth: true });
      if (alive && data?.days?.some((d) => d.minutes > 0)) setPrevDays(data.days);
    })();
    return () => {
      alive = false;
    };
  }, [isParticipant, roundStatus?.round?.id]);

  // «Читатели ›» pulses on the first visit of a circle, after the reminder chip has had its turn (one pulse at a time)
  const readersPulse = usePulse({
    el: 'readers_arrow',
    storeKey: 'pb.pulse2.readers',
    eligible: !!isParticipant && !!roundStatus?.round,
    userId: user?.id,
    // a newcomer's first three days on the page, once a day; later it stays still
    visits: 3,
    delay: 31_000,
    fast: 4_000,
    slow: 10_000,
  });

  // The day this reader took their place, in the circle's own time zone.
  const joinedDay = useMemo(() => {
    const at = roundStatus?.participation?.joined_at;
    if (!at) return null;
    // Stored in UTC; a value without an offset (SQLite drops it) is UTC too.
    const utc = /[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : `${at}Z`;
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: roundStatus?.round?.timezone || undefined,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(utc));
    } catch {
      return at.slice(0, 10);
    }
  }, [roundStatus?.participation?.joined_at, roundStatus?.round?.timezone]);

  // Empty days of this circle that passed before the reader joined: they get
  // a word under the calendar, since a late joiner can still log them.
  const emptyBeforeJoin = useMemo(() => {
    if (!joinedDay || !isParticipant) return 0;
    return calendarGrid.filter(
      (c) => c !== null && c.in_round && c.date < joinedDay && c.minutes < 2,
    ).length;
  }, [calendarGrid, joinedDay, isParticipant]);

  // A brand-new account has just answered the archive question at sign-up;
  // the round page should not raise it again in its first two weeks.
  const isNewAccount = !!user && Date.now() - Date.parse(user.created_at) < 14 * 24 * 60 * 60 * 1000;

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
  // yesterday, for «Мой месяц»: the circle's last full day when the morning is still empty
  const yesterdayStr = useMemo(() => {
    const d = new Date(dayNow);
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    // sound may only start inside the tap: open it now for the flight after the save
    unlockSound();
    const dialRect = document.querySelector('[role=slider]')?.getBoundingClientRect() ?? null;
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
        started_on: finished ? todayStart : null,
      },
      { requireAuth: true }
    );
    if (data) {
      track('minutes_logged', { minutes, where: 'today', book_finished: finished, books: todayBooks.length });
      window.dispatchEvent(new Event('pb:minutes-saved'));
      // the minutes fly into today's cell of the calendar (the founder's idea, 2026-10-13)
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1500);
      let dropDone: Promise<unknown> = Promise.resolve();
      if (dialRect && minutes > 0) {
        setViewUser(null);
        setCalendarView('mine');
        // …and then on into the circle's treasury: a drop falls from today's cell into the pool under the calendar,
        // today's circle total counting up (2026-10-15). Only once the circle's day is known: never «казна: 45 мин».
        const delta = minutes - before;
        const circleBefore = roster ? circleMinutes.get(todayStr) ?? 0 : null;
        // the drop falls on every save that adds minutes, not only the day's first: 30 → 0 → 30 had the founder waiting
        // for a drop that never came (2026-10-16)
        const fly = true;
        dropDone = flyMinutes(dialRect, () => document.querySelector<HTMLElement>(`[data-day="${todayStr}"]`), minutes, minutes >= DAILY_GOAL_MINUTES).then((cell) => {
          if (!cell || delta <= 0 || circleBefore === null) return;
          const fmt = (m: number) => (m >= 60 ? (m % 60 ? t('ms.hm', { h: Math.floor(m / 60), m: m % 60 }) : t('ms.h', { h: Math.floor(m / 60) })) : t('ms.m', { m }));
          // one thing moves at a time: on the day's 30 the room's «30 минут» comes first (it starts a moment after the
          // save), the drop once it has gone — 7 s at most
          const goalDay = before < DAILY_GOAL_MINUTES && minutes >= DAILY_GOAL_MINUTES;
          const quiet = new Promise<void>((r) => {
            if (!goalDay) { window.setTimeout(r, 250); return; }
            const t0 = performance.now();
            let seenAt = 0;
            const check = () => {
              const busy = !!document.querySelector('[data-room-goal]');
              const now = performance.now();
              if (busy && !seenAt) seenAt = now;
              const elapsed = now - t0;
              // the room's card is gone from sight ~2.3 s after it shows (its node stays until 3.6 s)
              if ((seenAt && (!busy || now - seenAt > 2300)) || (!seenAt && elapsed > 4500) || elapsed > 9000) window.setTimeout(r, seenAt ? 150 : 0);
              else window.setTimeout(check, 100);
            };
            check();
          });
          return quiet.then(() => dropToTreasury({
            today: todayStr, grid: () => document.querySelector<HTMLElement>('[data-cal-grid]'),
            counted: minutes >= DAILY_GOAL_MINUTES,
            delta, before: circleBefore, after: circleBefore + delta,
            plus: `+${fmt(delta)}`, label: t('cal.treasuryToday'), total: fmt, fly,
            onSeen: () => track('treasury_drop_seen', { minutes: delta }),
            onTap: () => { setCalendarView('circle'); track('circle_calendar_open', { source: 'treasury_drop' }); },
          }));
        });
      }
      // The moment a runner posts the run: the day has just reached its 30 minutes.
      if (before < DAILY_GOAL_MINUTES && minutes >= DAILY_GOAL_MINUTES) setGoalJustMet(true);
      // The story sheet comes up by itself the way Strava's does after a run: on the save that brings the day to its 30
      // minutes (and on a book finished, or the circle's last day), once a day. Only 3 of 110 readers found it by its
      // icon, 17 when it came to them (GA4, 5–15 Oct; the founder and the council, 2026-10-15).
      const prev = (calendar?.days ?? []).filter((d) => d.date < todayStr && d.in_round !== false).sort((a, b) => a.date.localeCompare(b.date));
      let streak = minutes >= DAILY_GOAL_MINUTES ? 1 : 0;
      if (streak) for (let i = prev.length - 1; i >= 0 && prev[i].minutes >= DAILY_GOAL_MINUTES; i--) streak++;
      const goalNow = before < DAILY_GOAL_MINUTES && minutes >= DAILY_GOAL_MINUTES;
      let shownToday = false;
      try { shownToday = localStorage.getItem('pb.share.auto') === todayStr; } catch { /* private mode */ }
      const reason = shownToday ? null
        : goalNow && !prev.some((d) => d.minutes >= DAILY_GOAL_MINUTES) ? 'first_day'
        : goalNow && [3, 7, 14, 21].includes(streak) ? `streak_${streak}`
        : goalNow ? 'goal'
        : finished && !todayData?.book_finished ? 'book_finished'
        : isLastDay && minutes > 0 && before === 0 ? 'last_day'
        : null;
      if (reason) {
        track('share_prompt_shown', { reason });
        try { localStorage.setItem('pb.share.auto', todayStr); } catch { /* private mode */ }
        // after the drop has joined the pool and the total has counted up, so the sheet never covers it. On the day's
        // 30 the room's «30 минут» comes first and the drop only after it: 8 s was too short a guard, the sheet came up
        // over the falling drop (the founder's phone, 2026-10-16); 16 s is only for a drop that never ends
        void Promise.race([dropDone.catch(() => {}), new Promise((r) => window.setTimeout(r, 16000))]).then(() =>
          window.setTimeout(() => setSharing(todayStr), 900),
        );
      } else if (minutes > 0) {
        // no milestone today: offer the reminder for this same time tomorrow, once the drop has settled — and only
        // while the page is still in front of the reader: on an iPhone a timer of a locked phone fires the next time
        // the app opens, maybe the next morning, which is the wrong moment for «напомнить в это же время»
        const savedAt = Date.now();
        void reminderOfferDue().then((due) => {
          if (!due) {
            // One prompt per save: with no reminder to offer, now and then «Как вам PowerBook?» (a few days read, once
            // a month on any device), once the drop is in the pool, never over another sheet, with the same guard.
            const daysRead = prev.filter((d) => d.minutes > 0).length + 1;
            const settled = Promise.race([dropDone.catch(() => {}), new Promise((r) => window.setTimeout(r, 16000))]);
            void Promise.all([feedbackDue(daysRead), settled]).then(([ask]) => {
              if (!ask) return;
              window.setTimeout(() => {
                if (document.visibilityState !== 'visible' || Date.now() - savedAt > 30_000) return;
                if (!feedbackDueHere(daysRead) || document.querySelector('[role="dialog"]')) return;
                setFeedback((f) => f ?? 'after_save');
              }, 1200);
            });
            return;
          }
          void Promise.race([dropDone.catch(() => {}), new Promise((r) => window.setTimeout(r, 16000))]).then(() =>
            window.setTimeout(() => {
              if (document.visibilityState !== 'visible' || Date.now() - savedAt > 30_000) return;
              track('reminder_offer', { action: 'shown' });
              setReminderOffer(true);
            }, 700),
          );
        });
      }
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
  // The book each form marks finished, if any: FinishBook finds it on the shelf and counts its time.
  const todayFinish = finishedBook(todayBooks, todayBookFinished, todayComment, parseInt(todayMinutes, 10) || 0);
  const modalFinish = finishedBook(modalBooks, modalBookFinished, modalComment, parseInt(minutesInput, 10) || 0);

  // «Мой месяц»: a page behind the dial on phones, a block of its own on a computer
  const monthStats = calendar && roundStatus?.round ? (
    <MonthStats
      days={calendar.days}
      todayStr={todayStr}
      scoringEnd={roundWindow.scoringEnd}
      active={wide || topPage === 1}
      monthLabel={t(`month.my.${roundStatus.round.month}`)}
      monthNum={roundStatus.round.month}
      dayOfRound={Math.max(1, roundDaysElapsed)}
      roundDays={roundWindow.total}
      joinedDay={joinedDay}
      prevDays={prevDays}
      prevMonthNum={prevDays?.[0] ? Number(prevDays[0].date.slice(5, 7)) : (review?.previous?.month ?? null)}
      onPlace={() => { setReadersOpen(true); track('readers_sheet_open', { from: 'stats' }); }}
      onWhichBook={() => { goTop(0); setDetailsOpen(true); track('stats_which_book', {}); }}
      circleToday={roster?.days[todayStr] ?? []}
      circleYesterday={roster?.days[yesterdayStr] ?? []}
      circleMinutes={[...circleMinutes.values()].reduce((a, b) => a + b, 0)}
      circleSize={leaderboard.length}
      userId={user?.id}
      allTime={allTime}
      review={review}
      extra={myStats}
      bookTotals={readingBooks?.minutes ?? {}}
      roundId={roundStatus.round.id}
      wide={wide}
    />
  ) : null;

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
          <RoundWarSwitch />
          <WarAnnounce />
          {!(isParticipant && !inRegistrationWindow) && (
            <div className={styles.header}>
              <div className={styles.greeting}>
                {t('dashboard.greeting', { name: user?.display_name ?? 'User' })}
              </div>
            </div>
          )}

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
              <div className={`${styles.roundInfo} ${isParticipant && !inRegistrationWindow ? styles.roundInfoTight : ''}`}>
                <div className={`${styles.roundHeader} ${isParticipant && !inRegistrationWindow ? styles.roundHeaderMember : ''}`}>
                  <div className={styles.roundTitle}>
                    {isParticipant && !inRegistrationWindow ? t(`roundTitle.${roundStatus.round.month}`) : `${monthName} ${roundStatus.round.year}`}
                    {roundStatus.round.number ? (
                      /* which circle this is since February 2021 (the founder, 2026-10-14) */
                      <span className={styles.roundNumber}> · {circleOrdinal(locale, roundStatus.round.number, !(isParticipant && !inRegistrationWindow))}</span>
                    ) : null}
                    {isParticipant && !inRegistrationWindow && (
                      /* one line, one tap: you are in, which day it is, how many read with you (the council, 2026-10-13) */
                      <button
                        type="button"
                        className={`${styles.memberLine} ${readersPulse.phase === 'fast' || readersPulse.phase === 'slow' ? pulseClass(readersPulse.phase) : ''}`}
                        onClick={() => {
                          readersPulse.found(false);
                          setReadersOpen(true);
                          track('readers_sheet_open', { from: 'header' });
                        }}
                      >
                        <i className={styles.memberDot} aria-hidden="true" />
                        {t('member.line', { n: Math.max(1, roundDaysElapsed), total: roundWindow.total, readers: leaderboard.length })}
                        <span className={styles.memberMore}> ›</span>
                      </button>
                    )}
                  </div>
                  <div className={`${styles.roundHeaderActions} ${isParticipant && !inRegistrationWindow ? styles.gone : ''}`}>
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
                            {isParticipant && !inRegistrationWindow ? (
                              <span className={styles.statusShort} aria-label={statusLabel}>
                                <i className={styles.statusDot} aria-hidden="true" />
                                <span className={styles.statusShortText}>{statusLabel.replace(/^(Раунд|Round|Круг|Circle|Айналым)\s+/i, '').replace(/^./, (c) => c.toUpperCase())}</span>
                              </span>
                            ) : (
                              statusLabel
                            )}
                          </Badge>
                          <span
                            className={`${styles.statusCaret} ${statusMenuOpen ? styles.statusCaretOpen : ''}`}
                            aria-hidden="true"
                          >
                            &#9662;
                          </span>
                        </button>

                        {statusMenuOpen && (
                          <div
                            className={styles.statusMenu}
                            role="menu"
                            ref={(el) => {
                              // kept whole on the screen whichever side of the heading the badge wrapped to (2026-10-13)
                              if (!el) return;
                              el.style.transform = '';
                              const r = el.getBoundingClientRect();
                              const dx = r.left < 12 ? 12 - r.left : r.right > window.innerWidth - 12 ? window.innerWidth - 12 - r.right : 0;
                              if (dx) el.style.transform = `translateX(${dx}px)`;
                            }}
                          >
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
                <NewCircleCard
                  enabled={canJoin}
                  month={roundStatus.round.month}
                  untilDay={roundStatus.round.registration_open_until_day}
                  joining={isJoining}
                  onJoin={handleJoin}
                >
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
                </NewCircleCard>
              )}

              {isParticipant && user && !isNewAccount && <ArchiveNews userId={user.id} />}

              {/* Color & symbol legend (members: beside their calendar, with «?») */}
              {!(isParticipant && !inRegistrationWindow) && <div className={styles.legend}>
                <span className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.legendGreen}`} />
                  {t('dashboard.legend30')}
                </span>
                <span className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.legendYellow}`} />
                  {t('dashboard.legend2')}
                </span>
                <span className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.legendMissed}`} />
                  {t('dashboard.legendMissed')}
                </span>
                {emptyBeforeJoin > 0 && (
                  <span className={styles.legendItem}>
                    <span className={`${styles.legendDot} ${styles.legendBeforeJoin}`} />
                    {t('dashboard.legendBeforeJoin')}
                  </span>
                )}
                <span className={styles.legendItem}>
                  <span className={styles.legendSymbol}>&#9733;</span>
                  {t('dashboard.legendStar')}
                </span>
                <span className={styles.legendItem}>
                  <span className={styles.legendCommentDot} />
                  {t('dashboard.legendComment')}
                </span>
              </div>}

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
                    <div className={styles.todayPanel}>
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

                      {/* «Хей, как вы?» from the founder after three quiet days (app/services/checkins.py); while it is
                          up, the other lines about a break stay quiet: one voice at a time */}
                      <WarCard />
                      <CheckinCard
                        onShown={setCheckinShown}
                        onForgot={() => openLogModal(yesterdayStr, calendar?.days.find((d) => d.date === yesterdayStr)?.minutes ?? 0)}
                      />
                      {calendar && !checkinShown && <WelcomeBack days={calendar.days} todayStr={todayStr} todayMinutes={todayData?.minutes ?? 0} />}
                      {calendar && !checkinShown && (
                        <MissedYesterday
                          days={calendar.days}
                          todayStr={todayStr}
                          todayMinutes={todayData?.minutes ?? 0}
                          onLogYesterday={(date) => openLogModal(date, calendar.days.find((d) => d.date === date)?.minutes ?? 0)}
                        />
                      )}
                      {!checkinShown && <CheckinAsk todayMinutes={todayData?.minutes ?? 0} />}

                      {/* «Сегодня» (2026-10-13): the book and the reminder, the dial, «Сохранить»; a swipe in the
                          dial's middle (or the dots) turns to «Мой месяц» */}
                      <div className={rt.card}>
                        <div
                          className={rt.pager}
                          ref={topPager}
                          onScroll={(e) => {
                            const el = e.currentTarget;
                            setTopPage(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
                          }}
                        >
                          <div className={rt.pane}>
                            {/* the book: its cover large, the ⇄ on it to change the book (the founder's idea, the council's sizes) */}
                            <div className={`${rt.bookRow} ${league?.live && user ? rt.withMark : ''}`}>
                              {league?.live && user && <LeagueInBook league={league} name={user.display_name || user.username} />}
                              <button type="button" className={rt.coverBtn} onClick={() => setDetailsOpen((o) => !o)} aria-expanded={detailsOpen} aria-label={t('today.changeBook')}>
                                {bookCover.cover ? (
                                  <img className={rt.coverBig} src={bookCover.cover} alt="" />
                                ) : (
                                  <span className={rt.coverEmpty}>+</span>
                                )}
                                {todayBooks[0]?.title && (
                                  <span className={rt.swapBadge} aria-hidden="true">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 21v-5h5" /><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5" /></svg>
                                  </span>
                                )}
                              </button>
                              <div className={rt.bookText}>
                                {todayBooks[0]?.title ? (
                                  <>
                                    <span className={rt.bookTitleBig}>{todayBooks.map((b, i) => (i === 0 && bookCover.title) || b.title).filter(Boolean).join(' · ')}</span>
                                    {bookCover.author && <span className={rt.bookAuthor}>{bookCover.author}</span>}
                                  </>
                                ) : (
                                  <button type="button" className={`${rt.linkBtn} ${rt.bookAsk}`} onClick={() => setDetailsOpen(true)}>
                                    {t('today.noBook')} ›
                                  </button>
                                )}
                              </div>
                              {/* the rail: the reminder, the day's comment and books, sharing the day (council 2026-10-13) */}
                              <div className={rt.rail}>
                                {roundStatus?.round && <ReminderChip roundKey={roundStatus.round.id} userId={user?.id} compact />}
                                <button
                                  type="button"
                                  className={`${rt.railBtn} ${detailsOpen ? rt.railOn : ''}`}
                                  aria-expanded={detailsOpen}
                                  aria-label={t('today.details')}
                                  title={t('today.details')}
                                  onClick={() => setDetailsOpen((o) => !o)}
                                >
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
                                  {(todayComment || todayData?.comment) && <i className={rt.railDot} />}
                                </button>
                              </div>
                            </div>
                            <MinutesDial
                              value={todayBooks.length > 1 ? sumMinutes(todayBooks) : parseInt(todayMinutes, 10) || 0}
                              onChange={(m) => setTodayMinutes(m ? String(m) : '')}
                              readOnly={todayBooks.length > 1}
                              onSwipe={wide ? undefined : (d) => goTop(topPage + d)}
                            />
                            <div className={rt.save}>
                              <Button
                                onClick={handleSaveToday}
                                disabled={isSavingToday || ((parseInt(todayMinutes, 10) || 0) === 0 && todayBooks.length <= 1 && (todayData?.minutes ?? 0) === 0 && !todayComment)}
                              >
                                {justSaved ? (
                                  <svg className={rt.savedCheck} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-label={t('dashboard.saving')}>
                                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                                  </svg>
                                ) : isSavingToday ? t('dashboard.saving') : t('dashboard.save')}
                              </Button>
                              {roundDaysLeft > 0 && roundDaysLeft <= 5 && <p className={rt.daysLeft}>{t('member.daysLeft', { n: roundDaysLeft })}</p>}
                              <div className={styles.underSave}>
                                {/* a word under «Сохранить», not an icon in the rail: the icon was found by 3 of 110 (GA4, 5–15 Oct) */}
                                {((todayData?.minutes ?? 0) > 0 || readBefore) && (
                                  <button
                                    type="button"
                                    className={`${styles.toRoom} ${goalLit ? styles.toShareLit : ''}`}
                                    onClick={() => { setSharing(todayStr); track('share_open', { from: 'under_save' }); }}
                                  >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 8 5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>
                                    {t('today.share')}
                                  </button>
                                )}
                                {/* 31 of 69 members read in the room (GA4, 1–14 Oct), and it sat two screens below: one tap down to its door */}
                                <button
                                  type="button"
                                  className={styles.toRoom}
                                  onClick={() => {
                                    track('room_door_tap', { from: 'dial' });
                                    document.querySelector('[data-room-door]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                  }}
                                >
                                  {t('nav2.toRoom')} <span aria-hidden="true">↓</span>
                                </button>
                              </div>
                            </div>
                          </div>
                          {!wide && monthStats}
                        </div>
                        {!wide && <div className={rt.dots}>
                          {[0, 1].map((i) => (
                            <button key={i} type="button" aria-current={topPage === i} aria-label={i ? t('stats.myMonth', { month: monthName }) : t('dial.label')} onClick={() => goTop(i)} />
                          ))}
                        </div>}
                      </div>

                      {detailsOpen && (
                        <div className={styles.todayDetails}>
                      <ReadingBooks
                        books={todayBooks}
                        onChange={setTodayBooks}
                        totalMinutes={parseInt(todayMinutes, 10) || 0}
                        onTotalChange={(m) => setTodayMinutes(m ? String(m) : '')}
                        suggestions={bookSuggestions}
                        spent={readingBooks?.minutes}
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

                      {todayFinish && roundStatus?.round && (
                        <FinishBook
                          roundId={roundStatus.round.id}
                          day={todayStr}
                          book={todayFinish}
                          savedTitle={savedFinish(todayData)}
                          onStart={setTodayStart}
                          onPick={(title) => {
                            const next = pickTitle(todayBooks, todayComment, todayFinish, title);
                            setTodayBooks(next.books);
                            setTodayComment(next.comment);
                          }}
                        />
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

                        </div>
                      )}

                      {sharing && (
                        <ShareDay day={sharing} roundId={roundStatus?.round?.id} onClose={() => setSharing(null)} />
                      )}
                    </div>
                  </div>
                )}
                {/* The app on the home screen: offered once the daily habit has a
                    page to live on, and only to members on a phone. */}
                {isParticipant && <InstallNudge />}
                {!isParticipant && (
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
                )}

                {/* Right panel: viewed user's calendar OR own calendar */}
                {viewUser ? (
                  <div data-cal className={`${styles.section} ${revealClass} ${anim.scrollRevealDelay2}`}>
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
                          // their days before they joined are not misses here either
                          const dayClass = getDayColorClass(cell.minutes, cell.date, cellIsLastDay, styles, viewUserCalendar.joined_day, todayStr);
                          const colorClass = dayClass
                          + (cell.in_round ? '' : ` ${styles.outOfRound}`)
                          + (cell.date === todayStr ? ` ${styles.dayToday}` : '');
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
                              {/* someone else's empty day: «nothing logged», never a «+» — the day is theirs to fill */}
                              {dayClass === styles.dayMissed && cell.minutes === 0 && cell.in_round && (
                                <span className={`${styles.dayMinutes} ${styles.dayDash}`} aria-hidden="true">–</span>
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
                  <div data-cal className={`${styles.section} ${revealClass} ${anim.scrollRevealDelay2}`}>
                    {/* «Мой | Круг», the legend beside it and «?» for the whole of it (2026-10-13) */}
                    <div className={styles.calTop}>
                      <div className={styles.calSeg}>
                        <button type="button" aria-pressed={calendarView === 'mine'} onClick={() => setCalendarView('mine')}>
                          {t('cal.mine')}
                        </button>
                        <button type="button" aria-pressed={calendarView === 'circle'} onClick={() => { setCalendarView('circle'); track('circle_calendar_open', {}); }}>
                          {t('cal.circle')}
                        </button>
                      </div>
                      <button type="button" className={styles.calLegend} onClick={() => setLegendOpen(true)} aria-label={t('cal.legendAsk')}>
                        {calendarView === 'mine' ? (
                          <span className={styles.calLegendRow}>
                            <i className={styles.lgG} />30+<i className={styles.lgY} />2–29<i className={styles.lgM} />&lt;2<em>&#9733;</em><u />
                          </span>
                        ) : (
                          <span className={styles.calLegendRow}>
                            {t('cal.few')}
                            {[1, 2, 3, 4, 5].map((k) => <i key={k} className={styles.lgC} style={{ '--k': k / 5 } as CSSProperties} />)}
                            {t('cal.many')}
                          </span>
                        )}
                        {/* «i»: the colours explained; «?» in the header is for the rules (the council, 2026-10-15) */}
                        <span className={styles.calQ}>{helpOn ? 'i' : '?'}</span>
                      </button>
                    </div>

                    <div
                      className={styles.calendar}
                      data-cal-grid
                      onTouchStart={(e) => { calSwipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
                      onTouchEnd={(e) => {
                        const st = calSwipe.current;
                        calSwipe.current = null;
                        if (!st) return;
                        const dx = e.changedTouches[0].clientX - st.x;
                        const dy = e.changedTouches[0].clientY - st.y;
                        if (Math.abs(dx) > 50 && Math.abs(dx) > 1.6 * Math.abs(dy)) setCalendarView(dx < 0 ? 'circle' : 'mine');
                      }}
                    >
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
                        const sum = circleMinutes.get(cell.date) ?? 0;
                        const level = sum > 0 ? Math.min(5, Math.max(1, Math.ceil((sum / circleMinutesMax) * 5))) : 0;
                        return (
                          <div
                            key={`c-${cell.date}`}
                            className={`${styles.calendarDay} ${styles.circleDay} ${level ? styles.circleSum : ''} ${level >= 4 ? styles.circleHi : ''} ${outsideWindow ? styles.outOfRound : ''} ${cell.date === todayStr ? styles.circleToday : ''}`}
                            style={clickable ? ({ cursor: 'pointer', '--k': level / 5 } as CSSProperties) : undefined}
                            title={`${cell.date}: ${sum} · ${count}`}
                            onClick={clickable ? () => openRosterModal(cell.date) : undefined}
                          >
                            <span className={styles.dayNumber}>{cell.day}</span>
                            {sum > 0 && <span className={styles.dayMinutes}>{sum >= 10000 ? `${Math.round(sum / 1000)}k` : sum}</span>}
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
                        const dayClass = getDayColorClass(cell.minutes, cell.date, cellIsLastDay, styles, joinedDay, todayStr);
                        const colorClass = dayClass + (cell.date === todayStr ? ` ${styles.dayToday}` : '');
                        const lastDayClickable = cellIsLastDay && correctionsOpen;
                        const canClick = !cellIsLastDay || lastDayClickable;
                        // An empty past day says so where its minutes would be — «–», nothing logged — not by a
                        // colour (the council, 15.10.2026). One sign only: a «+» on the freshest days needed
                        // explaining and asked nothing the morning line doesn't (the founder, the same night); any
                        // day still opens the minutes form.
                        const empty = dayClass === styles.dayMissed && cell.minutes === 0;
                        return (
                          <div
                            key={cell.date}
                            data-day={cell.date}
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
                            {empty && <span className={`${styles.dayMinutes} ${styles.dayDash}`} aria-hidden="true">–</span>}
                            {cell.book_finished && <span className={styles.dayStar}>&#9733;</span>}
                            {cell.comment && <span className={styles.dayCommentDot} />}
                          </div>
                        );
                      })}
                    </div>
                    {calendarView === 'mine' && emptyBeforeJoin > 0 && (
                      <p className={styles.beforeJoinNote}>{t('dashboard.beforeJoinNote')}</p>
                    )}
                  </div>
                ) : null}

                {wide && isParticipant && !inRegistrationWindow && monthStats && (
                  <div className={`${styles.section} ${styles.monthBlock} ${revealClass} ${anim.scrollRevealDelay3}`}>{monthStats}</div>
                )}

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
      {roundStatus?.round && !inRegistrationWindow && <div data-room-door aria-hidden="true" />}
      {roundStatus?.round && !inRegistrationWindow && (
        <ReadingRoom hall="round" layout="scroll" onToday={() => {
          if (!roundStatus?.round) return;
          fetchCalendar(roundStatus.round.id);
          fetchLeaderboard(roundStatus.round.id);
          fetchRoster(roundStatus.round.id);
        }} />
      )}

      <Footer />

      {/* «Читатели круга» and «что значат цвета», from below (members, 2026-10-13) */}
      <ReminderOffer open={reminderOffer} onClose={() => setReminderOffer(false)} />
      {league?.live && user && <LeaguePromo league={league} name={user.display_name || user.username} />}
      {awards && user && <AwardsMoment awards={awards} name={user.display_name || user.username} username={user.username} onSeen={reloadAwards} />}
      <ReadersSheet
        open={readersOpen}
        onClose={() => setReadersOpen(false)}
        leaderboard={leaderboard}
        today={roster?.days[todayStr] ?? []}
        userId={user?.id}
        dayOfRound={roundDaysElapsed}
        leave={canLeave ? { until: roundStatus?.round?.registration_open_until_day ?? null, onLeave: () => { setReadersOpen(false); openLeaveModal(); } } : undefined}
        onPick={(id, name) => {
          void selectUser(id, name);
          window.setTimeout(() => document.querySelector('[data-cal]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
        }}
      />
      <Sheet open={legendOpen} onClose={() => setLegendOpen(false)} label={t('cal.legendAsk')}>
        {calendarView === 'mine' ? (
          <>
            <h3 className={rt.sheetTitle}>{t('cal.mineTitle')}</h3>
            <ul className={styles.legendList}>
              <li><i className={styles.lgG} />{t('cal.mine30')}</li>
              <li><i className={styles.lgY} />{t('cal.mine2')}</li>
              <li><i className={styles.lgM} />{t('cal.mine0')}</li>
              <li><em>&#9733;</em>{t('cal.mineStar')}</li>
              <li><u />{t('cal.mineDot')}</li>
              <li><i className={styles.lgToday} />{t('cal.mineToday')}</li>
              <li><i className={styles.lgFlag} />{t('cal.mineFlag')}</li>
            </ul>
          </>
        ) : (
          <>
            <h3 className={rt.sheetTitle}>{t('cal.circleTitle')}</h3>
            <p className={rt.sheetLead}>{t('cal.circleText')}</p>
            <div className={styles.legendScale}>
              {t('cal.few')}
              {[1, 2, 3, 4, 5].map((k) => <i key={k} className={styles.lgC} style={{ '--k': k / 5 } as CSSProperties} />)}
              {t('cal.many')}
            </div>
            <p className={rt.sheetLead}>{t('cal.circleScale')}</p>
          </>
        )}
        {helpOn && (
          <Link to="/welcome#powerbook" className={styles.legendRules} onClick={() => track('help_link', { key: 'legend_rules' })}>
            {t('help.rulesShort')} ›
          </Link>
        )}
        <button type="button" className={`${rt.sheetClose} ${rt.closeBtn}`} onClick={() => setLegendOpen(false)}>{t('dial.coachOk')}</button>
      </Sheet>

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
                        spent={readingBooks?.minutes}
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
            {modalFinish && roundStatus?.round && selectedDate && (
              <div className={styles.modalField}>
                <FinishBook
                  roundId={roundStatus.round.id}
                  day={selectedDate}
                  book={modalFinish}
                  savedTitle={savedFinish(selectedDay)}
                  onStart={setModalStart}
                  onPick={(title) => {
                    const next = pickTitle(modalBooks, modalComment, modalFinish, title);
                    setModalBooks(next.books);
                    setModalComment(next.comment);
                  }}
                />
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
            <div className={styles.modalTitle}>
              {rosterModalDate}
            </div>
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

      {feedback && <FeedbackPrompt source={feedback} roundId={roundStatus?.round?.id} onClose={() => setFeedback(null)} />}
    </PageTransition>
  );
}

