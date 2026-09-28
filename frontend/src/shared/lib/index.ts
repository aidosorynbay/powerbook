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
} from './types';
export { useTheme, useResolvedTheme, readThemeChoice, resolveTheme, applyTheme, THEME_KEY, type ThemeChoice } from './theme';
