// Shared utilities and helpers

// Auth
export { AuthProvider, useAuth } from './auth';

// i18n
export { I18nProvider, useI18n, LOCALES, circleOrdinal } from './i18n';
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
export { initAnalytics, initClarity, setAnalyticsUser, track, trackSectionView } from './analytics';

// The award pin worn by each avatar
export { enableWornPins, refreshWornPins, useWornPin, pinCutUrl } from './wornPins';

// Image utilities
export { resizeImageToDataUrl } from './imageResize';

// The time given a book
export { formatSpent } from './bookTime';
export { guessBook, notSameBook, titleCloseness } from './sameBook';

// Color utilities
export { colorFromSeed } from './colorHash';

// Constants
export {
  DEFAULT_GROUP_SLUG,
  STORAGE_KEY_TOKEN,
  STORAGE_KEY_LOCALE,
  KK_MONTHS,
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
  DayBook,
  ReadingBooksResponse,
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
  AwardEarned,
  AwardTrack,
  Awards,
  League,
  LeagueTierKey,
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
  ReviewReply,
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
  MyRoundStats,
  MyResult,
  RoundLetter,
  BookChatMessage,
  BookChatState,
  SiteNotification,
  NotificationSettings,
  BookFinish,
  BookDays,
  BookWatch,
  CardDay,
  DayCard,
  MyDayCard,
  Invites,
  InviteGuest,
  ShareChannel,
  WantBook,
} from './types';
export { useTheme, useResolvedTheme, readThemeChoice, resolveTheme, applyTheme, THEME_KEY, type ThemeChoice } from './theme';
export { useWaitlist, inviteLink, rememberInvite, invitedRef, markJoinIntent, type WaitlistState } from './waitlist';

// The app on the home screen
export { initInstall, isStandalone, getDisplayMode, getInstallState, promptInstall, detectEnv } from './install';
export type { DisplayMode, InstallState, InstallEnv } from './install';

// Web push: the reading reminder
export { pushSupport, pushPermission, hasSubscription, enablePush, disablePush, localTimeZone } from './push';
export type { PushSupport, EnableResult } from './push';
