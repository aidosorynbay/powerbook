import { useEffect, useRef, useState } from 'react';
import { useI18n, type Locale } from '@/shared/lib';
import { Avatar } from '@/shared/ui';
import { READ_EVENT } from '@/widgets/Notifications/MessagesLink';
import styles from './MessagesPage.module.css';

export const MAX_CHARS = 2000;

export type Message = { id: string; text: string; created_at: string; mine: boolean; author: string; avatar_data: string | null };

/** The header's count is read again once the page has read the conversation. */
export const saidRead = () => window.dispatchEvent(new Event(READ_EVENT));

const INTL: Record<Locale, string> = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' };

export function when(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(INTL[locale], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** The conversation itself: oldest first, like a chat, with a box to write in. */
export function Conversation({
  messages,
  onSend,
  closed,
}: {
  messages: Message[];
  onSend: (text: string) => Promise<boolean>;
  /** Why there is no box to write in, when there is none. */
  closed?: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const send = async () => {
    const words = text.trim();
    if (!words || sending) return;
    setSending(true);
    const ok = await onSend(words);
    setSending(false);
    if (ok) setText('');
  };
  return (
    <>
      <div className={styles.list}>
        {messages.map((m) => (
          <div key={m.id} className={`${styles.message} ${m.mine ? styles.mine : ''}`}>
            {!m.mine && <Avatar src={m.avatar_data ?? undefined} name={m.author} size="sm" />}
            <div className={styles.bubble}>
              <p>{m.text}</p>
              <small>{m.mine ? t('msg.you') : m.author} · {when(m.created_at, locale)}</small>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {closed ? (
        <p className={styles.closed}>{closed}</p>
      ) : (
        <div className={styles.form}>
          <textarea
            value={text}
            maxLength={MAX_CHARS}
            rows={3}
            placeholder={t('msg.placeholder')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button type="button" className={styles.send} disabled={sending || !text.trim()} onClick={send}>
            {t('msg.send')}
          </button>
        </div>
      )}
    </>
  );
}

