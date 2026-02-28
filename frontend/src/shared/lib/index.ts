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
} from './api';

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
} from './types';
