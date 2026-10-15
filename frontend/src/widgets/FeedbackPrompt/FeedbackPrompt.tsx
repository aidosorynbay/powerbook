import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { apiPost, resizeImageToDataUrl, track, useI18n } from '@/shared/lib';
import { Button, Icon } from '@/shared/ui';
import { Sheet } from '@/widgets/RoundToday';
import rt from '@/widgets/RoundToday/RoundToday.module.css';
import styles from './FeedbackPrompt.module.css';

type Mood = 'love' | 'ok' | 'improve';
export type FeedbackSource = 'after_save' | 'link';

const MOODS: Mood[] = ['love', 'ok', 'improve'];
const SNOOZE_KEY = 'pb.feedback.until';
const DAY = 86_400_000;
/** «Позже», or the window closed without an answer: a month of quiet. */
const LATER_DAYS = 30;
/** After an answer: two months before asking again. */
const SENT_DAYS = 60;
/** Days read in the circle before the window may come up at all. */
const MIN_DAYS_READ = 3;
// The server takes photos up to 1.5 MB; a data URL is a third longer than the bytes.
const MAX_CHARS = 1_990_000;

/** Whether the window may come up after a save: a reader with a few days behind them, at most once a month. */
export function feedbackDue(daysRead: number): boolean {
  if (daysRead < MIN_DAYS_READ) return false;
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) || 0) <= Date.now();
  } catch {
    // storage blocked: a «Позже» could not be kept, so never ask at all
    return false;
  }
}

function snooze(days: number) {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + days * DAY));
  } catch {
    /* blocked: feedbackDue says no to such a reader anyway */
  }
}

/** A phone picture large enough for a post or a story (2048 px), and small enough for the server. */
async function shrink(file: File): Promise<string> {
  for (const [side, quality] of [[2048, 0.85], [1600, 0.8], [1200, 0.75]] as const) {
    const data = await resizeImageToDataUrl(file, side, quality);
    if (data.length <= MAX_CHARS) return data;
  }
  throw new Error('photo_too_large');
}

/**
 * «Как вам PowerBook?»: after a saved day, at most once a month, or from the
 * founder's link /round?feedback=1. A mood in one tap, a few words if they
 * like, and a photo of how they read: the brand book wants real readers, and
 * a photo may be shown only with the reader's own tick. The answer goes to
 * /admin and to the founder in Telegram.
 */
export function FeedbackPrompt({ source, roundId, onClose }: { source: FeedbackSource; roundId?: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [mood, setMood] = useState<Mood | null>(null);
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<'photo' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const dirty = !!(mood || text.trim() || photo);

  useEffect(() => {
    track('feedback_shown', { source });
    // once per window
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const later = () => {
    snooze(LATER_DAYS);
    track('feedback_later', { source, started: dirty });
    onClose();
  };

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('photo');
    setError(null);
    try {
      setPhoto(await shrink(file));
    } catch (err) {
      setError(t(err instanceof Error && err.message === 'photo_too_large' ? 'feedback.photoTooLarge' : 'feedback.photoError'));
    }
    setBusy(null);
  };

  const send = async () => {
    setBusy('send');
    setError(null);
    const words = text.trim();
    const { error: failed } = await apiPost(
      '/feedback',
      { mood, text: words || null, photo, photo_consent: !!photo && consent, round_id: roundId ?? null, source, locale },
      { requireAuth: true },
    );
    setBusy(null);
    if (failed) {
      setError(t(failed === 'photo_too_large' ? 'feedback.photoTooLarge' : 'feedback.sendError'));
      return;
    }
    snooze(SENT_DAYS);
    track('feedback_sent', { source, mood: mood ?? 'none', has_text: !!words, has_photo: !!photo, consent: !!photo && consent });
    setSent(true);
  };

  // A tap beside the sheet must not throw away what the reader has begun: then only «Позже» or «Отправить» close it.
  const close = sent ? onClose : dirty ? () => {} : later;

  return (
    <Sheet open onClose={close} label={t('feedback.title')}>
      {sent ? (
        <div className={styles.thanks}>
          <span className={styles.thanksIcon} aria-hidden="true">
            <Icon name="check" size="em" />
          </span>
          <h3 className={rt.sheetTitle}>{t('feedback.thanksTitle')}</h3>
          <p className={rt.sheetLead}>{t(photo && consent ? 'feedback.thanksPhoto' : 'feedback.thanksText')}</p>
          <button type="button" className={`${rt.sheetClose} ${rt.closeBtn}`} onClick={onClose}>
            {t('today.close')}
          </button>
        </div>
      ) : (
        <>
          <h3 className={rt.sheetTitle}>{t('feedback.title')}</h3>
          <p className={rt.sheetLead}>{t('feedback.lead')}</p>
          <div className={styles.moods} role="radiogroup" aria-label={t('feedback.title')}>
            {MOODS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mood === m}
                className={`${styles.mood} ${mood === m ? styles.moodOn : ''}`}
                onClick={() => setMood(mood === m ? null : m)}
              >
                {t(`feedback.mood.${m}`)}
              </button>
            ))}
          </div>
          <textarea
            className={styles.text}
            rows={3}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t(mood ? `feedback.ask.${mood}` : 'feedback.ask.none')}
            aria-label={t(mood ? `feedback.ask.${mood}` : 'feedback.ask.none')}
          />
          {photo ? (
            <div className={styles.photo}>
              <img src={photo} alt="" className={styles.thumb} />
              <div>
                <div className={styles.photoActions}>
                  <button type="button" onClick={() => input.current?.click()} disabled={!!busy}>
                    {busy === 'photo' ? t('feedback.photoLoading') : t('feedback.photoReplace')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPhoto(null);
                      setConsent(false);
                    }}
                    disabled={!!busy}
                  >
                    {t('feedback.photoRemove')}
                  </button>
                </div>
                <label className={styles.consent}>
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>{t('feedback.consent')}</span>
                </label>
              </div>
            </div>
          ) : (
            <button type="button" className={styles.addPhoto} onClick={() => input.current?.click()} disabled={!!busy}>
              <span className={styles.addIcon} aria-hidden="true">
                <Icon name="camera" size="em" />
              </span>
              <span>
                <b>{busy === 'photo' ? t('feedback.photoLoading') : t('feedback.photoAsk')}</b>
                <small>{t('feedback.photoHint')}</small>
              </span>
            </button>
          )}
          {/* No "capture": the reader chooses between the camera and a photo already taken. */}
          <input ref={input} type="file" accept="image/*" hidden onChange={pick} />
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <Button fullWidth className={styles.send} onClick={send} disabled={!dirty || !!busy}>
            {busy === 'send' ? t('feedback.sending') : t('feedback.send')}
          </Button>
          <button type="button" className={styles.later} onClick={later}>
            {t('feedback.later')}
          </button>
        </>
      )}
    </Sheet>
  );
}
