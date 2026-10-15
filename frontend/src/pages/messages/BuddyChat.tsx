import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, track, useI18n } from '@/shared/lib';
import { Avatar } from '@/shared/ui';
import { Conversation, saidRead, when, type Message } from './parts';
import styles from './MessagesPage.module.css';

type Person = {
  user_id: string;
  name: string;
  username: string;
  avatar_data: string | null;
};
type Chat = {
  other: Person;
  consented: boolean;
  /** someone who is not in my buddies wrote first: who and how many, until I accept */
  request: boolean;
  waiting: number;
  /** my words wait in their request */
  pending: boolean;
  messages: { id: string; text: string; created_at: string; mine: boolean }[];
  can_write: boolean;
  why_not: string | null;
  i_blocked: boolean;
};
export type ChatEntry = Person & {
  last_text: string;
  last_at: string;
  last_mine: boolean;
  unread: number;
  request: boolean;
};

/**
 * The one yes before any message between readers (2026-10-15, after the legal check): 16 or older, and
 * agreement to how the messages are kept. Both ticks, then «Продолжить»; the server keeps the moment.
 */
function ConsentGate({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [age, setAge] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className={styles.consent}>
      <h1 className={styles.title}>{t('chat.consentTitle')}</h1>
      <p className={styles.muted}>{t('chat.consentText')}</p>
      <label className={styles.tick}>
        <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} />
        <span>{t('chat.age16')}</span>
      </label>
      <label className={styles.tick}>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          {t('chat.agree')} ·{' '}
          <Link to="/privacy" target="_blank">
            {t('chat.policy')}
          </Link>
        </span>
      </label>
      <button
        type="button"
        className={styles.send}
        disabled={!age || !agree || busy}
        onClick={async () => {
          setBusy(true);
          const { error } = await apiPost('/messages/chat/consent', { age_16: age, agree }, { requireAuth: true });
          setBusy(false);
          if (!error) {
            track('chat_consent');
            onDone();
          }
        }}
      >
        {t('chat.continue')}
      </button>
    </div>
  );
}

