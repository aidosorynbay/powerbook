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
  username: string;
  email: string | null;
  display_name: string;
  gender: string | null;
  telegram_id: string | null;
  system_role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  avatar_data: string | null;
  recommendation_text: string | null;
  reading_music_url: string | null;
  favorite_books: string[] | null;
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
  comment_private: boolean;
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
  giver_telegram_id: string | null;
  receiver_name: string;
  receiver_telegram_id: string | null;
  confirmed: boolean;
};

export type MyResult = {
  rank: number;
  total_score: number;
  total_minutes: number;
  group: 'winner' | 'loser';
};

export type MyExchange = {
  pair_id: string;
  partner_name: string;
  partner_telegram_id: string | null;
  role: 'giver' | 'receiver';
  given_confirmed: boolean;
  received_confirmed: boolean;
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
  comment: string | null;
  book_finished: boolean;
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

// Insights
export type AllTimeProfile = {
  total_minutes: number;
  total_hours: number;
  total_days_logged: number;
  current_streak_days: number;
  longest_streak_days: number;
  consistency_percent: number;
  rounds_participated: number;
  first_round_label: string | null;
  books_finished: number;
};

export type PercentileInfo = {
  round_id: string;
  round_label: string;
  your_score: number;
  percentile: number;
  rank: number;
  total_participants: number;
};

export type Archetype = {
  key: string;
  title: string;
  description: string;
  fun_fact: string | null;
};

export type BookshelfEntry = {
  title: string;
  date: string;
  round_label: string;
};

export type PopularBook = {
  title: string;
  finish_count: number;
};

export type ReadingTwin = {
  user_id: string;
  display_name: string;
  telegram_id: string | null;
  shared_books: string[];
  match_percent: number;
};

export type CelebrityMatch = {
  name: string;
  role: string;
  shared_books: string[];
  match_percent: number;
};

export type Badge = {
  key: string;
  title: string;
  description: string;
  earned: boolean;
  progress_current: number;
  progress_target: number;
};

export type LeagueMember = {
  display_name: string;
  telegram_id: string | null;
  score: number;
};

export type LeagueTier = {
  round_id: string;
  round_label: string;
  tier: string;
  tier_rank: number;
  your_score: number;
  members: LeagueMember[];
};

export type Wrapped = {
  year: number;
  total_minutes: number;
  total_hours: number;
  best_month_label: string | null;
  best_month_minutes: number;
  longest_streak_days: number;
  books_finished: number;
  percentile_best: number | null;
  archetype: Archetype;
  minutes_by_month: number[];
  rounds_participated: number;
  available_years: number[];
  days_read: number;
};

export type ReactionSummary = {
  count: number;
  reacted_by_me: boolean;
};

// Username claims (archive identity merge)
export type ClaimCandidate = {
  user_id: string;
  username: string;
  display_name: string;
  rounds: string[];
};

export type MyClaim = {
  id: string;
  ghost_user_id: string;
  ghost_username: string;
  ghost_display_name: string;
  status: string;
  note: string | null;
  created_at: string;
  rounds: string[];
};

// Hall of fame (public leaderboard)
export type HallOfFameEntry = {
  display_name: string;
  telegram_id: string | null;
  value: number;
  badge_title: string | null;
};

export type HallOfFameCategory = {
  key: string;
  title: string;
  unit: string;
  entries: HallOfFameEntry[];
};

export type HallOfFame = {
  categories: HallOfFameCategory[];
};

// Shared circle calendar (roster)
export type RosterEntry = {
  user_id: string;
  display_name: string;
  telegram_id: string | null;
  minutes: number;
  score: number;
  book_finished: boolean;
  comment: string | null;
};

export type RosterResponse = {
  round_id: string;
  days: Record<string, RosterEntry[]>;
};

export type YearlyRosterResponse = {
  year: number;
  days: Record<string, RosterEntry[]>;
};

// Social: directory, public profiles, reading buddies
export type DirectoryEntry = {
  user_id: string;
  username: string;
  display_name: string;
  telegram_id: string | null;
  avatar_data: string | null;
  archetype_title: string | null;
  recommendation_text: string | null;
  recent_books: string[];
  badges_earned: number;
};

export type PublicProfile = {
  user_id: string;
  username: string;
  display_name: string;
  telegram_id: string | null;
  avatar_data: string | null;
  recommendation_text: string | null;
  reading_music_url: string | null;
  archetype_title: string | null;
  total_hours: number;
  longest_streak_days: number;
  rounds_participated: number;
  books_finished: number;
  badges_earned: number;
  badges: Badge[];
  recent_books: string[];
  favorite_books: string[];
  is_buddy: boolean;
  is_self: boolean;
};

export type Buddy = {
  user_id: string;
  username: string;
  display_name: string;
  telegram_id: string | null;
  avatar_data: string | null;
  archetype_title: string | null;
};
