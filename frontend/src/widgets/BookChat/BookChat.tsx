import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiDelete, apiGet, apiPost, track, useI18n, type BookChatMessage, type BookChatState } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import { Sheet } from '@/pages/books/bookUi';
import styles from './BookChat.module.css';

type Props = {
  /** The reader's own copy (shelf key, or "u:<upload id>" from the reader)… */
  volumeKey?: string;
  /** …or a book of the shared library. */
  workKey?: string;
  title?: string;
  /** Where it was opened from, for the analytics. */
  from: 'book' | 'shelf' | 'reader';
  onClose: () => void;
};

const STARTERS = ['chat.s1', 'chat.s2', 'chat.s3', 'chat.s4'];

const ERRORS: Record<string, string> = {
  ai_daily_limit: 'chat.limit',
  ai_unavailable: 'chat.unavailable',
  ai_refused: 'chat.refused',
  message_too_long: 'chat.tooLong',
};

/**
 * «Обсудить с AI»: a conversation about one book. The AI knows the book and
 * what the reader has of it here (mark, review, notes, how far they are),
 * and keeps off spoilers past that point unless asked. The talk is kept, so
 * it picks up where it stopped from the shelf, the book's page or the reader.
 */
export function BookChat({ volumeKey, workKey, title, from, onClose }: Props) {
  const { t, locale } = useI18n();
  const [chat, setChat] = useState<BookChatState | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const query = volumeKey ? `volume_key=${encodeURIComponent(volumeKey)}` : `work_key=${encodeURIComponent(workKey ?? '')}`;

  const load = useCallback(async () => {
    const { data } = await apiGet<BookChatState>(`/books/chat?${query}`, { requireAuth: true });
    if (data) setChat(data);
    else setFailed(true);
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [chat?.messages.length, sending]);

  const send = async (message: string) => {
    const body = message.trim();
    if (!body || sending || !chat) return;
    setSending(true);
    setError(null);
    setText('');
    // Shown at once; the server's copy replaces it.
    const mine: BookChatMessage = { role: 'user', content: body, at: new Date().toISOString() };
    setChat({ ...chat, messages: [...chat.messages, mine] });
    const { data, error: failure } = await apiPost<{ messages: BookChatMessage[]; left_today: number }>(
      '/books/chat',
      { volume_key: volumeKey ?? null, work_key: volumeKey ? null : workKey ?? null, text: body, lang: locale },
      { requireAuth: true }
    );
    setSending(false);
    if (!data) {
      setChat((c) => (c ? { ...c, messages: c.messages.filter((m) => m !== mine) } : c));
      setText(body);
      setError(t(ERRORS[failure ?? ''] ?? 'chat.error'));
      return;
    }
    track('ai_chat_send', { from });
    setChat((c) => (c ? { ...c, messages: [...c.messages.filter((m) => m !== mine), ...data.messages], left_today: data.left_today } : c));
  };

  const restart = async () => {
    if (!window.confirm(t('chat.restartConfirm'))) return;
    await apiDelete(`/books/chat?${query}`, { requireAuth: true });
    await load();
  };

  const name = chat?.title ?? title ?? '';

  // Over everything, wherever it is opened from (another sheet, the reader).
  return createPortal(
    <Sheet label={t('chat.title', { title: name })} onClose={onClose}>
      <div className={styles.chat}>
        {failed && <p className={styles.note}>{t('chat.loadError')}</p>}
        {!chat && !failed && <p className={styles.note}>{t('chat.loading')}</p>}
        {chat && !chat.available && (
          <div className={styles.soon}>
            <Icon name="sparkle" size="em" aria-hidden="true" />
            <p>{t('chat.soon')}</p>
          </div>
        )}

        {chat && chat.available && (
          <>
            {chat.messages.length === 0 && (
              <div className={styles.intro}>
                <Icon name="sparkle" size="em" aria-hidden="true" className={styles.introIcon} />
                <p>{t('chat.intro', { title: name })}</p>
                <div className={styles.starters}>
                  {STARTERS.map((key) => (
                    <button key={key} type="button" onClick={() => send(t(key))} disabled={sending || chat.left_today <= 0}>
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <ul className={styles.messages} aria-live="polite">
              {chat.messages.map((m, i) => (
                <li key={`${m.at}-${i}`} className={m.role === 'user' ? styles.mine : styles.theirs}>
                  {m.content}
                </li>
              ))}
              {sending && (
                <li className={`${styles.theirs} ${styles.typing}`} aria-label={t('chat.typing')}>
                  <i />
                  <i />
                  <i />
                </li>
              )}
            </ul>
            <div ref={end} />

            {error && <p className={styles.error}>{error}</p>}

            <form
              className={styles.compose}
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void send(text);
              }}
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(text);
                  }
                }}
                placeholder={t('chat.placeholder')}
                maxLength={1000}
                rows={2}
                disabled={chat.left_today <= 0}
              />
              <button type="submit" disabled={sending || !text.trim() || chat.left_today <= 0} aria-label={t('chat.send')}>
                <Icon name="arrow-right" size="em" aria-hidden="true" />
              </button>
            </form>
            <div className={styles.foot}>
              <span>{chat.left_today > 0 ? t('chat.left', { n: chat.left_today }) : t('chat.limit')}</span>
              {chat.messages.length > 0 && (
                <button type="button" onClick={restart}>
                  {t('chat.restart')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Sheet>,
    document.body
  );
}
