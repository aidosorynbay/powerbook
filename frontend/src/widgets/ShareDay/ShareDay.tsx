import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiGet, apiPost, track, useI18n, type MyDayCard, type ShareChannel } from '@/shared/lib';
import { dayLink, dayShareText } from './shareText';
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
 */
export function ShareDay({ day, roundId, onClose }: { day: string; roundId?: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>(lastTab);
  const [card, setCard] = useState<MyDayCard | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The page around re-renders (the round page ticks every second on its last day): the sheet
  // keeps the latest onClose without re-running its opening, which would pull focus from the text.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ day });
    if (roundId) q.set('round_id', roundId);
    apiGet<MyDayCard>(`/share/day?${q}`, { requireAuth: true }).then(({ data }) => {
      if (!live) return;
      if (!data) {
        setFailed(true);
        return;
      }
      setCard(data);
      setText(dayShareText(data, dayLink(data.username), t, locale));
    });
    return () => {
      live = false;
    };
  }, [day, roundId, t, locale]);

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
    track('day_share', { method: channel, minutes: card.minutes, streak: card.streak, ...detail });
    apiPost('/share/day', { round_id: card.round_id, day: card.day, channel }, { requireAuth: true });
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
  const dialog = (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label={t('shareDay.title')}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label={t('story.close')}>
          ×
        </button>
        <div className={styles.title}>{t('shareDay.title')}</div>
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
          <StoryShare card={card} link={link} onSent={sent} />
        ) : (
          <>
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
          </>
        )}
        {card && card.invited > 0 && <p className={styles.invited}>{t('shareDay.invited', { n: card.invited })}</p>}
      </div>
    </div>
  );
  // In the reading room's full screen only what is inside it shows.
  return createPortal(dialog, document.fullscreenElement ?? document.body);
}
