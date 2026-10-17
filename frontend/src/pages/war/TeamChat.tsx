/** «Чат команды» on /war: one shared room per team, seen and written only by its members.
 * Text only. Posting asks once for the same consent as the buddy chat (16+, how messages are kept);
 * reading does not. The bot adds the team's numbers (never names) at midnight and in the evening.
 * Every message can be reported; the author and the admins can delete it. Read-only after the war. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, track, useI18n } from '@/shared/lib';
import type { LeagueTierKey } from '@/shared/lib/types';
import { Sheet } from '@/widgets/RoundToday';
import { Avatar } from './WarPage';
import styles from './WarPage.module.css';

type Msg = {
  id: string;
  kind: 'user' | 'bot';
  user_id: string | null;
  display_name: string | null;
  avatar: string | null;
  league?: LeagueTierKey | null;
  text: string;
  code?: 'start' | 'day' | 'evening' | null;
  params?: Record<string, number | boolean>;
  at: string;
  mine: boolean;
};
export type TeamChatState = {
  team: 'lighthouse' | 'sail';
  size: number;
  consented: boolean;
  open: boolean;
  can_delete_any: boolean;
  messages: Msg[];
};

const MAX = 500;
const time = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dayKey = (iso: string) => new Date(iso).toDateString();

function Face({ m }: { m: Msg }) {
  return (
    <Link to={`/readers/${m.user_id}`} className={styles.faceLink}>
      <Avatar p={{ user_id: m.user_id ?? '', display_name: m.display_name ?? '', avatar: m.avatar, league: m.league }} />
    </Link>
  );
}

export function TeamChat() {
  const { t } = useI18n();
  const [chat, setChat] = useState<TeamChatState | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [age, setAge] = useState(false);
  const [agree, setAgree] = useState(false);
  const [menu, setMenu] = useState<Msg | null>(null);
  const [report, setReport] = useState('');
  const [reported, setReported] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    apiGet<TeamChatState>('/war/chat', { requireAuth: true }).then(({ data }) => data && setChat(data));
  }, []);
  useEffect(() => {
    load();
    const id = window.setInterval(() => document.visibilityState === 'visible' && load(), 20000);
    return () => window.clearInterval(id);
  }, [load]);
  const last = chat?.messages[chat.messages.length - 1]?.id;
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [last]);

  if (!chat) return null;

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    const { data } = await apiPost<TeamChatState>('/war/chat', { text: body }, { requireAuth: true });
    if (data) {
      setChat(data);
      setText('');
    }
    track('war_chat_send', { len: body.length });
    setBusy(false);
  };
  const consent = async () => {
    setBusy(true);
    const { data } = await apiPost<TeamChatState>('/war/chat/consent', { age_16: age, agree }, { requireAuth: true });
    if (data) setChat(data);
    track('war_chat_consent');
    setBusy(false);
  };
  const remove = async (m: Msg) => {
    const { data } = await apiPost<TeamChatState>(`/war/chat/${m.id}/delete`, {}, { requireAuth: true });
    if (data) setChat(data);
    setMenu(null);
  };
  const sendReport = async (m: Msg) => {
    await apiPost(`/war/chat/${m.id}/report`, { reason: report.trim() }, { requireAuth: true });
    track('war_chat_report');
    setReported(true);
  };
  const closeMenu = () => {
    setMenu(null);
    setReport('');
    setReported(false);
  };

  const team = t(`war.team.${chat.team}`);
  const other = chat.team === 'lighthouse' ? 'sail' : 'lighthouse';
  // the bot's lines come as numbers and are worded here, in the reader's language
  const bot = (m: Msg) => {
    const p = { ...(m.params ?? {}), team: t(`war.teamGen.${chat.team}`), other: t(`war.teamGen.${other}`) } as Record<string, string | number>;
    if (m.code === 'day') {
      const n = Number(p.n);
      return t('war.bot.day', p) + (m.params?.last ? ` ${t('war.bot.lastDay')}` : ` ${t('war.bot.next', { n: n + 1, total: p.total })}`);
    }
    return m.code ? t(`war.bot.${m.code}`, p) : m.text;
  };
  return (
    <section className={`${styles.chat} ${chat.team === 'lighthouse' ? styles.sideA : styles.sideB}`}>
      <div className={styles.chatHead}>
        <b>{t('war.chatTitle', { team })}</b>
        <small>{t('war.chatWho', { n: chat.size })}</small>
      </div>
      <div className={styles.chatList} ref={list}>
        {chat.messages.length === 0 && <p className={styles.chatEmpty}>{t('war.chatEmpty')}</p>}
        {chat.messages.map((m, i) => {
          const prev = chat.messages[i - 1];
          const newDay = !prev || dayKey(prev.at) !== dayKey(m.at);
          const same = !newDay && prev && prev.kind === 'user' && m.kind === 'user' && prev.user_id === m.user_id;
          return (
            <div key={m.id}>
              {newDay && <div className={styles.chatDay}>{`${new Date(m.at).getDate()} ${t(`month.gen.${new Date(m.at).getMonth() + 1}`)}`}</div>}
              {m.kind === 'bot' ? (
                <div className={styles.chatBot}>{bot(m)}</div>
              ) : (
                <div className={`${styles.msg} ${same ? styles.msgCont : ''}`}>
                  {same ? <span className={styles.avGap} /> : <Face m={m} />}
                  <div className={styles.msgBody}>
                    {!same && (
                      <div className={styles.msgMeta}>
                        <Link to={`/readers/${m.user_id}`} className={m.mine ? styles.msgMe : undefined}>{m.display_name}</Link>
                        <time>{time(m.at)}</time>
                      </div>
                    )}
                    <p>{m.text}</p>
                  </div>
                  <button type="button" className={styles.msgMore} aria-label={t('war.chatActions')} onClick={() => setMenu(m)}>⋯</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!chat.open ? (
        <p className={styles.chatNote}>{t('war.chatClosed')}</p>
      ) : !chat.consented ? (
        <div className={styles.chatConsent}>
          <p>{t('war.chatConsent', { team })}</p>
          <label><input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} /><span>{t('chat.age16')}</span></label>
          <label>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>{t('chat.agree')} · <Link to="/privacy" target="_blank">{t('chat.policy')}</Link></span>
          </label>
          <button type="button" className={styles.go} onClick={consent} disabled={busy || !age || !agree}>{t('war.chatStart')}</button>
        </div>
      ) : (
        <form className={styles.compose} onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea
            rows={1}
            maxLength={MAX}
            value={text}
            placeholder={t('war.chatPlaceholder', { team })}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button type="submit" className={styles.sendBtn} disabled={busy || !text.trim()} aria-label={t('war.chatSend')}>↑</button>
        </form>
      )}

      <Sheet open={!!menu} onClose={closeMenu} label={t('war.chatActions')}>
        {menu && (
          <div className={styles.msgSheet}>
            <blockquote>{menu.text}</blockquote>
            {reported ? (
              <p className={styles.note}>{t('chat.reportDone', { name: menu.display_name ?? '' })}</p>
            ) : (
              <>
                {!menu.mine && (
                  <>
                    <textarea value={report} onChange={(e) => setReport(e.target.value)} placeholder={t('chat.reportPlaceholder')} rows={2} />
                    <button type="button" className={styles.close} onClick={() => sendReport(menu)}>{t('chat.report')}</button>
                  </>
                )}
                {(menu.mine || chat.can_delete_any) && (
                  <button type="button" className={styles.close} onClick={() => remove(menu)}>{t('war.chatDelete')}</button>
                )}
              </>
            )}
            <button type="button" className={styles.close} onClick={closeMenu}>{t('lg.done')}</button>
          </div>
        )}
      </Sheet>
    </section>
  );
}
