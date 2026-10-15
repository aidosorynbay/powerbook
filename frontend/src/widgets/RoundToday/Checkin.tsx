import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, enablePush, hasSubscription, pushPermission, pushSupport, track, useI18n, type CalendarDay } from '@/shared/lib';
import { Avatar } from '@/shared/ui';
import styles from './RoundToday.module.css';

const SCORE_MINUTES = 30;

/**
 * The day after a miss, one warm line built on the home page's rule «Главное — не пропускать два дня подряд»
 * (agreed 2026-10-15). Only after a single miss: two in a row is WelcomeBack's or the founder's turn, and
 * the line never touches the score or the table.
 */
export function MissedYesterday({
  days,
  todayStr,
  todayMinutes,
  onLogYesterday,
}: {
  days: CalendarDay[];
  todayStr: string;
  todayMinutes: number;
  onLogYesterday: (date: string) => void;
}) {
  const { t } = useI18n();
  const past = days.filter((d) => d.date < todayStr && d.in_round !== false).sort((a, b) => a.date.localeCompare(b.date));
  const [before, yesterday] = past.slice(-2);
  const show =
    todayMinutes < SCORE_MINUTES &&
    !!yesterday &&
    !!before &&
    yesterday.minutes < SCORE_MINUTES &&
    before.minutes >= SCORE_MINUTES;
  useEffect(() => {
    if (show) track('missed_yesterday_shown');
  }, [show]);
  if (!show) return null;
  return (
    <p className={styles.missedLine}>
      {t('today.missedYesterday')}{' '}
      {/* many a «miss» is a day read and not logged */}
      <button type="button" className={styles.missedLog} onClick={() => onLogYesterday(yesterday.date)}>
        {t('today.missedLog')}
      </button>
    </p>
  );
}

type Card = { id: string; text: string; from: string; avatar_data: string | null; answers: string[] };

const MAIN = ['forgot', 'ok'] as const;
const MORE = ['hard', 'out'] as const;
type Answer = (typeof MAIN)[number] | (typeof MORE)[number];

function hiddenKey(id: string) {
  return `pb.checkin.hidden.${id}`;
}

/**
 * «Хей, как вы, всё ок?» — the founder's message to a reader quiet for three days (app/services/checkins.py), on
 * top of «Круг» until it is answered or put away. A letter, not a form (the council, 2026-10-15): two light
 * answers and «Ответить…» in his conversation; the heavier ones wait under «Ещё…». «Читаю — отмечу сейчас»
 * opens yesterday to log it: not logging is not the same as not reading.
 */
export function CheckinCard({ onForgot, onShown }: { onForgot: () => void; onShown?: (shown: boolean) => void }) {
  const { t, locale } = useI18n();
  const [card, setCard] = useState<Card | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    let live = true;
    apiGet<{ card: Card | null }>('/messages/card', { requireAuth: true }).then(({ data }) => {
      if (!live || !data?.card) return;
      try {
        if (localStorage.getItem(hiddenKey(data.card.id))) return;
      } catch {
        /* storage blocked: show it */
      }
      setCard(data.card);
      track('checkin_shown');
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    onShown?.(!!card || !!thanks);
  }, [card, thanks]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!card && !thanks) return null;
  if (!card) {
    return (
      <div className={styles.checkin}>
        <p className={styles.checkinThanks}>{thanks}</p>
        <Link to="/messages?with=founder" className={styles.checkinLink}>{t('checkin.open')}</Link>
      </div>
    );
  }
  const answer = async (kind: Answer) => {
    if (busy) return;
    setBusy(true);
    const { error } = await apiPost(`/messages/checkins/${card.id}/answer`, { answer: kind, locale }, { requireAuth: true });
    setBusy(false);
    if (error) return;
    track('checkin_answer', { answer: kind });
    setThanks(t('checkin.thanks', { name: card.from }));
    setCard(null);
    if (kind === 'forgot') onForgot();
  };
  const hide = () => {
    try {
      localStorage.setItem(hiddenKey(card.id), '1');
    } catch {
      /* it comes back next visit, and that is all */
    }
    track('checkin_answer', { answer: 'hide' });
    setCard(null);
  };
  return (
    <div className={styles.checkin}>
      <div className={styles.checkinHead}>
        <Avatar src={card.avatar_data ?? undefined} name={card.from} size="sm" />
        <b>{card.from}</b>
        <button type="button" className={styles.checkinClose} onClick={hide} aria-label={t('checkin.close')} title={t('checkin.close')}>
          ×
        </button>
      </div>
      <p className={styles.checkinText}>{card.text}</p>
      <div className={styles.checkinAnswers}>
        {MAIN.map((kind) => (
          <button key={kind} type="button" disabled={busy} onClick={() => answer(kind)}>
            {t(`checkin.${kind}`)}
          </button>
        ))}
        <Link to="/messages?with=founder" onClick={() => track('checkin_answer', { answer: 'write' })}>
          {t('checkin.write')}
        </Link>
        {more ? (
          MORE.filter((kind) => card.answers.includes(kind)).map((kind) => (
            <button key={kind} type="button" disabled={busy} onClick={() => answer(kind)}>
              {t(`checkin.${kind}`)}
            </button>
          ))
        ) : (
          <button type="button" className={styles.checkinMore} onClick={() => setMore(true)}>
            {t('checkin.more')}
          </button>
        )}
      </div>
    </div>
  );
}

