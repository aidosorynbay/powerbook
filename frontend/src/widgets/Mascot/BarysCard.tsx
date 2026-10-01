import { useEffect, useMemo, useState } from 'react';
import { track, useAuth, useI18n } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import { Barys, type BarysMood, type BarysStage } from './Barys';
import styles from './BarysCard.module.css';

const GOAL = 30;

/** All-time minutes in, a bigger cub out: a scarf at 50 hours, glasses at 250. */
export function barysStage(totalMinutes: number | null | undefined): BarysStage {
  const m = totalMinutes ?? 0;
  if (m >= 15000) return 3;
  if (m >= 3000) return 2;
  return 1;
}

/** How Барыс feels about today: fed by 30 minutes, asleep at night, sad after a missed day. */
export function barysMood({ today, brokeYesterday, now = new Date() }: { today: number; brokeYesterday: boolean; now?: Date }): BarysMood {
  if (today >= GOAL) return 'happy';
  const hour = now.getHours();
  if (hour >= 23 || hour < 6) return 'sleep';
  if (brokeYesterday) return 'sad';
  return 'hungry';
}

const dayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: he forgets, nothing else breaks */
  }
}

const TAPS = ['barys.tap1', 'barys.tap2', 'barys.tap3', 'barys.tap4'];

/**
 * Барыс on the round page, beside «Сегодня»: fed by today's minutes, with a
 * line for how he is and a bar for how full. Tap him and he hops. The reader
 * may give him another name (kept on this device).
 */
export function BarysCard({ todayMinutes, streak, totalMinutes, brokeYesterday }: {
  todayMinutes: number;
  streak: number;
  totalMinutes: number | null;
  brokeYesterday: boolean;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const nameKey = `pb.barys.name.${user?.id ?? 'guest'}`;
  const [name, setName] = useState(() => readStore(nameKey) || t('barys.name'));
  const [hop, setHop] = useState(false);
  const [reaction, setReaction] = useState<string | null>(null);
  const stage = barysStage(totalMinutes);
  const baseMood = barysMood({ today: todayMinutes, brokeYesterday });

  // The first time today's 30 minutes are in, he celebrates for a moment.
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (todayMinutes < GOAL) return;
    const fedKey = `pb.barys.fed.${user?.id ?? 'guest'}`;
    if (readStore(fedKey) === dayKey()) return;
    writeStore(fedKey, dayKey());
    setCelebrating(true);
    const id = window.setTimeout(() => setCelebrating(false), 6000);
    return () => window.clearTimeout(id);
  }, [todayMinutes, user?.id]);

  const mood: BarysMood = celebrating ? 'celebrate' : baseMood;
  const left = Math.max(0, GOAL - todayMinutes);
  const fed = Math.min(1, todayMinutes / GOAL);

  const line = useMemo(() => {
    if (reaction) return t(reaction, { name });
    if (mood === 'celebrate') return t('barys.celebrate', { name });
    if (mood === 'happy') return streak > 1 ? t('barys.happyStreak', { name, n: streak }) : t('barys.happy', { name });
    if (mood === 'sleep') return t('barys.sleep', { name });
    if (mood === 'sad') return t('barys.sad', { name });
    return todayMinutes > 0 ? t('barys.hungrySome', { name, n: left }) : t('barys.hungry', { name });
  }, [reaction, mood, streak, todayMinutes, left, name, t]);

  const tap = () => {
    setHop(true);
    window.setTimeout(() => setHop(false), 600);
    const next = TAPS[Math.floor(Math.random() * TAPS.length)];
    setReaction(next);
    window.setTimeout(() => setReaction((r) => (r === next ? null : r)), 3200);
    track('mascot_tap', { mood });
  };

  const rename = () => {
    const next = window.prompt(t('barys.rename'), name)?.trim();
    if (!next) return;
    const clean = next.slice(0, 24);
    setName(clean);
    writeStore(nameKey, clean);
  };

  return (
    <div className={styles.card}>
      <button type="button" className={styles.figure} onClick={tap} aria-label={t('barys.tapLabel', { name })}>
        <Barys mood={mood} stage={stage} size={96} hop={hop} />
      </button>
      <div className={styles.text}>
        <div className={styles.head}>
          <strong>{name}</strong>
          <span className={styles.stage}>{t(`barys.stage${stage}`)}</span>
          <button type="button" className={styles.rename} onClick={rename} aria-label={t('barys.rename')} title={t('barys.rename')}>
            <Icon name="pen" size="em" aria-hidden="true" />
          </button>
        </div>
        <p className={styles.line} aria-live="polite">{line}</p>
        <div className={styles.fed} aria-label={t('barys.fed', { pct: Math.round(fed * 100) })}>
          <span className={styles.fedTrack}>
            <span style={{ width: `${fed * 100}%` }} />
          </span>
          <small>{t('barys.fed', { pct: Math.round(fed * 100) })}</small>
        </div>
      </div>
    </div>
  );
}

/** For a visitor on the front page: who Барыс is. */
export function BarysIntro() {
  const { t } = useI18n();
  const [mood, setMood] = useState<BarysMood>('hungry');
  // He wakes up hungry, gets his half hour, and is pleased with himself.
  useEffect(() => {
    const seq: BarysMood[] = ['hungry', 'reading', 'happy'];
    let i = 0;
    const id = window.setInterval(() => {
      i = (i + 1) % seq.length;
      setMood(seq[i]);
    }, 3200);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className={styles.intro}>
      <Barys mood={mood} size={64} />
      <p>{t('barys.meet')}</p>
    </div>
  );
}
