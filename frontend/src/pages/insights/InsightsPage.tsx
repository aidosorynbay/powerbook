import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { toBlob, toPng } from 'html-to-image';
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
  type BadgeStats,
  type LeagueTier,
} from '@/shared/lib';
import { Card, Container, PageTransition, Badge, ProgressBar, Button, BookCard } from '@/shared/ui';
import { Header, Footer, ClaimPicker, WrappedCard } from '@/widgets';
import { paletteFor, dimensionsFor } from '@/pages/library/bookcase/bookArt';
import { bookCount } from '@/pages/library/bookcase/plural';
import styles from './InsightsPage.module.css';
import { ProfileListings, RecapLink } from '../books/ProfileBits';

function StatTile({
  value,
  label,
  accent,
  to,
}: {
  value: string | number;
  label: string;
  accent?: boolean;
  to?: string;
}) {
  const className = `${styles.statTile} ${accent ? styles.statTileAccent : ''} ${to ? styles.statTileLink : ''}`;
  const body = (
    <>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </>
  );
  // Tiles without a meaningful destination stay plain rather than pretending
  // to be interactive.
  return to ? <Link to={to} className={className}>{body}</Link> : <div className={className}>{body}</div>;
}

export function InsightsPage() {
  const { t, locale } = useI18n();
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
  const [openBadge, setOpenBadge] = useState<BadgeData | null>(null);
  const [badgeStats, setBadgeStats] = useState<BadgeStats | null>(null);
  const [wrapped, setWrapped] = useState<Wrapped | null>(null);
  const [showWrapped, setShowWrapped] = useState(false);
  const [isLoadingWrapped, setIsLoadingWrapped] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  // Rendered ahead of the tap so sharing stays inside the user gesture
  const [wrappedFile, setWrappedFile] = useState<File | null>(null);
  const [expandedMatch, setExpandedMatch] = useState<{
    name: string;
    subtitle: string;
    books: string[];
    userId?: string;
  } | null>(null);
  const wrappedCardRef = useRef<HTMLDivElement>(null);

  const openWrapped = async () => {
    setShowWrapped(true);
    if (wrapped) return;
    setIsLoadingWrapped(true);
    const { data } = await apiGet<Wrapped>('/insights/wrapped', { requireAuth: true });
    if (data) setWrapped(data);
    setIsLoadingWrapped(false);
  };

  const switchWrappedYear = async (year: number) => {
    if (wrapped?.year === year) return;
    setIsLoadingWrapped(true);
    const { data } = await apiGet<Wrapped>(`/insights/wrapped?year=${year}`, { requireAuth: true });
    if (data) setWrapped(data);
    setIsLoadingWrapped(false);
  };

  const buildWrappedFile = useCallback(async (): Promise<File | null> => {
    if (!wrappedCardRef.current) return null;
    const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const blob = await toBlob(wrappedCardRef.current, {
      pixelRatio: isCoarsePointer ? 2 : 3,
    });
    if (!blob) return null;
    return new File([blob], `powerbook-wrapped-${wrapped?.year ?? ''}.png`, {
      type: 'image/png',
    });
  }, [wrapped?.year]);

  useEffect(() => {
    if (!showWrapped || !wrapped) {
      setWrappedFile(null);
      return;
    }
    let cancelled = false;
    // One frame for the card to paint, then render it to a file in advance.
    const id = window.setTimeout(async () => {
      try {
        const file = await buildWrappedFile();
        if (!cancelled) setWrappedFile(file);
      } catch {
        // leave it null; the button falls back to rendering on demand
      }
    }, 350);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [showWrapped, wrapped, buildWrappedFile]);

  const downloadWrapped = async () => {
    if (!wrappedCardRef.current) return;
    const fileName = `powerbook-wrapped-${wrapped?.year ?? ''}.png`;

    // Fast path: the image is already rendered, so the share sheet opens
    // while the tap still counts as user activation.
    if (wrappedFile && navigator.canShare?.({ files: [wrappedFile] })) {
      try {
        await navigator.share({ files: [wrappedFile] });
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    }

    setIsDownloading(true);
    try {
      const file = wrappedFile ?? (await buildWrappedFile());
      if (!file) throw new Error('render failed');
      const blob = file;

      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (err) {
          // User dismissed the sheet — that's not a failure worth falling
          // through for.
          if ((err as Error)?.name === 'AbortError') return;
        }
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      // Phones never get here with a working download attribute anyway.
      if ('download' in link && !window.matchMedia('(pointer: coarse)').matches) {
        link.download = fileName;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } else {
        // Last resort: show it so it can be long-pressed and saved.
        window.open(url, '_blank');
      }

      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      // Keep the old path as a safety net rather than leaving the user with
      // a button that silently does nothing.
      try {
        const dataUrl = await toPng(wrappedCardRef.current, { pixelRatio: 2 });
        window.open(dataUrl, '_blank');
      } catch {
        // nothing more we can do here
      }
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

  useEffect(() => {
    if (!openBadge) return;
    setBadgeStats(null);
    let cancelled = false;
    apiGet<BadgeStats>(`/insights/badges/${openBadge.key}/stats`, { requireAuth: true })
      .then(({ data }) => { if (!cancelled && data) setBadgeStats(data); });
    return () => { cancelled = true; };
  }, [openBadge]);

  const archetypeTitle = archetype
    ? t(
        `archetype.${archetype.key}.title`,
        archetype.key === 'weekday_loyalist'
          ? { weekday: t(`weekday.long.${archetype.params.weekday}`) }
          : archetype.params
      )
    : '';
  const archetypeDesc = archetype
    ? t(
        `archetype.${archetype.key}.description`,
        archetype.key === 'weekday_loyalist'
          ? { weekday: t(`weekday.longPlural.${archetype.params.weekday}`) }
          : archetype.params
      )
    : '';
  const funFactText =
    archetype && archetype.fun_fact_weekday !== null && archetype.fun_fact_minutes !== null
      ? t('insights.funFact', {
          weekday: t(`weekday.longPlural.${archetype.fun_fact_weekday}`),
          minutes: archetype.fun_fact_minutes,
        })
      : null;

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container>
            <div className={styles.titleRow}>
              <div>
                <h1 className={styles.title}>{t('insights.title')}</h1>
                <p className={styles.subtitle}>
                  {t('insights.subtitle')}
                  {' · '}
                  <Link to="/profile" className={styles.settingsLink}>{t('nav.settings')}</Link>
                </p>
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
                    <StatTile value={profile.total_hours} label={t('insights.totalHours')} accent to="/archive" />
                    <StatTile value={profile.longest_streak_days} label={t('insights.longestStreak')} to="/hall-of-fame" />
                    <StatTile value={`${profile.consistency_percent}%`} label={t('insights.consistency')} to="/archive" />
                    <StatTile value={profile.rounds_participated} label={t('insights.circles')} to="/results" />
                    <StatTile value={profile.books_finished} label={t('insights.booksFinished')} to="/library" />
                    <StatTile
                      value={profile.current_streak_days > 0 ? `🔥 ${profile.current_streak_days}` : '—'}
                      label={t('insights.currentStreak')}
                      to="/round"
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
                    <div className={styles.archetypeTitle}>{archetypeTitle}</div>
                    <div className={styles.archetypeDesc}>{archetypeDesc}</div>
                    {/* The figure is tied to the archetype, not to the books
                        read — it names the habit the reader shares, which is
                        what the type is about in the first place. */}
                    <div className={styles.kindred}>
                      <div className={styles.kindredLabel}>{t('insights.kindred')}</div>
                      <div className={styles.kindredName}>{t(`archetype.${archetype.key}.kindred`)}</div>
                      <div className={styles.kindredWhy}>{t(`archetype.${archetype.key}.kindredWhy`)}</div>
                    </div>
                    {funFactText && <div className={styles.archetypeFunFact}>{funFactText}</div>}
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
                          <li key={m.user_id} className={styles.leagueRow}>
                            <Link to={`/readers/${m.user_id}`} className={styles.leagueRowName}>
                              {m.display_name}
                            </Link>
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
                      <button
                        key={b.key}
                        className={`${styles.badgeCard} ${styles.badgeEarned} ${styles.badgeClickable}`}
                        onClick={() => setOpenBadge(b)}
                      >
                        <div className={styles.badgeIcon}>✓</div>
                        <div className={styles.badgeTitle}>{b.title}</div>
                      </button>
                    ))}
                  </div>
                  {nextBadges.length > 0 && (
                    <div className={styles.nextBadges}>
                      <div className={styles.nextBadgesLabel}>{t('insights.nextUp')}</div>
                      {nextBadges.map((b) => (
                        <div
                          key={b.key}
                          className={`${styles.nextBadgeRow} ${styles.nextBadgeClickable}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => setOpenBadge(b)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpenBadge(b); }}
                        >
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

                <RecapLink />

                <section className={styles.section}>
                  <h2 className={styles.sectionTitle}>{t('insights.bookshelf')}</h2>
                  {/* A small window onto the library: a few spines in the colours those books wear on the 3D
                      shelf; the whole of it opens the library */}
                  <Link to="/library" className={styles.shelfPeek}>
                    <span className={styles.shelfPeekText}>
                      <span className={styles.shelfPeekKicker}>{t('nav.library')}</span>
                      <span className={styles.shelfPeekTitle}>{t('insights.openLibrary')}</span>
                      <span className={styles.shelfPeekHint}>
                        {bookshelf.length
                          ? t('shelf.profileCtaHint', { count: bookCount(locale, bookshelf.length, t) })
                          : t('insights.libraryEmptyHint')}
                      </span>
                    </span>
                    <span className={`${styles.shelfPeekSpines} ${bookshelf.length ? '' : styles.shelfPeekGhost}`} aria-hidden="true">
                      {(bookshelf.length ? bookshelf.map((b) => b.title) : ['a', 'bb', 'ccc', 'dddd', 'eeeee']).slice(0, 9).map((title, i) => {
                        const seed = title.trim().toLowerCase();
                        const p = paletteFor(seed);
                        const d = dimensionsFor(seed);
                        return (
                          <span
                            key={i}
                            style={{
                              background: p.cover,
                              borderTopColor: p.accent,
                              height: `${Math.round(d.height * 30)}px`,
                              width: `${Math.round(d.thickness * 48)}px`,
                            }}
                          />
                        );
                      })}
                    </span>
                    <span className={styles.shelfPeekArrow} aria-hidden="true">→</span>
                  </Link>
                {bookshelf.length > 0 && (
                    <Card variant="default" padding="md">
                      <ul className={styles.bookList}>
                        {visibleBooks.map((b, i) => (
                          <li key={i} className={styles.bookRow}>
                            <Link
                              to={`/library?book=${encodeURIComponent(b.source === 'manual' && b.id ? `m:${b.id}` : b.title)}&open=1`}
                              className={styles.bookTitleLink}
                            >
                              {b.title}
                              {b.author && <span className={styles.bookAuthor}> — {b.author}</span>}
                            </Link>
                            <span className={styles.bookMeta}>
                              {b.source === 'manual' ? t('insights.addedByHand') : b.round_label}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {!showAllBooks && bookshelf.length > 6 && (
                        <button className={styles.showMoreBtn} onClick={() => setShowAllBooks(true)}>
                          {t('insights.showMore')} ({bookshelf.length - 6})
                        </button>
                      )}
                    </Card>
                )}
                </section>

                {user && <ProfileListings userId={user.id} isSelf titleClass={styles.sectionTitle} />}

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
                        <button
                          key={tw.user_id}
                          type="button"
                          className={styles.twinCard}
                          onClick={() => setExpandedMatch({
                            name: tw.display_name,
                            subtitle: `${tw.match_percent}% ${t('insights.matchPercentSuffix')}`,
                            books: tw.shared_books,
                            userId: tw.user_id,
                          })}
                        >
                          <div className={styles.twinHeader}>
                            <span className={styles.twinName}>{tw.display_name}</span>
                            <span className={styles.twinPercent}>{tw.match_percent}%</span>
                          </div>
                          <div className={styles.twinBooks}>{tw.shared_books.slice(0, 3).join(' · ')}</div>
                        </button>
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
                        <button
                          key={c.name}
                          type="button"
                          className={styles.twinCard}
                          onClick={() => setExpandedMatch({
                            name: c.name,
                            subtitle: `${c.role} · ${c.match_percent}% ${t('insights.matchPercentSuffix')}`,
                            books: c.shared_books,
                          })}
                        >
                          <div className={styles.twinHeader}>
                            <span className={styles.twinName}>{c.name}</span>
                            <span className={styles.twinPercent}>{c.match_percent}%</span>
                          </div>
                          <div className={styles.twinBooks}>{c.shared_books.slice(0, 3).join(' · ')}</div>
                        </button>
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
            {!wrapped ? (
              <div className={styles.loading}>{t('dashboard.loading')}</div>
            ) : (
              <>
                <div className={isLoadingWrapped ? styles.wrappedCardSwitching : undefined}>
                  <WrappedCard ref={wrappedCardRef} wrapped={wrapped} displayName={user?.display_name ?? ''} />
                </div>
                <div className={styles.wrappedActions}>
                  <Button variant="ghost" onClick={() => setShowWrapped(false)}>
                    {t('wrapped.close')}
                  </Button>
                  <Button variant="primary" onClick={downloadWrapped} disabled={isDownloading}>
                    {isDownloading ? t('wrapped.downloading') : t('wrapped.download')}
                  </Button>
                </div>
                {wrapped.available_years.length > 1 && (
                  <div className={styles.wrappedYearDots}>
                    {wrapped.available_years.map((y) => (
                      <button
                        key={y}
                        type="button"
                        className={`${styles.wrappedYearDot} ${y === wrapped.year ? styles.wrappedYearDotActive : ''}`}
                        aria-label={String(y)}
                        title={String(y)}
                        disabled={isLoadingWrapped}
                        onClick={() => switchWrappedYear(y)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>,
        document.body
      )}

      {expandedMatch && createPortal(
        <div className={styles.matchOverlay} onClick={() => setExpandedMatch(null)}>
          <div className={styles.matchModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.matchModalHeader}>
              <div>
                {expandedMatch.userId ? (
                  <Link
                    to={`/readers/${expandedMatch.userId}`}
                    className={styles.matchModalNameLink}
                    onClick={() => setExpandedMatch(null)}
                  >
                    {expandedMatch.name}
                  </Link>
                ) : (
                  <div className={styles.matchModalName}>{expandedMatch.name}</div>
                )}
                <div className={styles.matchModalSubtitle}>{expandedMatch.subtitle}</div>
              </div>
              <button className={styles.matchModalClose} onClick={() => setExpandedMatch(null)} aria-label="Close">
                &times;
              </button>
            </div>
            <div className={styles.matchModalGrid}>
              {expandedMatch.books.map((title, i) => (
                <BookCard key={i} title={title} size="sm" />
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
      {openBadge && createPortal(
        <div className={styles.matchOverlay} onClick={() => setOpenBadge(null)}>
          <div className={styles.matchModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.matchModalHeader}>
              <div>
                <div className={styles.matchModalName}>{openBadge.title}</div>
                <div className={styles.matchModalSubtitle}>
                  {openBadge.earned
                    ? t('insights.badgeEarnedOn')
                    : `${openBadge.progress_current} / ${openBadge.progress_target}`}
                </div>
              </div>
              <button
                className={styles.matchModalClose}
                onClick={() => setOpenBadge(null)}
                aria-label={t('library.backToLibrary')}
              >
                ×
              </button>
            </div>
            <p className={styles.archetypeDesc}>{openBadge.description}</p>
            {!openBadge.earned && openBadge.progress_target > 0 && (
              <div className={styles.badgeModalProgress}>
                <ProgressBar value={openBadge.progress_current} max={openBadge.progress_target} showLabel />
              </div>
            )}

            {badgeStats && (
              <>
                <div className={styles.badgeRarity}>
                  {t('insights.badgeRarity', {
                    holders: badgeStats.holders,
                    total: badgeStats.total_readers,
                    percent: badgeStats.percent,
                  })}
                </div>

                {badgeStats.sample.length > 0 ? (
                  <div className={styles.badgeHolders}>
                    <div className={styles.badgeHoldersLabel}>{t('insights.badgeWhoElse')}</div>
                    {badgeStats.sample.map((h) => (
                      <Link key={h.user_id} to={`/readers/${h.user_id}`} className={styles.badgeHolderRow}>
                        <span className={styles.badgeHolderName}>{h.display_name}</span>
                        <span className={styles.badgeHolderValue}>{h.value}</span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  openBadge.earned && (
                    <div className={styles.badgeHoldersLabel}>{t('insights.badgeOnlyYou')}</div>
                  )
                )}

                <div className={styles.badgeNext}>
                  <div className={styles.badgeHoldersLabel}>{t('insights.badgeNext')}</div>
                  {badgeStats.next_threshold ? (
                    <div className={styles.badgeNextValue}>
                      {t('insights.badgeNextValue', {
                        left: Math.max(0, badgeStats.next_threshold - openBadge.progress_current),
                        next: badgeStats.next_threshold,
                      })}
                    </div>
                  ) : (
                    <div className={styles.badgeNextValue}>{t('insights.badgeRarest')}</div>
                  )}
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