const ASK_KEY = 'pb.checkinAsk';
const ASK_LATER_DAYS = 21;

function askMark(): { done?: boolean; until?: number } {
  try {
    return JSON.parse(localStorage.getItem(ASK_KEY) || '{}');
  } catch {
    return { done: true };
  }
}

function remember(mark: { done?: boolean; until?: number }) {
  try {
    localStorage.setItem(ASK_KEY, JSON.stringify(mark));
  } catch {
    // storage blocked: it may ask again, and that is all
  }
}

/**
 * «Можно написать вам, если вы пропадёте на пару дней?» — the only way the founder's message can reach someone who is
 * not opening the site is a push, so it is asked for while the reader is here and reading (the council, 2026-10-15).
 * Only on a counted day, only where a push can arrive, and only for readers without one: whoever said yes to the
 * daily reminder already has it, and whoever has not been offered the reminder yet gets that offer first.
 */
export function CheckinAsk({ todayMinutes }: { todayMinutes: number }) {
  const { t } = useI18n();
  const [state, setState] = useState<'hidden' | 'ask' | 'busy' | 'done'>('hidden');

  useEffect(() => {
    if (todayMinutes < SCORE_MINUTES || pushSupport() !== 'ok' || pushPermission() === 'denied') return;
    const mark = askMark();
    if (mark.done || (mark.until && Date.now() < mark.until)) return;
    // the daily reminder's offer comes first (ReminderOffer); this one is for whoever has passed on it
    try {
      if (!localStorage.getItem('pb.remindOffer')) return;
    } catch {
      return;
    }
    let live = true;
    hasSubscription().then((subscribed) => {
      if (!live) return;
      if (subscribed) remember({ done: true });
      else setState('ask');
    });
    return () => {
      live = false;
    };
  }, [todayMinutes]);

  if (state === 'hidden') return null;
  if (state === 'done') return <p className={styles.missedLine}>{t('checkin.askDone')}</p>;
  return (
    <div className={styles.welcome}>
      <b>{t('checkin.askTitle')}</b>
      <p>{t('checkin.askText')}</p>
      <div className={styles.checkinAsk}>
        <button
          type="button"
          className={styles.checkinYes}
          disabled={state === 'busy'}
          onClick={async () => {
            setState('busy');
            const result = await enablePush();
            track('checkin_consent', { result });
            remember({ done: true });
            setState(result === 'granted' ? 'done' : 'hidden');
          }}
        >
          {t('checkin.askYes')}
        </button>
        <button
          type="button"
          onClick={() => {
            remember({ until: Date.now() + ASK_LATER_DAYS * 86_400_000 });
            track('checkin_consent', { result: 'later' });
            setState('hidden');
          }}
        >
          {t('checkin.askLater')}
        </button>
      </div>
    </div>
  );
}
