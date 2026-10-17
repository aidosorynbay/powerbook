import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, track, useI18n, type ReviewReply } from '@/shared/lib';
import { Avatar, Icon } from '@/shared/ui';
import { formatDay, useCount } from './bookUi';
import styles from './Store.module.css';

const MAX_CHARS = 1000;

type Props = {
  reviewId: string;
  count: number;
  /** Open from the start: the bell led here, to this review. */
  startOpen?: boolean;
};

/**
 * The little conversation under a review: flat, oldest first, like a chat.
 * Closed it is one line («Ответить» or «3 ответа»); open, the answers and a
 * box to write in.
 */
export function ReviewThread({ reviewId, count: initialCount, startOpen = false }: Props) {
  const { t, locale } = useI18n();
  const plural = useCount();
  const [open, setOpen] = useState(startOpen);
  const [count, setCount] = useState(initialCount);
  const [replies, setReplies] = useState<ReviewReply[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setCount(initialCount), [initialCount]);

  const load = useCallback(async () => {
    const { data } = await apiGet<ReviewReply[]>(`/books/reviews/${reviewId}/replies`, { requireAuth: true });
    if (data) {
      setReplies(data);
      setCount(data.length);
    }
  }, [reviewId]);

  useEffect(() => {
    if (open && replies === null) void load();
  }, [open, replies, load]);

  // The box grows with what is written, up to a few lines.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text, open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      track('review_thread_open', { replies: count });
      // Opened by hand: ready to write at once.
      window.setTimeout(() => box.current?.focus(), 0);
    }
  };

  const send = async () => {
    const words = text.trim();
    if (!words || sending) return;
    setSending(true);
    setFailed(false);
    const { data } = await apiPost<ReviewReply>(`/books/reviews/${reviewId}/replies`, { text: words }, { requireAuth: true });
    setSending(false);
    if (!data) {
      setFailed(true);
      return;
    }
    setReplies((prev) => [...(prev ?? []), data]);
    setCount((n) => n + 1);
    setText('');
    track('review_reply', {});
  };

  const remove = async (id: string) => {
    const { error } = await apiDelete(`/books/replies/${id}`, { requireAuth: true });
    if (error) return;
    setReplies((prev) => (prev ?? []).filter((r) => r.id !== id));
    setCount((n) => Math.max(0, n - 1));
  };

  return (
    <div className={styles.thread}>
      <button type="button" className={styles.threadToggle} onClick={toggle} aria-expanded={open}>
        <Icon name="chat" size="em" aria-hidden="true" />
        {open ? t('thread.hide') : count > 0 ? plural('replies', count) : t('thread.reply')}
      </button>
      {open && (
        <div className={styles.threadBody}>
          {replies === null && <p className={styles.formNote}>{t('cat.loading')}</p>}
          {replies && replies.length === 0 && <p className={styles.formNote}>{t('thread.empty')}</p>}
          {replies && replies.length > 0 && (
            <ul className={styles.replyList}>
              {replies.map((r) => (
                <li key={r.id} className={styles.reply}>
                  <Avatar src={r.avatar_data} name={r.display_name} size="sm" userId={r.user_id} />
                  <div>
                    <div className={styles.replyHead}>
                      <Link to={`/readers/${r.user_id}`}>{r.is_viewer ? `${r.display_name} (${t('work.you')})` : r.display_name}</Link>
                      <time>{formatDay(r.created_at, locale)}</time>
                      {r.can_delete && (
                        <button type="button" className={styles.replyDelete} onClick={() => remove(r.id)} aria-label={t('thread.delete')} title={t('thread.delete')}>
                          ×
                        </button>
                      )}
                    </div>
                    <p>{r.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form
            className={styles.replyForm}
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              ref={box}
              rows={1}
              value={text}
              maxLength={MAX_CHARS}
              placeholder={t('thread.placeholder')}
              aria-label={t('thread.placeholder')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // On a computer Enter sends and Shift+Enter starts a new line, as in any chat.
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button type="submit" className={styles.primary} disabled={sending || !text.trim()}>
              {t('thread.send')}
            </button>
          </form>
          {failed && <p className={styles.formError}>{t('thread.error')}</p>}
        </div>
      )}
    </div>
  );
}
