import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, track, useI18n } from '@/shared/lib';
import { Button } from '@/shared/ui';
import styles from './RoundToday.module.css';

type Mine = { rank: number; total_score: number; total_minutes: number } | null;

/**
 * The first days of a month, for a reader who was in last month's circle and has not signed up for this one yet:
 * their last circle in one line and the new one in one tap — not the stranger's «Вы не участвуете в этом круге»
 * (2026-10-15: the return that matters is the October reader in November). Anyone else sees `children`.
 */
export function NewCircleCard({ enabled, month, untilDay, joining, onJoin, children }: {
  enabled: boolean;
  month: number;
  untilDay: number;
  joining: boolean;
  onJoin: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [last, setLast] = useState<{ month: number; mine: Mine } | null | undefined>(enabled ? undefined : null);

  useEffect(() => {
    if (!enabled) {
      setLast(null);
      return;
    }
    let alive = true;
    (async () => {
      const { data: round } = await apiGet<{ id: string; year: number; month: number } | null>('/rounds/last-completed', { requireAuth: true });
      if (!round || round.month === month) {
        if (alive) setLast(null);
        return;
      }
      const { data: res } = await apiGet<{ my_result: Mine }>(`/rounds/${round.id}/results`, { requireAuth: true });
      if (!alive) return;
      setLast(res?.my_result ? { month: round.month, mine: res.my_result } : null);
      if (res?.my_result) track('new_circle_card', { action: 'shown' });
    })();
    return () => {
      alive = false;
    };
  }, [enabled, month]);

  if (last === undefined) return null; // a moment, while we learn whether they were in last month's circle
  if (!last?.mine) return <>{children}</>;

  const m = last.mine.total_minutes;
  const time = m >= 60 ? (m % 60 ? t('ms.hm', { h: Math.floor(m / 60), m: m % 60 }) : t('ms.h', { h: Math.floor(m / 60) })) : t('ms.m', { m });
  return (
    <section className={styles.newCircle} aria-labelledby="new-circle-title">
      <p className={styles.newCirclePast}>
        {t('nc.past', { month: t(`month.${last.month}`) })} · {t('nc.days', { n: last.mine.total_score })} · {time}
      </p>
      <h2 id="new-circle-title" className={styles.newCircleTitle}>{t(`roundTitle.${month}`)}</h2>
      <p className={styles.newCircleLead}>{t('nc.lead', { day: untilDay })}</p>
      <Button
        fullWidth
        onClick={() => {
          track('new_circle_card', { action: 'join' });
          onJoin();
        }}
        disabled={joining}
      >
        {joining ? t('dashboard.joining') : t('nc.join')}
      </Button>
      <Link to="/results" className={styles.newCircleResults}>
        {t('dashboard.seeResults', { month: t(`month.${last.month}`) })}
      </Link>
    </section>
  );
}
