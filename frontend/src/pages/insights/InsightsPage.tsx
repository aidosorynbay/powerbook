import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toPng } from 'html-to-image';
import {
  useI18n,
  useAuth,
  apiGet,
  type Wrapped,
  type AllTimeProfile,
  type Archetype,
  type BookshelfEntry,
  type PopularBook,
  type ReadingTwin,
  type CelebrityMatch,
  type BadgeData,
  type LeagueTier,
} from '@/shared/lib';
import { Card, Container, PageTransition, Badge, ProgressBar, Button } from '@/shared/ui';
import { Header, Footer, ClaimPicker, WrappedCard } from '@/widgets';
import styles from './InsightsPage.module.css';

function StatTile({ value, label, accent }: { value: string | number; label: string; accent?: boolean }) {
  return (
    <div className={`${styles.statTile} ${accent ? styles.statTileAccent : ''}`}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

export function InsightsPage() {
  const { t } = useI18n();
  const { user } = useAuth();

  const [profile, setProfile] = useState<AllTimeProfile | null>(null);
  const [archetype, setArchetype] = useState<Archetype | null>(null);
  const [bookshelf, setBookshelf] = useState<BookshelfEntry[]>([]);
  const [popular, setPopular] = useState<PopularBook[]>([]);
  const [twins, setTwins] = useState<ReadingTwin[]>([]);
  const [celebrities, setCelebrities] = useState<CelebrityMatch[]>([]);
  const [badges, setBadges] = useState<BadgeData[]>([]);
  const [league, setLeague] = useState<LeagueTier | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAllBadges, setShowAllBadges] = useState(false);
  const [showAllBooks, setShowAllBooks] = useState(false);
  const [wrapped, setWrapped] = useState<Wrapped | null>(null);
  const [showWrapped, setShowWrapped] = useState(false);
  const [isLoadingWrapped, setIsLoadingWrapped] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const wrappedCardRef = useRef<HTMLDivElement>(null);

  const openWrapped = async () => {
    setShowWrapped(true);
    if (wrapped) return;
    setIsLoadingWrapped(true);
    const { data } = await apiGet<Wrapped>('/insights/wrapped', { requireAuth: true });
    if (data) setWrapped(data);
    setIsLoadingWrapped(false);
  };

  const downloadWrapped = async () => {
    if (!wrappedCardRef.current) return;
    setIsDownloading(true);
    try {
      const dataUrl = await toPng(wrappedCardRef.current, { pixelRatio: 3 });
      const link = document.createElement('a');
      link.download = `powerbook-wrapped-${wrapped?.year ?? ''}.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      setIsDownloading(false);
    }
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    const [p, a, bs, pop, tw, cel, bd, lg] = await Promise.all([
      apiGet<AllTimeProfile>('/insights/profile', { requireAuth: true }),
      apiGet<Archetype>('/insights/archetype', { requireAuth: true }),
      apiGet<BookshelfEntry[]>('/insights/bookshelf', { requireAuth: true }),
      apiGet<PopularBook[]>('/insights/popular-books?limit=8', { requireAuth: true }),
      apiGet<ReadingTwin[]>('/insights/twins?limit=5', { requireAuth: true }),
      apiGet<CelebrityMatch[]>('/insights/celebrity-match', { requireAuth: true }),
      apiGet<BadgeData[]>('/insights/badges', { requireAuth: true }),
      apiGet<LeagueTier>('/insights/league', { requireAuth: true }),
    ]);
    if (p.data) setProfile(p.data);
    if (a.data) setArchetype(a.data);
    if (bs.data) setBookshelf(bs.data.slice().reverse());
    if (pop.data) setPopular(pop.data);
    if (tw.data) setTwins(tw.data);
    if (cel.data) setCelebrities(cel.data);
    if (bd.data) setBadges(bd.data);
    if (lg.data) setLeague(lg.data);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const earnedBadges = badges.filter((b) => b.earned);
  const nextBadges = badges.filter((b) => !b.earned).slice(0, showAllBadges ? undefined : 3);
  const visibleBooks = showAllBooks ? bookshelf : bookshelf.slice(0, 6);

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container>
            <div className={styles.titleRow}>
              <div>
                <h1 className={styles.title}>{t('insights.title')}</h1>
                <p className={styles.subtitle}>{t('insights.subtitle')}</p>
              </div>
              <Button variant="primary" size="sm" onClick={openWrapped}>
                {t('wrapped.button')}
              </Button>
            </div>

            {isLoading ? (
              <div className={styles.loading}>{t('dashboard.loading')}</div>
            ) : (
              <>
                {profile && (
                  <div className={styles.statGrid}>
                    <StatTile value={profile.total_hours} label={t('insights.totalHours')} accent />
                    <StatTile value={profile.longest_streak_days} label={t('insights.longestStreak')} />
                    <StatTile value={`${profile.consistency_percent}%`} label={t('insights.consistency')} />
                    <StatTile value={profile.rounds_participated} label={t('insights.circles')} />
                    <StatTile value={profile.books_finished} label={t('insights.booksFinished')} />
                    <StatTile
                      value={profile.current_streak_days > 0 ? `🔥 ${profile.current_streak_days}` : '—'}
                      label={t('insights.currentStreak')}
                    />
                  </div>
                )}

                <section className={styles.section}>
                  <h2 className={styles.sectionTitle}>{t('claims.title')}</h2>
                  <p className={styles.sectionHint}>{t('claims.subtitle')}</p>
                  <ClaimPicker onChange={load} />
                </section>

                {profile?.first_round_label && (
                  <div className={styles.sinceLine}>
                    {t('insights.readingSince')} <b>{profile.first_round_label}</b>
                  </div>
                )}

                {archetype && (
                  <Card variant="glass" padding="lg" className={styles.archetypeCard}>
                    <div className={styles.archetypeKicker}>{t('insights.yourType')}</div>
                    <div className={styles.archetypeTitle}>{archetype.title}</div>
                    <div className={styles.archetypeDesc}>{archetype.description}</div>
                    {archetype.fun_fact && <div className={styles.archetypeFunFact}>{archetype.fun_fact}</div>}
                  </Card>
                )}

                {league && (
                  <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>{t('insights.league')} · {league.round_label}</h2>
                    <Card variant="default" padding="md">
                      <div className={styles.leagueHeader}>
                        <Badge variant={league.tier === 'Gold' ? 'accent' : league.tier === 'Silver' ? 'default' : 'outline'}>
                          {t(`league.${league.tier.toLowerCase()}`)}
                        </Badge>
                        <span className={styles.leagueScore}>{t('insights.yourScore')}: {league.your_score}</span>
                      </div>
                      <ol className={styles.leagueList}>
                        {league.members.slice(0, 8).map((m) => (
                          <li key={m.telegram_id ?? m.display_name} className={styles.leagueRow}>
                            <span>{m.display_name}</span>
                            <span className={styles.leagueRowScore}>{m.score}</span>
                          </li>
                        ))}
                      </ol>
                    </Card>
                  </section>
                )}

                <section className={styles.section}>
                  <h2 className={styles.sectionTitle}>{t('insights.badges')}</h2>
                  <div className={styles.badgeGrid}>
                    {earnedBadges.slice(0, 6).map((b) => (
                      <div key={b.key} className={`${styles.badgeCard} ${styles.badgeEarned}`}>
                        <div className={styles.badgeIcon}>✓</div>
                        <div className={styles.badgeTitle}>{b.title}</div>
                      </div>
                    ))}
                  </div>
                  {nextBadges.length > 0 && (
                    <div className={styles.nextBadges}>
                      <div className={styles.nextBadgesLabel}>{t('insights.nextUp')}</div>
                      {nextBadges.map((b) => (
                        <div key={b.key} className={styles.nextBadgeRow}>
                          <div className={styles.nextBadgeText}>
                            <span>{b.title}</span>
                            <span className={styles.nextBadgeProgress}>
                              {b.progress_current}/{b.progress_target}
                            </span>
                          </div>
                          <ProgressBar value={b.progress_current} max={b.progress_target} size="sm" />
                        </div>
                      ))}
                      {!showAllBadges && badges.some((b) => !b.earned) && (
                        <button className={styles.showMoreBtn} onClick={() => setShowAllBadges(true)}>
                          {t('insights.showMore')}
                        </button>
                      )}
                    </div>
                  )}
                </section>

                {bookshelf.length > 0 && (
                  <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>{t('insights.bookshelf')}</h2>
                    <Card variant="default" padding="md">
                      <ul className={styles.bookList}>
                        {visibleBooks.map((b, i) => (
                          <li key={i} className={styles.bookRow}>
                            <span className={styles.bookTitle}>{b.title}</span>
                            <span className={styles.bookMeta}>{b.round_label}</span>
                          </li>
                        ))}
                      </ul>
                      {!showAllBooks && bookshelf.length > 6 && (
                        <button className={styles.showMoreBtn} onClick={() => setShowAllBooks(true)}>
                          {t('insights.showMore')} ({bookshelf.length - 6})
                        </button>
                      )}
                    </Card>
                  </section>
                )}

                {popular.length > 0 && (
                  <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>{t('insights.popularBooks')}</h2>
                    <Card variant="default" padding="md">
                      <ul className={styles.bookList}>
                        {popular.map((b, i) => (
                          <li key={i} className={styles.bookRow}>
                            <span className={styles.bookTitle}>{b.title}</span>
                            <span className={styles.bookMeta}>×{b.finish_count}</span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </section>
                )}

                {twins.length > 0 && (
                  <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>{t('insights.readingTwins')}</h2>
                    <p className={styles.sectionHint}>{t('insights.readingTwinsHint')}</p>
                    <div className={styles.twinGrid}>
                      {twins.map((tw) => (
                        <Card key={tw.user_id} variant="default" padding="md" className={styles.twinCard}>
                          <div className={styles.twinHeader}>
                            <span className={styles.twinName}>{tw.display_name}</span>
                            <span className={styles.twinPercent}>{tw.match_percent}%</span>
                          </div>
                          <div className={styles.twinBooks}>{tw.shared_books.slice(0, 3).join(' · ')}</div>
                        </Card>
                      ))}
                    </div>
                  </section>
                )}

                {celebrities.length > 0 && (
                  <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>{t('insights.celebrityMatch')}</h2>
                    <p className={styles.sectionHint}>{t('insights.celebrityMatchHint')}</p>
                    <div className={styles.twinGrid}>
                      {celebrities.map((c) => (
                        <Card key={c.name} variant="default" padding="md" className={styles.twinCard}>
                          <div className={styles.twinHeader}>
                            <span className={styles.twinName}>{c.name}</span>
                            <span className={styles.twinPercent}>{c.match_percent}%</span>
                          </div>
                          <div className={styles.twinBooks}>{c.role}</div>
                        </Card>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </Container>
        </main>
        <Footer />
      </div>

      {showWrapped && createPortal(
        <div className={styles.wrappedOverlay} onClick={() => setShowWrapped(false)}>
          <div className={styles.wrappedModal} onClick={(e) => e.stopPropagation()}>
            {isLoadingWrapped || !wrapped ? (
              <div className={styles.loading}>{t('dashboard.loading')}</div>
            ) : (
              <>
                <WrappedCard ref={wrappedCardRef} wrapped={wrapped} displayName={user?.display_name ?? ''} />
                <div className={styles.wrappedActions}>
                  <Button variant="ghost" onClick={() => setShowWrapped(false)}>
                    {t('wrapped.close')}
                  </Button>
                  <Button variant="primary" onClick={downloadWrapped} disabled={isDownloading}>
                    {isDownloading ? t('wrapped.downloading') : t('wrapped.download')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </PageTransition>
  );
}
