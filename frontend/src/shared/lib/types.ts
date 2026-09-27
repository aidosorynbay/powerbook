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
  /** Day window inside the month; a mini-round is a slice of it. */
  start_day?: number;
  end_day?: number | null;
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
  /** false when the day falls outside a mini-round's window */
  in_round?: boolean;
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
  total_minutes_read: number;
  total_participations: number;
  total_rounds: number;
  current_round_participants: number;
  days_remaining: number;
  round_progress_percent: number;
  is_round_active: boolean;
  // Current round window, used by the homepage round card
  round_year?: number | null;
  round_month?: number | null;
  round_start_day?: number | null;
  round_end_day?: number | null;
  round_is_partial?: boolean;
  round_registration_open?: boolean;
  yearly?: YearlyStat[];
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
  params: Record<string, number>;
  fun_fact_weekday: number | null;
  fun_fact_minutes: number | null;
};

export type BookshelfEntry = {
  title: string;
  date: string;
  round_label: string;
  /** 'round' comes from a reading log; 'manual' the reader added themselves. */
  source: 'round' | 'manual';
  id: string | null;
  author: string | null;
};

export type ManualBook = {
  id: string;
  title: string;
  author: string | null;
  finished_on: string | null;
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
  user_id: string;
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
  user_id: string;
  display_name: string;
  telegram_id: string | null;
  value: number;
  badge_title: string | null;
  badge_milestone: number | null;
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
  archetype_key: string | null;
  archetype_weekday: number | null;
  recommendation_text: string | null;
  recent_books: string[];
  badges_earned: number;
  /** A historical record nobody has claimed yet, not a registered member. */
  is_archive: boolean;
  archive_usernames: string[];
  rounds_count: number;
  total_minutes: number;
  books_count: number;
};

export type PublicProfile = {
  user_id: string;
  username: string;
  display_name: string;
  telegram_id: string | null;
  avatar_data: string | null;
  recommendation_text: string | null;
  reading_music_url: string | null;
  archetype_key: string | null;
  archetype_weekday: number | null;
  total_hours: number;
  longest_streak_days: number;
  rounds_participated: number;
  books_finished: number;
  badges_earned: number;
  badges: Badge[];
  recent_books: string[];
  favorite_books: string[];
  is_buddy: boolean;
  /** An unclaimed archive record, not a member's own profile. */
  is_archive: boolean;
  is_self: boolean;
};

// Suggestion box (temporary public feedback form)
export type Suggestion = {
  id: string;
  name: string | null;
  message: string;
  author_display_name: string | null;
  author_user_id: string | null;
  created_at: string;
};

export type Buddy = {
  user_id: string;
  username: string;
  display_name: string;
  telegram_id: string | null;
  avatar_data: string | null;
  archetype_key: string | null;
  archetype_weekday: number | null;
};



/** One calendar year of community history, from /stats/public. */
export type YearlyStat = {
  year: number;
  readers: number;
  minutes: number;
  entries: number;
};

// Personal library (uploaded PDF/EPUB)
export type LibraryBook = {
  id: string;
  title: string;
  author: string | null;
  file_format: 'pdf' | 'epub';
  file_size: number;
  cover_data: string | null;
  progress_percent: number;
  progress_position: string | null;
  last_read_at: string | null;
  is_visible_to_buddies: boolean;
  created_at: string;
};

export type LibraryStats = {
  total_books: number;
  finished_books: number;
  in_progress_books: number;
  not_started_books: number;
  average_percent: number;
  storage_used_bytes: number;
  storage_quota_bytes: number;
};

export type ShelfBook = {
  title: string;
  author: string | null;
  file_format: 'pdf' | 'epub';
  cover_data: string | null;
  progress_percent: number;
  last_read_at: string | null;
};

export type BadgeHolder = { user_id: string; display_name: string; value: number };

export type BadgeStats = {
  key: string;
  holders: number;
  total_readers: number;
  percent: number;
  sample: BadgeHolder[];
  next_threshold: number | null;
  next_key: string | null;
};

/** One volume on a reader's bookcase — finished, readable here, or both. */
export type BookcaseBook = {
  key: string;
  title: string;
  author: string | null;
  note: string | null;
  /** Came from a comment marked private: only its owner ever sees it. */
  note_is_private: boolean;
  status: 'finished' | 'reading' | 'unread';
  source: 'round' | 'manual' | 'upload';
  finished_on: string | null;
  round_year: number | null;
  round_month: number | null;
  times_finished: number;
  match_key: string | null;
  fellow_readers: number;
  has_file: boolean;
  file_format: 'pdf' | 'epub' | null;
  file_size: number | null;
  cover_data: string | null;
  progress_percent: number;
  last_read_at: string | null;
  shelved_on: string | null;
  /** A real cover found online, served from our API; the thumb is small. */
  cover_url: string | null;
  cover_thumb_url: string | null;
  /** Where that edition was found (Google Books). */
  source_url: string | null;
  /** Owner only: how they've set the cover, and whether they corrected anything. */
  cover_mode: 'auto' | 'none' | 'image' | null;
  edited: boolean;
  /** Owner only. */
  upload_id: string | null;
  manual_id: string | null;
  is_visible_to_buddies: boolean | null;
};

export type Bookcase = {
  owner: {
    user_id: string;
    username: string;
    display_name: string;
    avatar_data: string | null;
    is_archive: boolean;
  };
  is_self: boolean;
  books: BookcaseBook[];
};

export type FellowReader = {
  user_id: string;
  display_name: string;
  avatar_data: string | null;
  is_archive: boolean;
  is_viewer: boolean;
};

/** An edition a reader can take a cover from. */
export type CoverOption = {
  source: 'google' | 'openlibrary';
  volume_id: string;
  title: string;
  author: string | null;
  thumb_url: string;
};
