import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useI18n, apiGet, type HallOfFame, type HallOfFameCategory, type HallOfFameEntry } from '@/shared/lib';
import { Container, PageTransition, Icon } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import styles from './HallOfFamePage.module.css';

const MEDALS = ['🥇', '🥈', '🥉'];

const CATEGORY_ICONS: Record<string, string> = {
  hours: '⏱️',
  streak: '🔥',
  rounds: '🔄',
  books: '📚',
  best_day: '⚡',
  best_month: '🚀',
  perfect_circles: '💎',
};

export function HallOfFamePage() {
  const { t } = useI18n();
  const [data, setData] = useState<HallOfFame | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [openCategory, setOpenCategory] = useState<HallOfFameCategory | null>(null);

  const formatUnit = (unit: string) => t(`hallOfFame.unit.${unit}`);
  const formatBadge = (categoryKey: string, entry: HallOfFameEntry) =>
    entry.badge_milestone != null
      ? t(`hallOfFame.badge.${categoryKey}`, { value: entry.badge_milestone })
      : entry.badge_title;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: res } = await apiGet<HallOfFame>('/insights/hall-of-fame');
      if (!cancelled && res) setData(res);
      if (!cancelled) setIsLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container>
            <div className={styles.hero}>
              <div className={styles.heroIcon}>
                <Icon name="trophy" size="lg" />
              </div>
              <h1 className={styles.title}>{t('hallOfFame.title')}</h1>
              <p className={styles.subtitle}>{t('hallOfFame.subtitle')}</p>
            </div>

            {isLoading ? (
              <div className={styles.loading}>{t('dashboard.loading')}</div>
            ) : (
              <div className={styles.badgeGrid}>
                {data?.categories.map((cat) => {
                  const leader = cat.entries[0];
                  return (
                    <button
                      key={cat.key}
                      className={styles.badgeTile}
                      onClick={() => setOpenCategory(cat)}
                      disabled={cat.entries.length === 0}
                    >
                      <span className={styles.badgeIcon}>{CATEGORY_ICONS[cat.key] ?? '🏆'}</span>
                      <span className={styles.badgeTitle}>{t(`hallOfFame.category.${cat.key}`)}</span>
                      {leader ? (
                        <span className={styles.badgeLeader}>
                          {leader.display_name} · {leader.value} {formatUnit(cat.unit)}
                        </span>
                      ) : (
                        <span className={styles.badgeLeader}>{t('hallOfFame.empty')}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Container>
        </main>
        <Footer />
      </div>

      {openCategory && createPortal(
        <div className={styles.modal} onClick={() => setOpenCategory(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>
              {CATEGORY_ICONS[openCategory.key] ?? '🏆'} {t(`hallOfFame.category.${openCategory.key}`)}
            </div>
            <ol className={styles.entryList}>
              {openCategory.entries.map((e, i) => {
                const badgeText = formatBadge(openCategory.key, e);
                return (
                  <li key={e.user_id} className={styles.entryRow}>
                    <span className={styles.entryRank}>{MEDALS[i] ?? i + 1}</span>
                    <span className={styles.entryInfo}>
                      <Link to={`/readers/${e.user_id}`} className={styles.entryName}>
                        {e.display_name}
                      </Link>
                      {badgeText && <span className={styles.entryBadge}>{badgeText}</span>}
                    </span>
                    <span className={styles.entryValue}>
                      {e.value} {formatUnit(openCategory.unit)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>,
        document.body
      )}
    </PageTransition>
  );
}

