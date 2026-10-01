// Shared utilities and helpers

// Auth
export { AuthProvider, useAuth } from './auth';

// i18n
export { I18nProvider, useI18n, LOCALES } from './i18n';
export type { Locale, TranslationKey } from './i18n';

// API
export {
  getApiBaseUrl,
  getAuthToken,
  getAuthHeaders,
  getJsonHeaders,
  getAuthJsonHeaders,
  parseErrorMessage,
  apiFetch,
  apiPost,
  apiGet,
  apiPut,
  apiDelete,
  apiUpload,
  apiPatch,
  apiGetBlob,
  apiUploadWithProgress,
} from './api';

// Routes
export { isReaderPath } from './routes';

// Analytics (Google Analytics 4)
export { initAnalytics, setAnalyticsUser, track } from './analytics';

// Image utilities
export { resizeImageToDataUrl } from './imageResize';

// Color utilities
export { colorFromSeed } from './colorHash';

// Constants
export {
  DEFAULT_GROUP_SLUG,
  STORAGE_KEY_TOKEN,
  STORAGE_KEY_LOCALE,
} from './constants';

// Types
export type {
  User,
  TokenResponse,
  RoundStatus,
  RoundInfo,
  ParticipationInfo,
  CurrentRoundStatusResponse,
  LeaderboardEntry,
  CalendarDay,
  CalendarResponse,
  PublicStats,
  ArchiveDay,
  YearlyArchiveResponse,
  RoundResultEntry,
  ExchangePair,
  ExchangePhoto,
  RoundResultsResponse,
  LastCompletedRound,
  AllTimeProfile,
  PercentileInfo,
  Archetype,
  BookshelfEntry,
  ManualBook,
  PopularBook,
  ReadingTwin,
  CelebrityMatch,
  Badge as BadgeData,
  LeagueMember,
  LeagueTier,
  Wrapped,
  ReactionSummary,
  ClaimCandidate,
  ClaimSuggestions,
  MyClaim,
  HallOfFameEntry,
  HallOfFameCategory,
  HallOfFame,
  RosterEntry,
  RosterResponse,
  YearlyRosterResponse,
  DirectoryEntry,
  PublicProfile,
  Buddy,
  Suggestion,
  BadgeStats,
  BadgeHolder,
  LibraryBook,
  LibraryStats,
  ShelfBook,
  BookcaseBook,
  BookNote,
  CustomShelf,
  Bookcase,
  FellowReader,
  CoverOption,
  CatalogItem,
  CatalogPage,
  BookReview,
  TextWithSource,
  Seller,
  Listing,
  Work,
  MarketPage,
  ShelfReview,
  PeriodBook,
  ReadingOverview,
  Recommendation,
  NotebookEntry,
  PeriodLetter,
  BookLetter,
  Digest,
  RoundStats,
  RoundInsight,
  RoundReview,
  MyResult,
  RoundLetter,
} from './types';
export { useTheme, useResolvedTheme, readThemeChoice, resolveTheme, applyTheme, THEME_KEY, type ThemeChoice } from './theme';
export { useWaitlist, inviteLink, rememberInvite, markJoinIntent, type WaitlistState } from './waitlist';
