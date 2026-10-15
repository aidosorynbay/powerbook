import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiGet, apiPost, track, useAuth, useI18n, type Locale } from '@/shared/lib';
import { Avatar, Container, PageTransition } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import { READ_EVENT } from '@/widgets/Notifications/MessagesLink';

/** The header's count is read again once the page has read the conversation. */
const saidRead = () => window.dispatchEvent(new Event(READ_EVENT));
import styles from './MessagesPage.module.css';

const MAX_CHARS = 2000;

type Message = { id: string; text: string; created_at: string; mine: boolean; from_reader: boolean; author: string; avatar_data: string | null };
type MyThread = { messages: Message[]; founder: string; founder_avatar: string | null };
type Thread = { reader_id: string; name: string; username: string; avatar_data: string | null; last_text: string; last_at: string; last_from_reader: boolean; unread: number };
type ReaderThread = { reader_id: string; name: string; username: string; avatar_data: string | null; messages: Message[]; context: string | null };
type Planned = { id: string; day: string; status: string; text: string; reader_id: string; name: string; when: string; answer: string | null };
type Today = { today: string; auto: boolean; items: Planned[]; stats: { sent: number; answered: number; returned: number } };

const INTL: Record<Locale, string> = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' };

function when(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(INTL[locale], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** The conversation itself: oldest first, like a chat, with a box to write in. */
function Conversation({ messages, onSend }: { messages: Message[]; onSend: (text: string) => Promise<boolean> }) {
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
    </>
  );
}

/** A reader: their conversation with the founder. */
function ReaderView() {
  const { t } = useI18n();
  const [thread, setThread] = useState<MyThread | null>(null);
  useEffect(() => {
    apiGet<MyThread>('/messages', { requireAuth: true }).then(({ data }) => {
      if (data) setThread(data);
      saidRead();
    });
  }, []);
  if (!thread) return <div className={styles.muted}>{t('dashboard.loading')}</div>;
  return (
    <>
      <div className={styles.head}>
        <Avatar src={thread.founder_avatar ?? undefined} name={thread.founder} size="md" />
        <div>
          <h1 className={styles.title}>{thread.founder}</h1>
          <p className={styles.sub}>{t('msg.with')}</p>
        </div>
      </div>
      {thread.messages.length === 0 && <p className={styles.muted}>{t('msg.empty', { name: thread.founder })}</p>}
      <Conversation
        messages={thread.messages}
        onSend={async (text) => {
          const { data } = await apiPost<MyThread>('/messages', { text }, { requireAuth: true });
          if (data) {
            setThread(data);
            track('checkin_write');
          }
          return !!data;
        }}
      />
    </>
  );
}

/** The founder: who is quiet today, every conversation, and one open. */
function FounderView({ readerId }: { readerId: string | null }) {
  const { t } = useI18n();
  const [today, setToday] = useState<Today | null>(null);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [open, setOpen] = useState<ReaderThread | null>(null);

  const loadLists = useCallback(() => {
    apiGet<Today>('/messages/checkins', { requireAuth: true }).then(({ data }) => data && setToday(data));
    apiGet<Thread[]>('/messages/threads', { requireAuth: true }).then(({ data }) => data && setThreads(data));
  }, []);
  useEffect(() => {
    if (readerId) {
      setOpen(null);
      apiGet<ReaderThread>(`/messages/threads/${readerId}`, { requireAuth: true }).then(({ data }) => {
        if (data) setOpen(data);
        saidRead();
      });
    } else {
      loadLists();
    }
  }, [readerId, loadLists]);

  if (readerId) {
    if (!open) return <div className={styles.muted}>{t('dashboard.loading')}</div>;
    return (
      <>
        <Link to="/messages" className={styles.back}>← {t('msg.admin.back')}</Link>
        <div className={styles.head}>
          <Avatar src={open.avatar_data ?? undefined} name={open.name} size="md" />
          <div>
            <h1 className={styles.title}>{open.name} <small>@{open.username}</small></h1>
            {open.context && <p className={styles.sub}>{open.context}</p>}
          </div>
        </div>
        <Conversation
          messages={open.messages}
          onSend={async (text) => {
            const { data } = await apiPost<ReaderThread>(`/messages/threads/${readerId}`, { text }, { requireAuth: true });
            if (data) setOpen(data);
            return !!data;
          }}
        />
      </>
    );
  }

  const waiting = today?.items.filter((i) => i.status === 'planned' && i.day === today.today) ?? [];
  return (
    <>
      <h1 className={styles.title}>{t('msg.title')}</h1>
      {today && (
        <section className={styles.section}>
          <h2>{t('msg.admin.today')}</h2>
          <p className={styles.muted}>{today.auto ? t('msg.admin.auto') : t('msg.admin.tap')}</p>
          {today.items.length === 0 && <p className={styles.muted}>{t('msg.admin.none')}</p>}
          {today.items.map((i) => (
            <div key={i.id} className={styles.planned}>
              <div>
                <Link to={`/messages?r=${i.reader_id}`}><b>{i.name}</b></Link> — {i.when}
                <p>«{i.text}»</p>
              </div>
              <span className={styles.status}>
                {t(`msg.admin.status.${i.status}`)}
                {i.answer && i.answer !== 'text' ? ` · ${t(`checkin.${i.answer}`)}` : ''}
              </span>
              {i.status === 'planned' && (
                <button
                  type="button"
                  className={styles.link}
                  onClick={async () => {
                    await apiPost(`/messages/checkins/${i.id}/skip`, {}, { requireAuth: true });
                    loadLists();
                  }}
                >
                  {t('msg.admin.skip')}
                </button>
              )}
            </div>
          ))}
          {waiting.length > 0 && (
            <button
              type="button"
              className={styles.send}
              onClick={async () => {
                await apiPost(`/messages/checkins/approve/${today.today}`, {}, { requireAuth: true });
                loadLists();
              }}
            >
              ✅ {t('msg.admin.approve', { n: waiting.length })}
            </button>
          )}
          <p className={styles.stats}>{t('msg.admin.stats', today.stats)}</p>
        </section>
      )}
      <section className={styles.section}>
        <h2>{t('msg.admin.threads')}</h2>
        {threads && threads.length === 0 && <p className={styles.muted}>{t('msg.admin.noThreads')}</p>}
        {threads?.map((th) => (
          <Link key={th.reader_id} to={`/messages?r=${th.reader_id}`} className={`${styles.thread} ${th.unread ? styles.unread : ''}`}>
            <Avatar src={th.avatar_data ?? undefined} name={th.name} size="sm" />
            <div className={styles.threadBody}>
              <b>{th.name}</b>
              <p>{th.last_from_reader ? '' : `${t('msg.you')}: `}{th.last_text}</p>
            </div>
            {th.unread > 0 && <span className={styles.badge}>{th.unread}</span>}
          </Link>
        ))}
      </section>
    </>
  );
}

/**
 * «Сообщения»: a reader's conversation with the founder, opened by «Хей, как вы?» after three quiet days
 * (app/services/checkins.py). The founder sees the morning's list here too, and answers everyone from here.
 */
export function MessagesPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const isAdmin = user?.system_role === 'admin' || user?.system_role === 'superadmin';
  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container size="sm">{isAdmin ? <FounderView readerId={params.get('r')} /> : <ReaderView />}</Container>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
}
