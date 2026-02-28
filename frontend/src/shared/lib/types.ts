/**
 * Shared TypeScript types for API responses.
 * These mirror the backend Pydantic schemas.
 */

// Auth
export type TokenResponse = {
  access_token: string;
  token_type: string;
};

export type User = {
  id: string;
  email: string;
  display_name: string;
  gender: string | null;
  telegram_id: string | null;
  system_role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// Rounds
export type RoundStatus = 'draft' | 'registration_open' | 'locked' | 'closed' | 'results_published';

export type RoundInfo = {
  id: string;
  year: number;
  month: number;
  status: RoundStatus;
  registration_open_until_day: number;
  timezone: string;
};

export type ParticipationInfo = {
  is_participant: boolean;
  status: string | null;
  joined_at: string | null;
};

export type CurrentRoundStatusResponse = {
  group_id: string;
  group_name: string;
  round: RoundInfo | null;
  participation: ParticipationInfo | null;
  deadline_utc: string | null;
  correction_deadline_utc: string | null;
  next_round: RoundInfo | null;
  next_round_participation: ParticipationInfo | null;
};

// Leaderboard
export type LeaderboardEntry = {
  user_id: string;
  display_name: string;
  telegram_id: string | null;
  total_score: number;
  days_read: number;
};

// Calendar
export type CalendarDay = {
  date: string;
  minutes: number;
  score: number;
  book_finished: boolean;
  comment: string | null;
};

export type CalendarResponse = {
  round_id: string;
  total_minutes: number;
  total_score: number;
  days: CalendarDay[];
};

// Results
export type RoundResultEntry = {
  user_id: string;
  display_name: string;
  telegram_id: string | null;
  total_score: number;
  rank: number;
  group: 'winner' | 'loser';
};

export type ExchangePair = {
  giver_name: string;
  receiver_name: string;
};

export type MyResult = {
  rank: number;
  total_score: number;
  total_minutes: number;
  group: 'winner' | 'loser';
};

export type MyExchange = {
  partner_name: string;
  partner_telegram_id: string | null;
  role: 'giver' | 'receiver';
};

export type RoundResultsResponse = {
  round_id: string;
  year: number;
  month: number;
  results: RoundResultEntry[];
  pairs: ExchangePair[];
  my_result: MyResult | null;
  my_exchange: MyExchange | null;
};

export type LastCompletedRound = {
  id: string;
  year: number;
  month: number;
} | null;

// Archive
export type ArchiveDay = {
  date: string;
  minutes: number;
};

export type YearlyArchiveResponse = {
  year: number;
  months: Record<string, ArchiveDay[]>;
  participated_months: number[];
};

// Stats
export type PublicStats = {
  total_participants: number;
  total_hours_read: number;
  total_rounds: number;
  current_round_participants: number;
  days_remaining: number;
  round_progress_percent: number;
  is_round_active: boolean;
};
