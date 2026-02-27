import { createContext, useContext, useState, useCallback, ReactNode, useMemo } from 'react';
import { STORAGE_KEY_LOCALE } from './constants';

export type Locale = 'ru' | 'kk' | 'en';

const translations = {
  ru: {
    // Header
    'header.about': 'О нас',
    'header.reviews': 'Отзывы',
    'header.faq': 'FAQ',
    'header.telegram': 'Telegram',
    'header.login': 'Вход',
    'header.register': 'Регистрация',
    'header.logout': 'Выйти',
    'header.currentRound': 'Текущий раунд',
    'header.archive': 'Архив',

    // Bottom nav
    'nav.round': 'Раунд',
    'nav.archive': 'Архив',
    'nav.results': 'Результаты',

    // Auth pages
    'login.title': 'Вход',
    'login.subtitle': 'Войдите, чтобы продолжить.',
    'login.email': 'Email',
    'login.password': 'Пароль',
    'login.submit': 'Войти',
    'login.submitting': 'Входим…',
    'login.noAccount': 'Нет аккаунта?',
    'login.goRegister': 'Регистрация',

    'register.title': 'Регистрация',
    'register.subtitle': 'Создайте аккаунт за минуту.',
    'register.name': 'Имя',
    'register.email': 'Email',
    'register.password': 'Пароль',
    'register.passwordHint': 'Минимум 6 символов. (bcrypt лимит: 72 байта)',
    'register.gender': 'Пол',
    'register.genderUnknown': 'Не указывать',
    'register.genderMale': 'Мужской',
    'register.genderFemale': 'Женский',
    'register.submit': 'Создать аккаунт',
    'register.submitting': 'Создаём…',
    'register.hasAccount': 'Уже есть аккаунт?',
    'register.goLogin': 'Войти',

    // Dashboard
    'dashboard.greeting': 'Привет, {name}!',
    'dashboard.loading': 'Загрузка...',
    'dashboard.noRoundTitle': 'Нет активного раунда',
    'dashboard.noRoundText': 'Раунд на этот месяц ещё не создан. Заходи позже!',
    'dashboard.registrationUntil': 'Регистрация до {day} числа',
    'dashboard.joinTitle': 'Присоединяйся к раунду!',
    'dashboard.joinSubtitle': 'Читай каждый день и выигрывай книгу',
    'dashboard.joinBtn': 'Участвовать',
    'dashboard.joining': 'Присоединяемся...',
    'dashboard.leaveBtn': 'Покинуть раунд',
    'dashboard.leaving': 'Выходим...',
    'dashboard.leaveConfirm': 'Вы уверены, что хотите покинуть раунд?',
    'dashboard.leaveConfirmBtn': 'Да, выйти',
    'dashboard.leaveDeadline': 'Выйти можно до {day} числа',
    'dashboard.leaderboard': 'Таблица лидеров',
    'dashboard.noParticipants': 'Пока нет участников',
    'dashboard.daysShort': 'дн.',
    'dashboard.myCalendar': 'Мой календарь',
    'dashboard.logTitle': 'Записать чтение — {date}',
    'dashboard.logMinutes': 'Минуты чтения',
    'dashboard.cancel': 'Отмена',
    'dashboard.save': 'Сохранить',
    'dashboard.saving': 'Сохраняем...',
    'dashboard.lastDay': 'Последний день — время подвести итоги',
    'dashboard.lastDayNoScore': 'Этот день не участвует в подсчёте',
    'dashboard.countdown': 'До закрытия: {time}',
    'dashboard.userCalendar': 'Календарь — {name}',
    'dashboard.totalScore': 'Итого: {score} дн.',
    'dashboard.correctionPeriod': 'Период коррекции — проверьте и исправьте свои записи',
    'dashboard.correctionDeadline': 'Коррекция закрывается через: {time}',
    'dashboard.correctionsEnded': 'Коррекция завершена',
    'dashboard.nextRoundCountdown': 'Регистрация на новый раунд через: {time}',
    'dashboard.registerNextRound': 'Записаться на новый раунд',
    'dashboard.registeringNextRound': 'Записываемся...',
    'dashboard.nextRoundSoon': 'Новый раунд скоро начнётся',
    'dashboard.lastDayCorrection': 'Этот день не считается в очках (только коррекция)',
    'dashboard.today': 'Сегодня',
    'dashboard.bookFinished': 'Книга прочитана',
    'dashboard.addComment': 'Комментарий',
    'dashboard.commentPlaceholder': 'Ваши мысли о прочитанном...',
    'dashboard.noRoundToday': 'Нет активного раунда для записи',
    'dashboard.legend30': '30+ мин',
    'dashboard.legend2': '2-29 мин',
    'dashboard.legendMissed': '<2 мин',
    'dashboard.legendFuture': 'Будущее',
    'dashboard.legendLastDay': 'Последний день',
    'dashboard.legendStar': 'Книга прочитана',
    'dashboard.legendComment': 'Есть комментарий',

    // Results
    'header.results': 'Результаты',
    'results.title': 'Результаты раунда',
    'results.noResults': 'Результаты ещё не опубликованы',
    'results.rank': '#',
    'results.name': 'Участник',
    'results.score': 'Дней',
    'results.winner': 'Победитель',
    'results.loser': 'Проигравший',
    'results.pairs': 'Обмен книгами',
    'results.givesTo': 'дарит книгу →',

    // Archive
    'archive.title': 'Архив чтения',
    'archive.noData': 'Нет данных за этот год',

    // Round status
    'status.draft': 'Черновик',
    'status.registration_open': 'Регистрация открыта',
    'status.locked': 'Раунд идёт',
    'status.closed': 'Завершён',
    'status.results_published': 'Результаты опубликованы',

    // Months
    'month.1': 'Январь',
    'month.2': 'Февраль',
    'month.3': 'Март',
    'month.4': 'Апрель',
    'month.5': 'Май',
    'month.6': 'Июнь',
    'month.7': 'Июль',
    'month.8': 'Август',
    'month.9': 'Сентябрь',
    'month.10': 'Октябрь',
    'month.11': 'Ноябрь',
    'month.12': 'Декабрь',

    // Weekdays
    'weekday.mon': 'Пн',
    'weekday.tue': 'Вт',
    'weekday.wed': 'Ср',
    'weekday.thu': 'Чт',
    'weekday.fri': 'Пт',
    'weekday.sat': 'Сб',
    'weekday.sun': 'Вс',

    // Stats
    'stats.title': 'Платформа в цифрах',
    'stats.subtitle': 'Живая статистика сообщества читателей',
    'stats.currentRound': 'Текущий круг',
    'stats.active': 'Активен',
    'stats.inactive': 'Неактивен',
    'stats.participants': 'Участников',
    'stats.daysRemaining': 'Осталось дней',
    'stats.roundProgress': 'Прогресс круга',
    'stats.completed': 'завершено',
    'stats.totalParticipants': 'всего участников',
    'stats.hoursRead': 'часов прочитано',
    'stats.totalRounds': 'проведённых кругов',

    // Hero
    'hero.titleLine1': 'Читай каждый день.',
    'hero.titleLine2': 'Выигрывай книги.',
    'hero.subtitle1': 'Ежемесячный челлендж по чтению с реальными результатами.',
    'hero.subtitle2': 'Формируй привычку, соревнуйся с другими читателями.',
    'hero.joinBtn': 'Присоединиться',
    'hero.learnMore': 'Узнать больше',

    // Errors
    'error.network': 'Ошибка сети. Попробуйте ещё раз.',
    'error.validation': 'Ошибка валидации. Проверьте данные.',
  },

  kk: {
    // Header
    'header.about': 'Біз туралы',
    'header.reviews': 'Пікірлер',
    'header.faq': 'FAQ',
    'header.telegram': 'Telegram',
    'header.login': 'Кіру',
    'header.register': 'Тіркелу',
    'header.logout': 'Шығу',
    'header.currentRound': 'Ағымдағы раунд',
    'header.archive': 'Мұрағат',

    // Bottom nav
    'nav.round': 'Раунд',
    'nav.archive': 'Мұрағат',
    'nav.results': 'Нәтижелер',

    // Auth pages
    'login.title': 'Кіру',
    'login.subtitle': 'Жалғастыру үшін кіріңіз.',
    'login.email': 'Email',
    'login.password': 'Құпия сөз',
    'login.submit': 'Кіру',
    'login.submitting': 'Кіру...',
    'login.noAccount': 'Аккаунт жоқ па?',
    'login.goRegister': 'Тіркелу',

    'register.title': 'Тіркелу',
    'register.subtitle': 'Бір минутта аккаунт жасаңыз.',
    'register.name': 'Аты',
    'register.email': 'Email',
    'register.password': 'Құпия сөз',
    'register.passwordHint': 'Кемінде 6 таңба. (bcrypt шегі: 72 байт)',
    'register.gender': 'Жынысы',
    'register.genderUnknown': 'Көрсетпеу',
    'register.genderMale': 'Ер',
    'register.genderFemale': 'Әйел',
    'register.submit': 'Аккаунт жасау',
    'register.submitting': 'Жасалуда...',
    'register.hasAccount': 'Аккаунт бар ма?',
    'register.goLogin': 'Кіру',

    // Dashboard
    'dashboard.greeting': 'Сәлем, {name}!',
    'dashboard.loading': 'Жүктелуде...',
    'dashboard.noRoundTitle': 'Белсенді раунд жоқ',
    'dashboard.noRoundText': 'Бұл айға раунд әлі жасалмаған. Кейінірек кіріңіз!',
    'dashboard.registrationUntil': 'Тіркелу {day} күнге дейін',
    'dashboard.joinTitle': 'Раундқа қосылыңыз!',
    'dashboard.joinSubtitle': 'Күн сайын оқып, кітап ұтып алыңыз',
    'dashboard.joinBtn': 'Қатысу',
    'dashboard.joining': 'Қосылу...',
    'dashboard.leaveBtn': 'Раундтан шығу',
    'dashboard.leaving': 'Шығу...',
    'dashboard.leaveConfirm': 'Раундтан шығуға сенімдісіз бе?',
    'dashboard.leaveConfirmBtn': 'Иә, шығу',
    'dashboard.leaveDeadline': '{day} күніне дейін шығуға болады',
    'dashboard.leaderboard': 'Көшбасшылар кестесі',
    'dashboard.noParticipants': 'Әзірге қатысушылар жоқ',
    'dashboard.daysShort': 'күн',
    'dashboard.myCalendar': 'Менің күнтізбем',
    'dashboard.logTitle': 'Оқуды жазу — {date}',
    'dashboard.logMinutes': 'Оқу минуттары',
    'dashboard.cancel': 'Бас тарту',
    'dashboard.save': 'Сақтау',
    'dashboard.saving': 'Сақталуда...',
    'dashboard.lastDay': 'Соңғы күн — нәтижелерді қорытындылау уақыты',
    'dashboard.lastDayNoScore': 'Бұл күн есепке кірмейді',
    'dashboard.countdown': 'Жабылуға: {time}',
    'dashboard.userCalendar': 'Күнтізбе — {name}',
    'dashboard.totalScore': 'Барлығы: {score} күн',
    'dashboard.correctionPeriod': 'Түзету кезеңі — жазбаларыңызды тексеріп, түзетіңіз',
    'dashboard.correctionDeadline': 'Түзету жабылады: {time}',
    'dashboard.correctionsEnded': 'Түзету аяқталды',
    'dashboard.nextRoundCountdown': 'Жаңа раундқа тіркелу: {time}',
    'dashboard.registerNextRound': 'Жаңа раундқа жазылу',
    'dashboard.registeringNextRound': 'Жазылу...',
    'dashboard.nextRoundSoon': 'Жаңа раунд жақында басталады',
    'dashboard.lastDayCorrection': 'Бұл күн ұпайға есептелмейді (тек түзету)',
    'dashboard.today': 'Бүгін',
    'dashboard.bookFinished': 'Кітап оқылды',
    'dashboard.addComment': 'Түсініктеме',
    'dashboard.commentPlaceholder': 'Оқығаныңыз туралы ойларыңыз...',
    'dashboard.noRoundToday': 'Жазу үшін белсенді раунд жоқ',
    'dashboard.legend30': '30+ мин',
    'dashboard.legend2': '2-29 мин',
    'dashboard.legendMissed': '<2 мин',
    'dashboard.legendFuture': 'Болашақ',
    'dashboard.legendLastDay': 'Соңғы күн',
    'dashboard.legendStar': 'Кітап оқылды',
    'dashboard.legendComment': 'Түсініктеме бар',

    // Results
    'header.results': 'Нәтижелер',
    'results.title': 'Раунд нәтижелері',
    'results.noResults': 'Нәтижелер әлі жарияланбаған',
    'results.rank': '#',
    'results.name': 'Қатысушы',
    'results.score': 'Күн',
    'results.winner': 'Жеңімпаз',
    'results.loser': 'Жеңілген',
    'results.pairs': 'Кітап алмасу',
    'results.givesTo': 'кітап сыйлайды →',

    // Archive
    'archive.title': 'Оқу мұрағаты',
    'archive.noData': 'Бұл жылға деректер жоқ',

    // Round status
    'status.draft': 'Жоба',
    'status.registration_open': 'Тіркелу ашық',
    'status.locked': 'Раунд жүріп жатыр',
    'status.closed': 'Аяқталды',
    'status.results_published': 'Нәтижелер жарияланды',

    // Months
    'month.1': 'Қаңтар',
    'month.2': 'Ақпан',
    'month.3': 'Наурыз',
    'month.4': 'Сәуір',
    'month.5': 'Мамыр',
    'month.6': 'Маусым',
    'month.7': 'Шілде',
    'month.8': 'Тамыз',
    'month.9': 'Қыркүйек',
    'month.10': 'Қазан',
    'month.11': 'Қараша',
    'month.12': 'Желтоқсан',

    // Weekdays
    'weekday.mon': 'Дс',
    'weekday.tue': 'Сс',
    'weekday.wed': 'Ср',
    'weekday.thu': 'Бс',
    'weekday.fri': 'Жм',
    'weekday.sat': 'Сн',
    'weekday.sun': 'Жс',

    // Stats
    'stats.title': 'Платформа сандарда',
    'stats.subtitle': 'Оқырмандар қауымдастығының статистикасы',
    'stats.currentRound': 'Ағымдағы раунд',
    'stats.active': 'Белсенді',
    'stats.inactive': 'Белсенді емес',
    'stats.participants': 'Қатысушылар',
    'stats.daysRemaining': 'Қалған күндер',
    'stats.roundProgress': 'Раунд барысы',
    'stats.completed': 'аяқталды',
    'stats.totalParticipants': 'барлық қатысушылар',
    'stats.hoursRead': 'оқылған сағаттар',
    'stats.totalRounds': 'өткізілген раундтар',

    // Hero
    'hero.titleLine1': 'Күн сайын оқы.',
    'hero.titleLine2': 'Кітаптар ұт.',
    'hero.subtitle1': 'Нағыз нәтижелері бар айлық оқу челленджі.',
    'hero.subtitle2': 'Әдет қалыптастыр, басқа оқырмандармен жарыс.',
    'hero.joinBtn': 'Қосылу',
    'hero.learnMore': 'Толығырақ',

    // Errors
    'error.network': 'Желі қатесі. Қайтадан көріңіз.',
    'error.validation': 'Тексеру қатесі. Деректерді тексеріңіз.',
  },

  en: {
    // Header
    'header.about': 'About',
    'header.reviews': 'Reviews',
    'header.faq': 'FAQ',
    'header.telegram': 'Telegram',
    'header.login': 'Login',
    'header.register': 'Sign Up',
    'header.logout': 'Log Out',
    'header.currentRound': 'Current Round',
    'header.archive': 'Archive',

    // Bottom nav
    'nav.round': 'Round',
    'nav.archive': 'Archive',
    'nav.results': 'Results',

    // Auth pages
    'login.title': 'Login',
    'login.subtitle': 'Sign in to continue.',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.submit': 'Sign In',
    'login.submitting': 'Signing in…',
    'login.noAccount': "Don't have an account?",
    'login.goRegister': 'Sign Up',

    'register.title': 'Sign Up',
    'register.subtitle': 'Create an account in a minute.',
    'register.name': 'Name',
    'register.email': 'Email',
    'register.password': 'Password',
    'register.passwordHint': 'At least 6 characters. (bcrypt limit: 72 bytes)',
    'register.gender': 'Gender',
    'register.genderUnknown': 'Prefer not to say',
    'register.genderMale': 'Male',
    'register.genderFemale': 'Female',
    'register.submit': 'Create Account',
    'register.submitting': 'Creating…',
    'register.hasAccount': 'Already have an account?',
    'register.goLogin': 'Sign In',

    // Dashboard
    'dashboard.greeting': 'Hi, {name}!',
    'dashboard.loading': 'Loading...',
    'dashboard.noRoundTitle': 'No active round',
    'dashboard.noRoundText': "This month's round hasn't been created yet. Check back later!",
    'dashboard.registrationUntil': 'Registration until day {day}',
    'dashboard.joinTitle': 'Join the round!',
    'dashboard.joinSubtitle': 'Read every day and win a book',
    'dashboard.joinBtn': 'Participate',
    'dashboard.joining': 'Joining...',
    'dashboard.leaveBtn': 'Leave Round',
    'dashboard.leaving': 'Leaving...',
    'dashboard.leaveConfirm': 'Are you sure you want to leave the round?',
    'dashboard.leaveConfirmBtn': 'Yes, leave',
    'dashboard.leaveDeadline': 'You can leave until day {day}',
    'dashboard.leaderboard': 'Leaderboard',
    'dashboard.noParticipants': 'No participants yet',
    'dashboard.daysShort': 'd.',
    'dashboard.myCalendar': 'My Calendar',
    'dashboard.logTitle': 'Log reading — {date}',
    'dashboard.logMinutes': 'Minutes read',
    'dashboard.cancel': 'Cancel',
    'dashboard.save': 'Save',
    'dashboard.saving': 'Saving...',
    'dashboard.lastDay': 'Last day — time to finalize your results',
    'dashboard.lastDayNoScore': 'This day does not count for scoring',
    'dashboard.countdown': 'Closing in: {time}',
    'dashboard.userCalendar': 'Calendar — {name}',
    'dashboard.totalScore': 'Total: {score} d.',
    'dashboard.correctionPeriod': 'Correction period — review and fix your entries',
    'dashboard.correctionDeadline': 'Corrections close in: {time}',
    'dashboard.correctionsEnded': 'Corrections closed',
    'dashboard.nextRoundCountdown': 'New round registration in: {time}',
    'dashboard.registerNextRound': 'Register for next round',
    'dashboard.registeringNextRound': 'Registering...',
    'dashboard.nextRoundSoon': 'New round coming soon',
    'dashboard.lastDayCorrection': 'This day does not count for scoring (correction only)',
    'dashboard.today': 'Today',
    'dashboard.bookFinished': 'Book finished',
    'dashboard.addComment': 'Comment',
    'dashboard.commentPlaceholder': 'Your thoughts on what you read...',
    'dashboard.noRoundToday': 'No active round to log',
    'dashboard.legend30': '30+ min',
    'dashboard.legend2': '2-29 min',
    'dashboard.legendMissed': '<2 min',
    'dashboard.legendFuture': 'Future',
    'dashboard.legendLastDay': 'Last day',
    'dashboard.legendStar': 'Book finished',
    'dashboard.legendComment': 'Has comment',

    // Results
    'header.results': 'Results',
    'results.title': 'Round Results',
    'results.noResults': 'No results published yet',
    'results.rank': '#',
    'results.name': 'Participant',
    'results.score': 'Days',
    'results.winner': 'Winner',
    'results.loser': 'Loser',
    'results.pairs': 'Book Exchange',
    'results.givesTo': 'gives book to →',

    // Archive
    'archive.title': 'Reading Archive',
    'archive.noData': 'No data for this year',

    // Round status
    'status.draft': 'Draft',
    'status.registration_open': 'Registration open',
    'status.locked': 'Round in progress',
    'status.closed': 'Closed',
    'status.results_published': 'Results published',

    // Months
    'month.1': 'January',
    'month.2': 'February',
    'month.3': 'March',
    'month.4': 'April',
    'month.5': 'May',
    'month.6': 'June',
    'month.7': 'July',
    'month.8': 'August',
    'month.9': 'September',
    'month.10': 'October',
    'month.11': 'November',
    'month.12': 'December',

    // Weekdays
    'weekday.mon': 'Mo',
    'weekday.tue': 'Tu',
    'weekday.wed': 'We',
    'weekday.thu': 'Th',
    'weekday.fri': 'Fr',
    'weekday.sat': 'Sa',
    'weekday.sun': 'Su',

    // Stats
    'stats.title': 'Platform in numbers',
    'stats.subtitle': 'Live statistics of our reading community',
    'stats.currentRound': 'Current round',
    'stats.active': 'Active',
    'stats.inactive': 'Inactive',
    'stats.participants': 'Participants',
    'stats.daysRemaining': 'Days remaining',
    'stats.roundProgress': 'Round progress',
    'stats.completed': 'completed',
    'stats.totalParticipants': 'total participants',
    'stats.hoursRead': 'hours read',
    'stats.totalRounds': 'rounds completed',

    // Hero
    'hero.titleLine1': 'Read every day.',
    'hero.titleLine2': 'Win books.',
    'hero.subtitle1': 'Monthly reading challenge with real results.',
    'hero.subtitle2': 'Build a habit, compete with other readers.',
    'hero.joinBtn': 'Join Now',
    'hero.learnMore': 'Learn More',

    // Errors
    'error.network': 'Network error. Please try again.',
    'error.validation': 'Validation error. Please check your inputs.',
  },
} as const;

export type TranslationKey = keyof typeof translations.ru;

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey | string, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function getInitialLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY_LOCALE);
  if (saved === 'ru' || saved === 'kk' || saved === 'en') return saved;
  // Detect from browser
  const browserLang = navigator.language.slice(0, 2);
  if (browserLang === 'kk') return 'kk';
  if (browserLang === 'en') return 'en';
  return 'ru';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    localStorage.setItem(STORAGE_KEY_LOCALE, newLocale);
    setLocaleState(newLocale);
  }, []);

  const t = useCallback(
    (key: TranslationKey | string, params?: Record<string, string | number>): string => {
      const localeTranslations = translations[locale] as Record<string, string>;
      const ruTranslations = translations.ru as Record<string, string>;
      let text = localeTranslations[key] ?? ruTranslations[key] ?? key;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          text = text.replace(`{${k}}`, String(v));
        });
      }
      return text;
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}

export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'ru', label: 'Рус' },
  { code: 'kk', label: 'Қаз' },
  { code: 'en', label: 'Eng' },
];
