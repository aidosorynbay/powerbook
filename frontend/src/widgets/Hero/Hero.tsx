import { useState, useEffect, useMemo } from 'react';
import { useI18n, apiGet, useAuth, type PublicStats } from '@/shared/lib';
import { Button, Badge, ProgressBar, Container, Icon } from '@/shared/ui';
import styles from './Hero.module.css';

interface HeroProps {
  onJoinClick?: () => void;
  onLearnMoreClick?: () => void;
}

const RULE_KEYS = [
  'hero.rule1',
  'hero.rule2',
  'hero.rule3',
  'hero.rule4',
  'hero.rule5',
] as const;

export function Hero({ onJoinClick, onLearnMoreClick }: HeroProps) {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  useEffect(() => {
    async function fetchStats() {
      const { data } = await apiGet<PublicStats>('/stats/public');
      if (data) setStats(data);
    }
    fetchStats();
  }, []);

  const isMiniRound = Boolean(stats?.round_is_partial);
  // Registration stays open until the round's last day, so it can't
  // gate the progress bar — key off whether the round has begun.
  const roundStarted =
    stats?.round_start_day != null && new Date().getDate() >= stats.round_start_day;

  const roundLengthDays = useMemo(() => {
    if (!stats?.round_start_day || !stats.round_end_day) return 0;
    return stats.round_end_day - stats.round_start_day + 1;
  }, [stats]);

  // Word order differs per language ("Мини-круг августа" vs "Тамыз
  // мини-раунды"), so the title is a template with a {month} slot rather
  // than pieces glued together here.
  const roundTitle = useMemo(() => {
    if (!stats?.round_month) return t('stats.currentRound');
    const month = t(`month.gen.${stats.round_month}`);
    if (!isMiniRound) return t(`month.${stats.round_month}`);
    return t('hero.miniRoundTitle').replace('{month}', month);
  }, [stats, t, isMiniRound]);

  // "15 – 30 августа · 16 дней" — genitive month, matching Russian grammar.
  const roundWindow = useMemo(() => {
    if (!isMiniRound || !stats?.round_month) return null;
    const month = t(`month.gen.${stats.round_month}`);
    return `${stats.round_start_day} – ${stats.round_end_day} ${month} · ${roundLengthDays} ${t('hero.roundDays')}`;
  }, [stats, t, isMiniRound, roundLengthDays]);

  return (
    <section className={styles.hero}>
      <Container>
        <div className={styles.content}>
          <div className={styles.textContent}>
            <h1 className={styles.title}>
              <span className={styles.titleWhite}>{t('hero.titleLine1')}</span>
              <span className={styles.titleAccent}>{t('hero.titleLine2')}</span>
            </h1>

            <p className={styles.subtitle}>
              {t('hero.subtitle1')}
              <br />
              {t('hero.subtitle2')}
            </p>

            <div className={styles.actions}>
              <Button
                variant="primary"
                size="lg"
                icon={<Icon name="arrow-right" size="sm" />}
                onClick={onJoinClick}
              >
                {isAuthenticated ? t('hero.goToRound') : t('hero.joinBtn')}
              </Button>
              <button className={styles.learnMoreBtn} onClick={onLearnMoreClick}>
                {t('hero.learnMore')}
              </button>
            </div>
          </div>

          <div className={`${styles.statsCard} ${isMiniRound ? styles.statsCardAccent : ''}`}>
            {stats?.round_registration_open ? (
              <span className={`${styles.roundBadge} ${styles.roundBadgeOpen}`}>
                <span className={styles.pulseDot} />
                {t('hero.regOpen')}
              </span>
            ) : (
              <div className={styles.statsHeader}>
                <span className={styles.statsLabel}>{t('stats.currentRound')}</span>
                <Badge variant={stats?.is_round_active ? 'accent' : 'default'}>
                  {stats?.is_round_active ? t('stats.active') : t('stats.inactive')}
                </Badge>
              </div>
            )}

            <h2 className={styles.roundTitle}>{roundTitle}</h2>
            {roundWindow && <div className={styles.roundWindow}>{roundWindow}</div>}
            {isMiniRound && <p className={styles.roundLead}>{t('hero.roundLead')}</p>}

            <div className={styles.roundStats}>
              <div className={styles.roundStat}>
                <span className={styles.roundStatValue}>30</span>
                <span className={styles.roundStatLabel}>{t('hero.perDayShort')}</span>
              </div>
              <div className={styles.roundStat}>
                <span className={styles.roundStatValue}>{roundLengthDays || '—'}</span>
                <span className={styles.roundStatLabel}>{t('hero.roundDays')}</span>
              </div>
              <div className={styles.roundStat}>
                <span className={styles.roundStatValue}>
                  {stats ? stats.current_round_participants.toLocaleString() : '—'}
                </span>
                <span className={styles.roundStatLabel}>{t('hero.participantsShort')}</span>
              </div>
            </div>

            {/* While registration is open the round hasn't really started,
                so a progress bar is noise — the CTA is the point. */}
            {roundStarted && (
              <div className={styles.progressSection}>
                <div className={styles.progressHead}>
                  <span className={styles.statLabel}>{t('stats.roundProgress')}</span>
                  <span className={styles.statLabel}>
                    {t('stats.daysRemaining')}: {stats?.days_remaining ?? '—'}
                  </span>
                </div>
                <ProgressBar value={stats?.round_progress_percent ?? 0} showLabel size="md" />
              </div>
            )}

            {/* The CTA people actually need, right here in the first screen */}
            <Button
              variant="primary"
              size="lg"
              className={styles.roundCta}
              onClick={onJoinClick}
            >
              {isAuthenticated
                ? t('hero.goToRound')
                : stats?.round_registration_open
                  ? t('hero.roundJoin')
                  : t('hero.joinBtn')}
            </Button>

            <button
              type="button"
              className={styles.rulesToggle}
              aria-expanded={rulesOpen}
              onClick={() => setRulesOpen(o => !o)}
            >
              {t('hero.rulesTitle')}
              <span className={`${styles.chev} ${rulesOpen ? styles.chevOpen : ''}`}>▾</span>
            </button>

            {rulesOpen && (
              <ul className={styles.rulesList}>
                {RULE_KEYS.map((key, i) => (
                  <li key={key} className={styles.ruleItem}>
                    <span className={styles.ruleNum}>{i + 1}</span>
                    <span>{t(key)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}
