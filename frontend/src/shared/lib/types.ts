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
};

// Leaderboard
export type LeaderboardEntry = {
  user_id: string;
  display_name: string;
  total_score: number;
  days_read: number;
};

// Calendar
export type CalendarDay = {
  date: string;
  minutes: number;
  score: number;
};

export type CalendarResponse = {
  round_id: string;
  total_minutes: number;
  total_score: number;
  days: CalendarDay[];
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
