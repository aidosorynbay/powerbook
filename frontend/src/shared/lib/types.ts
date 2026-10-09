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
  /** Which book(s) the day's minutes went to — the reader's own days only. */
  books?: DayBook[];
};

/** «Что читаю»: one book of a day and the minutes it got. */
export type DayBook = {
  title: string;
  minutes: number;
  finished: boolean;
};

/** «Книга прочитана», before saving: which book of the shelf or the library
 * the title is, and the time it took from the day it was begun. */
export type BookFinish = {
  exact: boolean;
  choices: { key: string; title: string; author: string | null; cover_thumb_url: string | null; readers: number; on_shelf: boolean }[];
  start: string;
  suggested: string;
  earliest: string;
  minutes: number;
  days: number;
  filled_days: number;
  /** Books the days with no book named are shared with: read at the same time. */
  shared_with: string[];
};

/** «Дни чтения»: a finished book's days, one by one, and what each gave it. */
export type BookDays = {
  title: string;
  day: string;
  earliest: string;
  minutes: number;
  days_read: number;
  days: {
    date: string;
    total: number;
    minutes: number;
    offer: number;
    finish: boolean;
    others: { title: string; minutes: number }[];
  }[];
};

/** The book the minutes form starts with, and others read lately. */
export type ReadingBooksResponse = {
  current: string[];
  recent: string[];
  /** Each of those titles' book: the reader's minutes on it so far, every spelling and the reading room counted. */
  minutes?: Record<string, number>;
};

export type CalendarResponse = {
  round_id: string;
  total_minutes: number;
  total_score: number;
  days: CalendarDay[];
};

/** A reader's round as a shared day shows it: minutes only, never books or comments. */
export type CardDay = { date: string; minutes: number; score: number };

export type DayCard = {
  username: string;
  display_name: string;
  avatar_data: string | null;
  year: number;
  month: number;
  first_day: string;
  last_day: string;
  /** The day the card is about, and its number within the round. */
  day: string;
  day_number: number;
  minutes: number;
  streak: number;
  goal_days: number;
  total_minutes: number;
  /** Every day of the round; those after `day` are still ahead. */
  days: CardDay[];
};

/** The reader's own card: `book` and the days a book was finished are for their
 * story sticker and the day picker, and never on the public card. */
export type MyDayCard = DayCard & { round_id: string; invited: number; book: string | null; finished_days: string[] };

/** 'sticker': the story sticker, copied or saved; 'story': the whole story picture. */
export type ShareChannel = 'whatsapp' | 'telegram' | 'x' | 'copy' | 'native' | 'sticker' | 'story';

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
  has_photo?: boolean;
};

// A reader's photo of the book exchange, shown on the results page.
export type ExchangePhoto = {
  id: string;
  pair_id: string;
  user_id: string;
  role: 'giver' | 'receiver';
  caption: string | null;
  url: string;
  giver_name: string;
  giver_telegram_id: string | null;
  receiver_name: string;
  receiver_telegram_id: string | null;
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
  photo_url?: string | null;
};

