import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiGet, apiPost, track, useI18n, type MyDayCard, type ShareChannel } from '@/shared/lib';
import { dayDate, dayLink, dayShareText, daysAgo, localToday } from './shareText';
import { StoryShare } from './StoryShare';
import styles from './ShareDay.module.css';

/**
 * «Поделиться днём»: runners post every run from Strava; this is the same
 * daily reason to post, for reading: the day's picture over the reading room,
 * to the phone's own share sheet (StoryShare). Under «Другие способы»: the
 * sticker alone, for one's own photo, and one message for any chat with the
 * day's minutes, the run of days and the round in squares.
 *
 * The link leads to the reader's day page, and sending the day is what opens
 * that page to people without an account. Whoever signs up from it is counted
 * as the reader's guest.
 *
 * Any day of the round can go out, not only today: yesterday's long read, or
 * the day a book was finished, from that day's form in the calendar. A sheet
 * opened on a day with no minutes moves to the latest day that has them.
 *
 * One picture and one button, as on Strava; the sticker without a background
 * and the message for a chat wait under «Другие способы» (2026-10-15: of 17
 * readers who opened the old sheet of tabs, day chips and three buttons, 4 sent).
 */
export function ShareDay({ day: opened, roundId, onClose }: { day: string; roundId?: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const today = useMemo(localToday, []);
  const [day, setDay] = useState(opened);
  const [card, setCard] = useState<MyDayCard | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
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

  /** Counted, and the day page opened, once the day has gone out. Nothing waits on it. */
  const sent = (channel: ShareChannel, detail: Record<string, string> = {}) => {
    if (!card) return;
    track('day_share', { method: channel, minutes: card.minutes, streak: card.streak, days_ago: daysAgo(card.day, today), ...detail });
    // A sticker's template, action and ink go to our own count too (/admin → «Стикеры»).
    apiPost('/share/day', { round_id: card.round_id, day: card.day, channel, ...detail }, { requireAuth: true, keepalive: true });
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

  // Telegram puts the link on a line of its own, above the text: the text goes without it.
  const telegramText = link ? text.replace(link, '').trimEnd() : text;
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
        {/* The day goes out as it came: today from the dial, any other day from its own form in the calendar. */}
        {card && (
          <div className={styles.which}>
            {dayName(card.day)} · {t('shareDay.dayMinutes', { n: card.minutes })}
            {finished.has(card.day) && <> · <span className={styles.dayDone}>{t('shareDay.finished')}</span></>}
          </div>
        )}

        {!card ? (
          <p className={styles.wait}>{failed ? t('shareDay.failed') : t('shareDay.loading')}</p>
        ) : (
          <div className={loading ? styles.loading : undefined} aria-busy={loading}>
            <StoryShare card={card} link={link} onSent={sent}>
              <p className={styles.moreLabel}>{t('shareDay.lead')}</p>
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
                <button type="button" className={styles.channel} onClick={copy}>
                  {copied ? t('shareDay.copied') : t('shareDay.copy')}
                </button>
              </div>
              <p className={styles.hint}>{t('shareDay.privacy')}</p>
            </StoryShare>
          </div>
        )}
        {card && card.invited > 0 && <a className={styles.invited} href="/insights#invite">{t('shareDay.invited', { n: card.invited })} →</a>}
      </div>
    </div>
  );
  // In the reading room's full screen only what is inside it shows.
  return createPortal(dialog, document.fullscreenElement ?? document.body);
}