/** A conversation with another reader: like the founder's, with «Заблокировать» and «Пожаловаться». */
export function BuddyChat({ otherId }: { otherId: string }) {
  const { t } = useI18n();
  const [chat, setChat] = useState<Chat | null>(null);
  const [gate, setGate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [reported, setReported] = useState(false);

  const load = useCallback(() => {
    apiGet<Chat>(`/messages/chat/${otherId}`, { requireAuth: true }).then(({ data }) => {
      if (data) setChat(data);
      saidRead();
    });
  }, [otherId]);
  useEffect(() => {
    load();
  }, [load]);

  if (!chat) return <div className={styles.muted}>{t('dashboard.loading')}</div>;
  const accept = async () => {
    const { data } = await apiPost<Chat>(`/messages/chat/${otherId}/accept`, {}, { requireAuth: true });
    if (data) {
      setChat(data);
      track('chat_accept');
    }
  };
  // the yes comes first; after it, a request the reader opened by «Принять» is accepted at once
  if (gate || (!chat.consented && !chat.request)) {
    return (
      <ConsentGate
        onDone={async () => {
          setGate(false);
          if (chat.request) await accept();
          else load();
        }}
      />
    );
  }

  const messages: Message[] = chat.messages.map((m) => ({
    ...m,
    author: m.mine ? t('msg.you') : chat.other.name,
    avatar_data: m.mine ? null : chat.other.avatar_data,
  }));
  const block = async (on: boolean) => {
    setMenu(false);
    if (on && !window.confirm(t('chat.blockConfirm'))) return;
    const { data } = await apiPost<Chat>(`/messages/chat/${otherId}/block`, { on }, { requireAuth: true });
    if (data) setChat(data);
    track(on ? 'chat_block' : 'chat_unblock');
  };
  const closed =
    chat.why_not === 'you_blocked' ? (
      <>
        {t('chat.whyYouBlocked')}{' '}
        <button type="button" className={styles.link} onClick={() => block(false)}>
          {t('chat.unblock')}
        </button>
      </>
    ) : chat.why_not === 'blocked' ? (
      t('chat.whyBlocked')
    ) : chat.why_not === 'not_buddy' ? (
      t('chat.whyNotBuddy')
    ) : chat.why_not === 'waiting' ? (
      t('chat.whyWaiting', { name: chat.other.name })
    ) : null;

  return (
    <>
      <Link to="/messages" className={styles.back}>
        ← {t('msg.title')}
      </Link>
      <div className={styles.head}>
        <Avatar src={chat.other.avatar_data ?? undefined} name={chat.other.name} size="md" />
        <div className={styles.headText}>
          <h1 className={styles.title}>
            <Link to={`/readers/${chat.other.user_id}`} className={styles.plain}>
              {chat.other.name}
            </Link>
          </h1>
          <p className={styles.sub}>@{chat.other.username}</p>
        </div>
        <button type="button" className={styles.menuBtn} aria-label="…" onClick={() => setMenu((v) => !v)}>
          ⋯
        </button>
      </div>
      {menu && (
        <div className={styles.menu}>
          <button type="button" onClick={() => block(!chat.i_blocked)}>
            {chat.i_blocked ? t('chat.unblock') : t('chat.block')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              setReporting(true);
            }}
          >
            {t('chat.report')}
          </button>
        </div>
      )}
      {reporting && (
        <div className={styles.report}>
          {reported ? (
            <>
              <p className={styles.muted}>{t('chat.reportDone', { name: chat.other.name })}</p>
              {!chat.i_blocked && (
                <button type="button" className={styles.link} onClick={() => block(true)}>
                  {t('chat.block')}
                </button>
              )}
            </>
          ) : (
            <>
              <textarea
                value={reason}
                maxLength={1000}
                rows={3}
                placeholder={t('chat.reportPlaceholder')}
                onChange={(e) => setReason(e.target.value)}
              />
              <p className={styles.muted}>{t('chat.reportNote')}</p>
              <div className={styles.row}>
                <button type="button" className={styles.link} onClick={() => setReporting(false)}>
                  {t('chat.cancel')}
                </button>
                <button
                  type="button"
                  className={styles.send}
                  disabled={!reason.trim()}
                  onClick={async () => {
                    const { error: err } = await apiPost(
                      `/messages/chat/${otherId}/report`,
                      { reason },
                      { requireAuth: true },
                    );
                    if (!err) {
                      setReported(true);
                      track('chat_report');
                    }
                  }}
                >
                  {t('chat.reportSend')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {error && <p className={styles.error}>{error}</p>}
      {chat.pending && !chat.request && chat.messages.length > 0 && (
        <p className={styles.muted}>{t('chat.pendingNote', { name: chat.other.name })}</p>
      )}
      {chat.request ? (
        <div className={styles.request}>
          <b>{t('chat.requestTitle', { name: chat.other.name })}</b>
          <p className={styles.muted}>{t('chat.requestNote', { n: chat.waiting })}</p>
          <div className={styles.row}>
            <button type="button" className={styles.link} onClick={() => block(true)}>
              {t('chat.block')}
            </button>
            <button type="button" className={styles.send} onClick={() => (chat.consented ? accept() : setGate(true))}>
              {t('chat.accept')}
            </button>
          </div>
        </div>
      ) : (
        <Conversation
          messages={messages}
          closed={closed}
          onSend={async (text) => {
            setError(null);
            const { data, error: err } = await apiPost<Chat>(
              `/messages/chat/${otherId}`,
              { text },
              { requireAuth: true },
            );
            if (data) {
              setChat(data);
              track('chat_send');
            } else if (err) {
              setError(err.includes('too_many') ? t('chat.tooMany') : err);
            }
            return !!data;
          }}
        />
      )}
    </>
  );
}

/** Every conversation: the founder's first when there is one, then the readers', latest first. */
export function ChatList({
  founder,
}: {
  founder?: {
    name: string;
    avatar_data: string | null;
    last_text: string;
    last_at: string;
  } | null;
}) {
  const { t, locale } = useI18n();
  const [chats, setChats] = useState<ChatEntry[] | null>(null);
  useEffect(() => {
    apiGet<ChatEntry[]>('/messages/chat', { requireAuth: true }).then(({ data }) => setChats(data ?? []));
  }, []);
  if (chats === null) return null;
  if (!founder && chats.length === 0) return <p className={styles.muted}>{t('chat.empty')}</p>;
  return (
    <div>
      {founder && (
        <Link to="/messages?with=founder" className={styles.thread}>
          <Avatar src={founder.avatar_data ?? undefined} name={founder.name} size="sm" />
          <div className={styles.threadBody}>
            <b>{founder.name}</b> <small className={styles.tag}>{t('msg.founderSub')}</small>
            <p>{founder.last_text}</p>
          </div>
          <small className={styles.time}>{when(founder.last_at, locale)}</small>
        </Link>
      )}
      {chats.map((c) => (
        <Link
          key={c.user_id}
          to={`/messages?u=${c.user_id}`}
          className={`${styles.thread} ${c.unread ? styles.unread : ''}`}
        >
          <Avatar src={c.avatar_data ?? undefined} name={c.name} size="sm" />
          <div className={styles.threadBody}>
            <b>{c.name}</b>
            <p>
              {c.request
                ? t('chat.wantsToChat')
                : c.last_text
                  ? `${c.last_mine ? `${t('msg.you')}: ` : ''}${c.last_text}`
                  : t('chat.newMessage')}
            </p>
          </div>
          {c.unread > 0 ? (
            <span className={styles.badge}>{c.unread}</span>
          ) : (
            <small className={styles.time}>{when(c.last_at, locale)}</small>
          )}
        </Link>
      ))}
    </div>
  );
}
