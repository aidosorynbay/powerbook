import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { toBlob, toPng } from 'html-to-image';
import {
  useI18n,
  useAuth,
  apiGet,
  type Wrapped,
  type AllTimeProfile,
  type Archetype,
  type BookshelfEntry,
  type BookcaseBook,
  type ReadingTwin,
  type CelebrityMatch,
  type BadgeData,
  type BadgeStats,
  type League,
  isStandalone,
  track,
} from '@/shared/lib';
import { Avatar, Card, Container, PageTransition, ProgressBar, Button, BookCard, Icon } from '@/shared/ui';
import { Header, Footer, ClaimPicker, WrappedCard, BookTime, InviteFriends, HelpSheet, useHelpOn } from '@/widgets';
import { paletteFor, dimensionsFor } from '@/pages/library/bookcase/bookArt';
import { bookCount } from '@/pages/library/bookcase/plural';
import { LeagueCard, LeaguePromo } from '@/widgets/League';
import { AwardsCard, AwardsMoment, awardsOn, useAwards } from '@/widgets/Awards';
import styles from './InsightsPage.module.css';
import { ProfileListings } from '../books/ProfileBits';

function StatTile({
  value,
  label,
  accent,
  to,
}: {
  value: ReactNode;
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
  const { user, logout } = useAuth();

  const [profile, setProfile] = useState<AllTimeProfile | null>(null);
  // Arrived from «Вы раньше участвовали в кругах? — Да»: down to the archive section, lit for a moment.
  const [claimLit, setClaimLit] = useState(false);
  useEffect(() => {
    // «Приведи друга», from the guests line of «Поделиться днём»: down to it, lit the same way
    const hash = window.location.hash;
    if (hash !== '#claim' && hash !== '#invite') return;
    const target = hash.slice(1);
    let tries = 0;
    let timer = 0;
    const find = () => {
      const el = document.getElementById(target);
      if (!el) {
        if (tries++ < 30) timer = window.setTimeout(find, 200);
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (target === 'invite') return;
      el.querySelector('input')?.focus({ preventScroll: true });
      setClaimLit(true);
      timer = window.setTimeout(() => setClaimLit(false), 2600);
    };
    timer = window.setTimeout(find, 150);
    return () => window.clearTimeout(timer);
  }, []);
  const [archetype, setArchetype] = useState<Archetype | null>(null);
  // «Пригласить друга» and the old-nickname box open in place; a #invite / #claim link opens them too
  const [inviteOpen, setInviteOpen] = useState(() => window.location.hash === '#invite');
  const [claimOpen, setClaimOpen] = useState(() => window.location.hash === '#claim');
  const isAdmin = user?.system_role === 'admin' || user?.system_role === 'superadmin';
  const showAwards = awardsOn(user);
  const { awards, reload: reloadAwards } = useAwards(showAwards);
  // «Правила и о нас» opens the same sheet as «?» in the header: one place for the rules, two ways in
  const helpOn = useHelpOn();
  const [helpOpen, setHelpOpen] = useState(false);
  const [hasClaims, setHasClaims] = useState(false);
  useEffect(() => {
    apiGet<unknown[]>('/claims/mine', { requireAuth: true }).then(({ data }) => setHasClaims(Array.isArray(data) && data.length > 0));
  }, []);
  const navigate = useNavigate();
  const [bookshelf, setBookshelf] = useState<BookshelfEntry[]>([]);
  // the shelf of the library, for «Время на книгах»: the time each book has had (it does not hold up the page)
  const [shelfBooks, setShelfBooks] = useState<BookcaseBook[]>([]);
  useEffect(() => {
    apiGet<{ books: BookcaseBook[] }>('/library/bookcase', { requireAuth: true }).then(({ data }) => {
      if (data?.books) setShelfBooks(data.books);
    });
  }, []);
  const [twins, setTwins] = useState<ReadingTwin[]>([]);
  const [celebrities, setCelebrities] = useState<CelebrityMatch[]>([]);
  const [badges, setBadges] = useState<BadgeData[]>([]);
  const [league, setLeague] = useState<League | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAllBadges, setShowAllBadges] = useState(false);
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
    const [p, a, bs, tw, cel, bd, lg] = await Promise.all([
      apiGet<AllTimeProfile>('/insights/profile', { requireAuth: true }),
      apiGet<Archetype>('/insights/archetype', { requireAuth: true }),
      apiGet<BookshelfEntry[]>('/insights/bookshelf', { requireAuth: true }),
      apiGet<ReadingTwin[]>('/insights/twins?limit=5', { requireAuth: true }),
      apiGet<CelebrityMatch[]>('/insights/celebrity-match', { requireAuth: true }),
      apiGet<BadgeData[]>('/insights/badges', { requireAuth: true }),
      apiGet<League>('/insights/league', { requireAuth: true }),
    ]);
    if (p.data) setProfile(p.data);
    if (a.data) setArchetype(a.data);
    if (bs.data) setBookshelf(bs.data.slice().reverse());
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

  useEffect(() => {
    if (!openBadge) return;
    setBadgeStats(null);
    let cancelled = false;
    apiGet<BadgeStats>(`/insights/badges/${openBadge.key}/stats`, { requireAuth: true })
      .then(({ data }) => { if (!cancelled && data) setBadgeStats(data); });
    return () => { cancelled = true; };
  }, [openBadge]);

  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const firstCircle = (() => {
    const [abbr, year] = (profile?.first_round_label ?? '').split(' ');
    const m = MONTH_ABBR.indexOf(abbr) + 1;
    return m > 0 && year ? { month: t(`month.${m}`).toLowerCase(), year } : null;
  })();

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
            <div className={styles.col}>
            {/* who you are, and the gear: settings are one tap from here instead of a header icon and a menu item */}
            <div className={styles.idRow}>
              {user && <Avatar src={user.avatar_data} name={user.display_name || user.username} size="lg" />}
              <div className={styles.idText}>
                <h1 className={styles.title}>{user?.display_name || user?.username}</h1>
                <p className={styles.subtitle}>
                  {user?.username && <span>@{user.username}</span>}
                  {firstCircle && <span>{t('prof2.firstCircle', firstCircle)}</span>}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={openWrapped}>{t('wrapped.button')}</Button>
            </div>

            {isLoading ? (
              <div className={styles.loading}>{t('dashboard.loading')}</div>
            ) : (
              <>
                {/* one block of numbers, from one place; the tiles no longer double as hidden links to other pages */}
                {profile && (
                  <div className={styles.statGrid}>
                    <StatTile value={profile.total_hours} label={t('insights.totalHours')} accent />
                    <StatTile value={profile.longest_streak_days} label={t('insights.longestStreak')} />
                    <StatTile value={profile.rounds_participated} label={t('insights.circles')} />
                    <StatTile value={profile.books_finished} label={t('insights.booksFinished')} />
                  </div>
                )}

                {league?.live && user && <LeagueCard league={league} name={user.display_name || user.username} />}
                {league?.live && user && <LeaguePromo league={league} name={user.display_name || user.username} />}
                {showAwards && awards && user && (
                  <>
                    <AwardsCard awards={awards} name={user.display_name || user.username} username={user.username} onChange={reloadAwards} />
                    <AwardsMoment awards={awards} name={user.display_name || user.username} username={user.username} onSeen={reloadAwards} />
                  </>
                )}

                <nav className={styles.rows} aria-label={t('nav.profile')}>
                  <Link to="/reading" className={styles.row}>
                    <span className={styles.rowText}><b>{t('prof2.myReading')}</b><small>{t('prof2.myReadingHint')}</small></span>
                    <span className={styles.rowChev} aria-hidden="true">›</span>
                  </Link>
                  <Link to="/readers" className={styles.row}>
                    <span className={styles.rowText}><b>{t('prof2.friends')}</b><small>{t('prof2.friendsHint')}</small></span>
                    <span className={styles.rowChev} aria-hidden="true">›</span>
                  </Link>
                  <button type="button" className={styles.row} aria-expanded={inviteOpen} onClick={() => setInviteOpen((o) => !o)}>
                    <span className={styles.rowText}><b>{t('prof2.invite')}</b><small>{t('prof2.inviteHint')}</small></span>
                    <span className={`${styles.rowChev} ${inviteOpen ? styles.rowChevOpen : ''}`} aria-hidden="true">›</span>
                  </button>
                  {inviteOpen && (
                    <section id="invite" className={styles.rowBody}>
                      <InviteFriends />
                    </section>
                  )}
                  {(!hasClaims || claimOpen) && <button type="button" className={styles.row} aria-expanded={claimOpen} onClick={() => setClaimOpen((o) => !o)}>
                    <span className={styles.rowText}><b>{t('prof2.claim')}</b><small>{t('prof2.claimHint')}</small></span>
                    <span className={`${styles.rowChev} ${claimOpen ? styles.rowChevOpen : ''}`} aria-hidden="true">›</span>
                  </button>}
                  {claimOpen && (
                    <section id="claim" className={`${styles.rowBody} ${claimLit ? styles.sectionLit : ''}`}>
                      <p className={styles.sectionHint}>{t('claims.subtitle')}</p>
                      <ClaimPicker onChange={load} />
                    </section>
                  )}
                  {helpOn ? (
                    <button type="button" className={styles.row} onClick={() => { setHelpOpen(true); track('help_open', { from: 'profile' }); }}>
                      <span className={styles.rowText}><b>{t('help.profileRow')}</b><small>{t('prof2.howItWorksHint')}</small></span>
                      <span className={styles.rowChev} aria-hidden="true">›</span>
                    </button>
                  ) : (
                    <Link to="/welcome#powerbook" className={styles.row}>
                      <span className={styles.rowText}><b>{t('prof2.howItWorks')}</b><small>{t('prof2.howItWorksHint')}</small></span>
                      <span className={styles.rowChev} aria-hidden="true">›</span>
                    </Link>
                  )}
                  <a href="https://t.me/+ZSmueLtmT8Y1MDBi" target="_blank" rel="noopener noreferrer" className={styles.row}>
                    <span className={styles.rowText}><b>{t('prof2.telegram')}</b></span>
                    <span className={styles.rowChev} aria-hidden="true">↗</span>
                  </a>
                  <Link to="/profile" className={styles.row}>
                    <span className={styles.rowText}><b>{t('nav.settings')}</b></span>
                    <span className={styles.rowChev} aria-hidden="true">›</span>
                  </Link>
                </nav>
                {helpOn && <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} />}

                {/* the rarely needed, quietly: the app only while it isn't installed yet; the ideas box for whoever has one */}
                <p className={styles.quiet}>
                  {!isStandalone() && <Link to="/get">{t('prof2.app')}</Link>}
                  <Link to={isAdmin ? '/suggestions/admin' : '/suggestions'}>
                    {isAdmin ? t('suggestionsAdmin.navLink') : t('prof2.idea')}
                  </Link>
                  <button type="button" className={styles.quietBtn} onClick={() => { logout(); navigate('/'); }}>{t('header.logout')}</button>
                </p>

                {(archetype || shelfBooks.some((b) => (b.minutes_read ?? 0) > 0)) && (
                  <h2 className={styles.aboutTitle}>{t('prof2.aboutYou')}</h2>
                )}
                {archetype && (
                  <Card variant="glass" padding="lg" className={styles.archetypeCard}>
                    <div className={styles.archetypeKicker}>{t('insights.yourType')}</div>
                    <div className={styles.archetypeTitle}>{archetypeTitle}</div>
                    <div className={styles.archetypeDesc}>{archetypeDesc}</div>
                    <div className={styles.kindred}>
                      <div className={styles.kindredLabel}>{t('insights.kindred')}</div>
                      <div className={styles.kindredName}>{t(`archetype.${archetype.key}.kindred`)}</div>
                      <div className={styles.kindredWhy}>{t(`archetype.${archetype.key}.kindredWhy`)}</div>
                    </div>
                    {funFactText && <div className={styles.archetypeFunFact}>{funFactText}</div>}
                  </Card>
                )}

                {shelfBooks.some((b) => (b.minutes_read ?? 0) > 0) && (
                  <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>{t('bookTime.title')}</h2>
                    <BookTime books={shelfBooks} isSelf />
                  </section>
                )}

                {user && <ProfileListings userId={user.id} isSelf titleClass={styles.sectionTitle} />}

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
            </div>
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

