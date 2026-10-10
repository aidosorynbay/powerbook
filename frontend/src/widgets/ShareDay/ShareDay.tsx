import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiGet, apiPost, track, useI18n, type MyDayCard, type ShareChannel } from '@/shared/lib';
import { dayDate, dayKind, dayLink, dayShareText, daysAgo, localToday } from './shareText';
import { StoryShare } from './StoryShare';
import styles from './ShareDay.module.css';

type Tab = 'story' | 'text';

function lastTab(): Tab {
  try {
    return localStorage.getItem('pb.share.tab') === 'text' ? 'text' : 'story';
  } catch {
    return 'story';
  }
}

/**
 * «Поделиться днём»: runners post every run from Strava; this is the same
 * daily reason to post, for reading. Two ways out: a story sticker to lay over
 * one's own photo (StoryShare), or one message for any chat with the day's
 * minutes, the run of days and the round in squares.
 *
 * The link leads to the reader's day page, and sending the day is what opens
 * that page to people without an account. Whoever signs up from it is counted
 * as the reader's guest.
 *
 * Any day of the round can go out, not only today: yesterday's long read, or
 * the day a book was finished, is picked from the row of days at the top. A
 * sheet opened on a day with no minutes moves to the latest day that has them.
 */
export function ShareDay({ day: opened, roundId, onClose }: { day: string; roundId?: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const today = useMemo(localToday, []);
  const [tab, setTab] = useState<Tab>(lastTab);
  const [day, setDay] = useState(opened);
  const [card, setCard] = useState<MyDayCard | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pickedRef = useRef<HTMLButtonElement>(null);
  // Every day loaded stays at hand, so going back to one shows it at once.
  const cards = useRef(new Map<string, MyDayCard>());
  const shown = useRef<MyDayCard | null>(null);
  shown.current = card;
  // Only the day the sheet opened on moves by itself, and only once.
  const settled = useRef(false);
  // The round of the first card: the other days are asked for inside it.
  const round = roundId ?? card?.round_id;
  // The page around re-renders (the round page ticks every second on its last day): the sheet
  // keeps the latest onClose without re-running its opening, which would pull focus from the text.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const kept = cards.current.get(day);
    if (kept) {
      setCard(kept);
      return;
    }
    let live = true;
    const q = new URLSearchParams({ day });
    if (round) q.set('round_id', round);
    apiGet<MyDayCard>(`/share/day?${q}`, { requireAuth: true }).then(({ data }) => {
      if (!live) return;
      if (!data) {
        // A day that would not load: the one on screen stays picked.
        if (shown.current) setDay(shown.current.day);
        else setFailed(true);
        return;
      }
      // The server keeps the day inside the round; the sheet follows the day it got.
      cards.current.set(day, data).set(data.day, data);
      if (!settled.current) {
        settled.current = true;
        // Nothing read today, but yesterday was a long day: that is the day to send.
        const latest = data.minutes > 0 ? null : [...data.days].reverse().find((d) => d.minutes > 0 && d.date <= today);
        if (latest) {
          setDay(latest.date);
          return;
        }
      }
      setCard(data);
      if (data.day !== day) setDay(data.day);
    });
    return () => {
      live = false;
    };
  }, [day, round, today]);

  useEffect(() => {
    if (card) setText(dayShareText(card, dayLink(card.username), t, locale));
  }, [card, t, locale]);

  // The picked day in view, when it is further along the row.
  useEffect(() => {
    pickedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [card?.day]);

  useEffect(() => {
    track('day_share_open');
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const link = card ? dayLink(card.username) : '';
  const url = card ? `${window.location.protocol}//${link}` : '';
  const native = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  /** Counted, and the day page opened, once the day has gone out. Nothing waits on it. */
  const sent = (channel: ShareChannel, detail: Record<string, string> = {}) => {
    if (!card) return;
    track('day_share', { method: channel, minutes: card.minutes, streak: card.streak, days_ago: daysAgo(card.day, today), ...detail });
    // A sticker's template, action and ink go to our own count too (/admin → «Стикеры»).
    apiPost('/share/day', { round_id: card.round_id, day: card.day, channel, ...detail }, { requireAuth: true, keepalive: true });
  };

  const choose = (next: Tab) => {
    setTab(next);
    try {
      localStorage.setItem('pb.share.tab', next);
    } catch {
      /* private mode */
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const field = document.createElement('textarea');
      field.value = text;
      document.body.appendChild(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }
    sent('copy');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  };

  const more = async () => {
    try {
      await navigator.share({ text });
      sent('native');
    } catch {
      /* dismissed */
    }
  };

  // Telegram puts the link on a line of its own, above the text: the text goes without it.
  const telegramText = link ? text.replace(link, '').trimEnd() : text;
  // The days there is something to send, the latest first.
  const choices = card ? card.days.filter((d) => d.minutes > 0 && d.date <= today).reverse() : [];
  const finished = new Set(card?.finished_days ?? []);
  const loading = !!card && card.day !== day;
  const dayName = (iso: string) => {
    const ago = daysAgo(iso, today);
    return ago === 0 ? t('shareDay.today') : ago === 1 ? t('shareDay.yesterday') : dayDate(iso, locale);
  };
  const dialog = (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label={t('shareDay.title')}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label={t('story.close')}>
          ×
        </button>
        <div className={styles.title}>{t('shareDay.title')}</div>
        {choices.some((d) => d.date !== today) && (
          <div className={styles.days} role="group" aria-label={t('shareDay.whichDay')}>
            {choices.map((d) => {
              const on = d.date === day;
              const done = finished.has(d.date);
              return (
                <button
                  key={d.date}
                  ref={on ? pickedRef : undefined}
                  type="button"
                  className={styles.day}
                  aria-pressed={on}
                  onClick={() => setDay(d.date)}
                  title={done ? t('shareDay.finished') : undefined}
                >
                  <span className={styles.dayName}>{dayName(d.date)}</span>
                  <span className={styles.dayMinutes}>
                    <i className={styles[dayKind(d.minutes)]} aria-hidden="true" />
                    {t('shareDay.dayMinutes', { n: d.minutes })}
                  </span>
                  {done && <span className={styles.dayDone}>{t('shareDay.finished')}</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className={styles.tabs} role="tablist" aria-label={t('shareDay.title')}>
          {(['story', 'text'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              className={styles.tab}
              onClick={() => choose(k)}
            >
              {t(k === 'story' ? 'shareDay.tabStory' : 'shareDay.tabText')}
            </button>
          ))}
        </div>
        {tab === 'text' && <p className={styles.lead}>{t('shareDay.lead')}</p>}

        {!card ? (
          <p className={styles.wait}>{failed ? t('shareDay.failed') : t('shareDay.loading')}</p>
        ) : tab === 'story' ? (
          <div className={loading ? styles.loading : undefined} aria-busy={loading}>
            <StoryShare card={card} link={link} onSent={sent} />
          </div>
        ) : (
          <div className={loading ? styles.loading : undefined} aria-busy={loading}>
            <textarea
              className={styles.text}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={Math.min(9, text.split('\n').length + 1)}
              aria-label={t('shareDay.title')}
              spellCheck={false}
            />
            <div className={styles.channels}>
              <a
                className={`${styles.channel} ${styles.whatsapp}`}
                href={`https://wa.me/?text=${encodeURIComponent(text)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => sent('whatsapp')}
              >
                WhatsApp
              </a>
              <a
                className={`${styles.channel} ${styles.telegram}`}
                href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(telegramText)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => sent('telegram')}
              >
                Telegram
              </a>
              <a
                className={`${styles.channel} ${styles.x}`}
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => sent('x')}
              >
                X
              </a>
              <button type="button" className={styles.channel} onClick={copy}>
                {copied ? t('shareDay.copied') : t('shareDay.copy')}
              </button>
              {native && (
                <button type="button" className={styles.channel} onClick={more}>
                  {t('shareDay.more')}
                </button>
              )}
            </div>
            <p className={styles.hint}>{t('shareDay.privacy')}</p>
          </div>
        )}
        {card && card.invited > 0 && <a className={styles.invited} href="/insights#invite">{t('shareDay.invited', { n: card.invited })} →</a>}
      </div>
    </div>
  );
  // In the reading room's full screen only what is inside it shows.
  return createPortal(dialog, document.fullscreenElement ?? document.body);
}
