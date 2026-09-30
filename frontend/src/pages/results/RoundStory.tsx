import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { toBlob } from 'html-to-image';
import { apiGet, inviteLink, useAuth, useI18n, useWaitlist, type MyResult, type RoundLetter, type RoundReview } from '@/shared/lib';
import { dayOf } from '@/widgets/JoinPrompt/words';
import { useDigest } from '../reading/digest';
import { insightText } from './RoundReview';
import styles from './RoundStory.module.css';

/** The story is drawn at 360×640 and saved at ×3: 1080×1920, what Instagram and Telegram stories take. */
const W = 360;
const H = 640;
const seenKey = (roundId: string) => `pb.story.seen.${roundId}`;

function storage(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** "октябрь" inside a Russian phrase; Kazakh and English keep their capital. */
function useMonthWord() {
  const { t, locale } = useI18n();
  return (m: number) => (locale === 'ru' ? t(`month.${m}`).toLowerCase() : t(`month.${m}`));
}

function useNumber() {
  const { locale } = useI18n();
  return (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, locale === 'en' ? ',' : ' ');
}

type Stats = {
  minutes: number;
  goalDays: number;
  days: number | null;
  streak: number | null;
  books: number | null;
  rank: number;
  participants: number;
  /** Minutes against the reader's previous round; null on a first round. */
  delta: number | null;
  prevMonth: number | null;
};

function statsOf(result: MyResult, participants: number, review: RoundReview | null): Stats {
  const cur = review?.round;
  const prev = review?.previous ?? null;
  return {
    minutes: cur?.minutes ?? result.total_minutes,
    goalDays: cur?.goal_days ?? result.total_score,
    days: cur?.days ?? null,
    streak: cur?.longest_streak ?? null,
    books: cur?.books ?? null,
    rank: result.rank,
    participants: cur?.participants ?? participants,
    delta: prev && cur ? cur.minutes - prev.minutes : null,
    prevMonth: prev?.month ?? null,
  };
}

type CardProps = { stats: Stats; month: number; year: number; nextMonth: number; nextLine: string; who: string | null; goal: string | null };

/** The picture itself: the reading room at night, the reader's month, and the way in. */
const StoryCard = forwardRef<HTMLDivElement, CardProps>(function StoryCard({ stats, month, year, nextMonth, nextLine, who, goal }, ref) {
  const { t } = useI18n();
  const num = useNumber();
  const monthWord = useMonthWord();
  const hours = Math.round(stats.minutes / 60);
  const better = stats.delta !== null && stats.delta > 0;
  return (
    <div ref={ref} className={styles.card} style={{ width: W, height: H }}>
      <img className={styles.photo} src="/reading-room/m-night-m.jpg" alt="" />
      <div className={styles.shade} />

      <div className={styles.top}>
        <span className={styles.brand}>
          <i className={styles.dot} />
          PowerBook
        </span>
        <span className={styles.tag}>{t('story.tag', { month: t(`month.${month}`), year })}</span>
      </div>

      <div className={styles.kicker}>
        <span>{t('story.kicker1', { month: t(`month.${month}`) })}</span>
        <em>{t('story.kicker2')}</em>
      </div>

      <div className={styles.panel}>
        <div className={styles.hero}>
          <strong>{num(stats.minutes)}</strong>
          <span>
            {t('story.minutes')}
            {hours >= 2 && <> · ≈ {t('story.hours', { n: hours })}</>}
          </span>
        </div>

        <div className={styles.grid}>
          <div>
            <b>
              {stats.goalDays}
              {stats.days !== null && <small>/{stats.days}</small>}
            </b>
            <span>{t('story.goalDays')}</span>
          </div>
          {stats.streak !== null ? (
            <div>
              <b>{stats.streak}</b>
              <span>{t('story.streak')}</span>
            </div>
          ) : null}
          <div>
            <b>
              #{stats.rank}
              {stats.participants > 0 && <small> / {stats.participants}</small>}
            </b>
            <span>{t('story.place')}</span>
          </div>
        </div>

        <div className={styles.growth}>
          <span>
            {better
              ? t('story.better', { n: num(stats.delta ?? 0) })
              : stats.delta === null
                ? t('story.first')
                : t('story.kept')}
          </span>
          {goal && (
            <span className={styles.goal}>
              <small>{t('story.goalLabel', { month: monthWord(nextMonth) })}</small>
              {goal}
            </span>
          )}
        </div>

        <div className={styles.invite}>
          <div className={styles.inviteHead}>{t('story.join', { month: t(`month.${nextMonth}`) })}</div>
          <div className={styles.inviteText}>{t('story.what')}</div>
          <div className={styles.inviteRow}>
            <span className={styles.url}>powerbook.kz</span>
            <span className={styles.when}>{nextLine}</span>
          </div>
          {who && <div className={styles.who}>{t('story.who', { name: who })}</div>}
        </div>
      </div>
    </div>
  );
});

type Props = {
  roundId: string;
  year: number;
  month: number;
  result: MyResult;
  participants: number;
  /** Opened from the page's button; the first visit after a round opens it by itself. */
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
};

/** "Круг пройден": the reader's own story picture after a round, to share and to call a friend in. */
export function RoundStory({ roundId, year, month, result, participants, open, onOpen, onClose }: Props) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { state } = useWaitlist();
  const num = useNumber();
  const monthWord = useMonthWord();
  const [review, setReview] = useState<RoundReview | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [scale, setScale] = useState(0.8);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    apiGet<RoundReview>(`/reading/round-review?round_id=${roundId}`, { requireAuth: true }).then(({ data }) => {
      if (live && data) setReview(data);
    });
    return () => {
      live = false;
    };
  }, [roundId]);

  // The first visit after the round: open by itself, once.
  useEffect(() => {
    if (storage(seenKey(roundId))) return;
    const id = window.setTimeout(() => {
      storage(seenKey(roundId), '1');
      onOpen();
    }, 900);
    return () => window.clearTimeout(id);
  }, [roundId, onOpen]);

  useEffect(() => {
    if (!open) return;
    const fit = () => {
      const byHeight = (window.innerHeight - 330) / H;
      const byWidth = (Math.min(window.innerWidth, 440) - 48) / W;
      setScale(Math.max(0.42, Math.min(1, byHeight, byWidth)));
    };
    fit();
    window.addEventListener('resize', fit);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('keydown', esc);
    };
  }, [open, onClose]);

  const { digest } = useDigest('round', roundId);
  const letter = digest?.status === 'done' ? (digest.content as RoundLetter | null) : null;

  const stats = statsOf(result, participants, review);
  const tip = review?.tips[0] ?? null;
  const goal = tip ? t(`review.tip.${tip}.t`) : null;
  const nextMonth = state?.open_round?.month ?? state?.month ?? (month % 12) + 1;
  const nextLine = state?.open_round
    ? t('story.until', { date: dayOf(state.open_round.registration_until.slice(0, 10), locale, t) })
    : state?.starts_on
      ? t('story.starts', { date: dayOf(state.starts_on.slice(0, 10), locale, t) })
      : t('story.signup');
  const refName = state?.ref ?? null;
  const who = refName ? `@${refName}` : user?.display_name ?? null;
  const link = inviteLink(refName);
  const fileName = `powerbook-${year}-${String(month).padStart(2, '0')}.png`;

  const render = useCallback(async (): Promise<File | null> => {
    if (!cardRef.current) return null;
    // Safari paints images only on the second pass.
    await toBlob(cardRef.current, { pixelRatio: 1, cacheBust: false }).catch(() => null);
    const blob = await toBlob(cardRef.current, { pixelRatio: 3, width: W, height: H });
    return blob ? new File([blob], fileName, { type: 'image/png' }) : null;
  }, [fileName]);

  // Draw the file in advance, so the share button keeps the tap (iOS needs it for navigator.share).
  useEffect(() => {
    if (!open) {
      setFile(null);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(async () => {
      try {
        const f = await render();
        if (!cancelled) setFile(f);
      } catch {
        /* the buttons draw it on demand */
      }
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [open, render, review, state?.ref, nextLine, goal]);

  const text = t('story.shareText', { month: t(`month.${nextMonth}`) });

  const download = async () => {
    setBusy(true);
    const f = file ?? (await render());
    setBusy(false);
    if (!f) return;
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const share = async () => {
    const f = file ?? (await render());
    if (f && navigator.canShare?.({ files: [f] })) {
      try {
        await navigator.share({ files: [f], text: `${text} ${link}` });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    await download();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const field = document.createElement('textarea');
      field.value = link;
      document.body.appendChild(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  };

  const toReview = () => {
    onClose();
    window.setTimeout(() => document.getElementById('round-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  if (!open) return null;

  const lead =
    stats.delta !== null && stats.delta > 0
      ? t('story.leadBetter', { n: num(stats.delta) })
      : stats.days && stats.goalDays >= stats.days * 0.8
        ? t('story.leadStrong')
        : t('story.leadDone');

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label={t('story.title')}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.close} onClick={onClose} aria-label={t('story.close')}>
          ×
        </button>
        <div className={styles.title}>{t('story.title', { month: t(`month.${month}`) })}</div>
        <p className={styles.lead}>{lead}</p>

        <div className={styles.stage} style={{ width: W * scale, height: H * scale }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <StoryCard ref={cardRef} stats={stats} month={month} year={year} nextMonth={nextMonth} nextLine={nextLine} who={who} goal={goal} />
          </div>
        </div>

        <p className={styles.ask}>{t('story.ask')}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={share} disabled={busy}>
            {t('story.share')}
          </button>
          <button type="button" className={styles.secondary} onClick={download} disabled={busy}>
            {t('story.download')}
          </button>
        </div>
        <button type="button" className={styles.link} onClick={copy}>
          {copied ? t('wl.copied') : t('story.copyLink')}
        </button>
        <p className={styles.hint}>{t('story.hint')}</p>

        {review && (
          <div className={styles.review}>
            <div className={styles.reviewHead}>
              <strong>{t('review.title')}</strong>
              <button type="button" onClick={toReview}>
                {t('story.more')}
              </button>
            </div>
            <div className={styles.strip}>
              {letter?.headline && (
                <article className={styles.ai}>
                  <small>✦ {t('review.aiTitle')}</small>
                  <p>
                    <b>{letter.headline}</b> {letter.next_goal}
                  </p>
                </article>
              )}
              {!letter && review.ai_available && (
                <button type="button" className={styles.ai} onClick={toReview}>
                  <small>✦ {t('review.aiTitle')}</small>
                  <p>{t('review.aiIntro')}</p>
                </button>
              )}
              {review.strengths[0] && (
                <article className={styles.good}>
                  <small>✓ {t('review.good')}</small>
                  <p>{insightText(review.strengths[0], 's', t)}</p>
                </article>
              )}
              {review.improve[0] && (
                <article className={styles.bad}>
                  <small>! {t('review.bad')}</small>
                  <p>{insightText(review.improve[0], 'i', t)}</p>
                </article>
              )}
              {tip && (
                <article className={styles.tip}>
                  <small>💡 {t('story.goalLabel', { month: monthWord(nextMonth) })}</small>
                  <p>
                    <b>{goal}.</b> {t(`review.tip.${tip}.d`)}
                  </p>
                </article>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