export type RoundResultsResponse = {
  round_id: string;
  year: number;
  month: number;
  results: RoundResultEntry[];
  pairs: ExchangePair[];
  my_result: MyResult | null;
  my_exchange: MyExchange | null;
  photos?: ExchangePhoto[];
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

export type ClaimSuggestions = {
  // The account already carries circles from before it was opened.
  has_archive: boolean;
  // Archive nicknames that look like this reader, best first.
  suggestions: ClaimCandidate[];
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
  /** Covers for the top-3, same order; null when none is known yet. */
  favorite_covers?: (string | null)[];
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
/** One shelf in a reader's bookcase, named for its theme. */
export type CustomShelf = {
  id: string;
  name: string;
  position: number;
};

/** A reader's own note on a book on their shelf; only they see it. */
export type BookNote = {
  id: string;
  text: string;
  created_at: string;
  updated_at: string;
};

export type BookcaseBook = {
  key: string;
  title: string;
  author: string | null;
  note: string | null;
  /** Came from a comment marked private: only its owner ever sees it. */
  note_is_private: boolean;
  /** Owner only: the reader's own notes, oldest first. */
  notes?: BookNote[];
  /** Which of the owner's shelves it stands on; null is unsorted. */
  shelf_id?: string | null;
  status: 'finished' | 'reading' | 'unread';
  source: 'round' | 'manual' | 'upload' | 'log';
  /** «Убрать с полки»: the owner took it off (only the owner gets it, to put it back). */
  hidden?: boolean;
  finished_on: string | null;
  round_year: number | null;
  round_month: number | null;
  times_finished: number;
  /** Minutes the reader's days in the circle gave this book, and on how many days. */
  minutes_read?: number;
  days_read?: number;
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
  /** «Какая это книга?»: the owner said which shared-library book this copy is. */
  pinned?: boolean;
  /** Readers watching this (finished) book, shown to its owner beside «Продать». */
  wanted_by?: number;
  /** Owner only. */
  upload_id: string | null;
  manual_id: string | null;
  is_visible_to_buddies: boolean | null;
  /** The owner's mark out of ten and their review; public, like the shelf. */
  rating?: number | null;
  review?: string | null;
  /** Owner only. */
  review_id?: string | null;
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
  /** The owner's shelves, top to bottom (the sections view). */
  shelves?: CustomShelf[];
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

// ---------- the shared library, marks and the book market ----------

export type CatalogItem = {
  key: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  cover_thumb_url: string | null;
  readers: number;
  /** PowerBook readers' own marks, out of ten. */
  pb_rating: number | null;
  pb_votes: number;
  pb_reviews: number;
  /** Elsewhere, on that source's own scale (out of 5). */
  ext_rating: number | null;
  ext_scale: number;
  ext_votes: number | null;
  ext_source: 'goodreads' | 'livelib' | 'google' | 'openlibrary' | null;
  for_sale: number;
  my_rating: number | null;
  topics: string[];
};

export type CatalogPage = {
  items: CatalogItem[];
  total: number;
  offset: number;
  counts: { all: number; rated: number; reviewed: number; sale: number };
  topics: Record<string, number>;
};

export type BookReview = {
  id: string;
  user_id: string;
  display_name: string;
  avatar_data: string | null;
  rating: number;
  text: string | null;
  created_at: string;
  updated_at: string;
  is_viewer: boolean;
};

export type TextWithSource = { text: string; source: string; url: string | null };

export type Seller = { user_id: string; display_name: string; avatar_data?: string | null; telegram: string | null };

export type Listing = {
  id: string;
  title: string;
  author: string | null;
  work_key: string | null;
  volume_key: string | null;
  price: number;
  condition: 'new' | 'like_new' | 'good' | 'fair';
  city: string | null;
  contact: string | null;
  note: string | null;
  photo_url: string | null;
  cover_url: string | null;
  cover_thumb_url: string | null;
  status: 'active' | 'reserved' | 'sold' | 'hidden';
  created_at: string;
  seller: Seller;
  is_mine: boolean;
  pb_rating: number | null;
  ext_rating: number | null;
  ext_scale: number;
  ext_source: CatalogItem['ext_source'];
};

export type Work = CatalogItem & {
  ext_url: string | null;
  goodreads_url: string | null;
  source_url: string | null;
  about: TextWithSource | null;
  readers_say: TextWithSource | null;
  pages: number | null;
  year: number | null;
  facts_status: string | null;
  histogram: number[];
  reviews: BookReview[];
  readers_list: { user_id: string; display_name: string; avatar_data: string | null; is_archive: boolean; is_viewer: boolean }[];
  my_review: BookReview | null;
  my_volume_key: string | null;
  listings: Listing[];
  /** «Следить за книгой»: whether the viewer watches it, and how many readers do. */
  watching?: boolean;
  watchers?: number;
  /** Minutes given this book in the circle's days and the reading room: the viewer's own, everyone's, and by how many. */
  my_minutes?: number;
  circle_minutes?: number;
  circle_readers?: number;
};

export type MarketPage = { items: Listing[]; total: number; offset: number; cities: string[] };

export type ShelfReview = { id: string; work_key: string; volume_key: string | null; rating: number; text: string | null; updated_at: string };

// ---------- reading summaries ----------

export type PeriodBook = {
  key: string;
  work_key: string | null;
  title: string;
  author: string | null;
  cover_url: string | null;
  finished_on: string | null;
  rating: number | null;
  topics: string[];
  notes_count: number;
  has_comment: boolean;
};

export type ReadingOverview = {
  period: string;
  years: number[];
  months: number[];
  minutes: number;
  days_read: number;
  longest_streak: number;
  best_day: { date: string; minutes: number } | null;
  units: { key: string; minutes: number; books: number }[];
  books: PeriodBook[];
  topics: { key: string; count: number; share: number }[];
  authors: { name: string; count: number }[];
  avg_rating: number | null;
  rated_count: number;
  notes_count: number;
  ai_available: boolean;
};

export type Recommendation = {
  book: CatalogItem;
  reason: 'co_read' | 'popular';
  because_title: string | null;
  because_key: string | null;
  shared_readers: number;
};

export type NotebookEntry = {
  key: string;
  work_key: string | null;
  title: string;
  author: string | null;
  cover_url: string | null;
  finished_on: string | null;
  comment: string | null;
  comment_private: boolean;
  notes: { id: string; text: string; created_at: string }[];
  rating: number | null;
  review: string | null;
  last_at: string | null;
};

export type PeriodLetter = {
  headline: string;
  summary: string;
  themes: { title: string; text: string }[];
  patterns: string[];
  from_notes: { book: string; idea: string }[];
  next_reads: { title: string; author: string; why: string }[];
  question: string;
};

export type BookLetter = {
  summary: string;
  key_ideas: string[];
  moments: string[];
  connections: string[];
  question: string;
};

export type Digest = {
  id: string;
  kind: 'period' | 'book';
  scope: string;
  lang: string;
  status: 'working' | 'done' | 'error';
  content: PeriodLetter | BookLetter | null;
  error: string | null;
  updated_at: string;
  stale: boolean;
};

// ---------- the personal review of a round ----------

export type RoundStats = {
  round_id: string;
  year: number;
  month: number;
  ongoing: boolean;
  days: number;
  goal_days: number;
  partial_days: number;
  missed_days: number;
  minutes: number;
  avg_minutes: number;
  longest_streak: number;
  longest_gap: number;
  best_day: string | null;
  best_day_minutes: number;
  books: number;
  /** Average minutes per weekday, Monday first. */
  weekday_minutes: number[];
  first_half_minutes: number;
  second_half_minutes: number;
  first_week_goal_days: number;
  rank: number | null;
  participants: number | null;
  group: string | null;
};

export type RoundInsight = { key: string; params: Record<string, number>; tips: string[] };

export type RoundReview = {
  round: RoundStats;
  previous: RoundStats | null;
  average: RoundStats | null;
  best: { minutes: number; minutes_year: number; minutes_month: number; goal_days: number; goal_of: number; goal_year: number; goal_month: number; streak: number } | null;
  trend: { year: number; month: number; minutes: number; goal_days: number; days: number; rank: number | null; participants: number | null }[];
  rounds: { id: string; year: number; month: number; has_result: boolean }[];
  rounds_count: number;
  strengths: RoundInsight[];
  improve: RoundInsight[];
  tips: string[];
  ai_available: boolean;
};

export type RoundLetter = {
  headline: string;
  summary: string;
  compared: string;
  strengths: string[];
  improve: { what: string; how: string }[];
  lifehacks: string[];
  next_goal: string;
};

// «Обсудить с AI»: a conversation about one book.
export type BookChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  at: string | null;
};

export type BookChatState = {
  available: boolean;
  work_key: string;
  title: string;
  author: string | null;
  messages: BookChatMessage[];
  left_today: number;
};

// The header bell.
export type SiteNotification = {
  id: string;
  kind: 'new_review' | 'watch_listing' | 'watch_finished' | 'wanted_by' | string;
  data: Record<string, unknown>;
  created_at: string | null;
  read: boolean;
};

// What a reader wants to hear about, kind by kind; on unless switched off.
export type NotificationSettings = Record<string, boolean>;

// «Мои подписки»: books a reader is waiting for.
export type BookWatch = {
  work_key: string;
  title: string;
  author: string | null;
  for_sale: number;
};
