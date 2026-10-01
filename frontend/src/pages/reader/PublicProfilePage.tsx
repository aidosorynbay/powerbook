import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import { useI18n, apiGet, apiPost, apiDelete, type PublicProfile, type ShelfBook } from '@/shared/lib';
import { apiUrl } from '@/pages/books/bookUi';
import { Container, PageTransition, Avatar, Button, Card, BookCard, ProgressBar } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import { paletteFor, dimensionsFor } from '@/pages/library/bookcase/bookArt';
import { bookCount } from '@/pages/library/bookcase/plural';
import styles from './PublicProfilePage.module.css';
import { ProfileListings } from '../books/ProfileBits';

function getMusicEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('open.spotify.com')) {
      const path = u.pathname.replace(/^\/(intl-\w+\/)?/, '/');
      return `https://open.spotify.com/embed${path}`;
    }
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.slice(1);
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (u.hostname.includes('youtube.com')) {
      const id = u.searchParams.get('v');
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function PublicProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const { t, locale } = useI18n();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isTogglingBuddy, setIsTogglingBuddy] = useState(false);
  const [showBadges, setShowBadges] = useState(false);
  const [shelf, setShelf] = useState<ShelfBook[]>([]);

  const load = async () => {
    if (!userId) return;
    setIsLoading(true);
    const { data, error } = await apiGet<PublicProfile>(`/social/profile/${userId}`, { requireAuth: true });
    if (data) {
      setProfile(data);
      setLoadError(null);
    } else {
      // Never leave the page spinning: an archive-only account has no public
      // profile, and a transient failure needs to say so rather than hang.
      setLoadError(error ?? t('readers.profileUnavailable'));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (!userId) return;
    // Metadata only — the endpoint never exposes anyone's actual files.
    apiGet<ShelfBook[]>(`/library/shelf/${userId}`, { requireAuth: true }).then(({ data }) => {
      if (data) setShelf(data);
    });
  }, [userId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const toggleBuddy = async () => {
    if (!profile) return;
    setIsTogglingBuddy(true);
    if (profile.is_buddy) {
      await apiDelete(`/social/buddies/${profile.user_id}`, { requireAuth: true });
    } else {
      await apiPost(`/social/buddies/${profile.user_id}`, {}, { requireAuth: true });
    }
    await load();
    setIsTogglingBuddy(false);
  };

  const embedUrl = profile?.reading_music_url ? getMusicEmbedUrl(profile.reading_music_url) : null;

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container size="sm">
            {isLoading ? (
              <div className={styles.loading}>{t('dashboard.loading')}</div>
            ) : !profile ? (
              <div className={styles.loading}>{loadError ?? t('readers.profileUnavailable')}</div>
            ) : (
              <>
                <div className={styles.hero}>
                  <Avatar src={profile.avatar_data} name={profile.display_name} size="xl" />
                  <div className={styles.name}>{profile.display_name}</div>
                  {profile.archetype_key && (
                    <div className={styles.archetype}>
                      {t(
                        `archetype.${profile.archetype_key}.title`,
                        profile.archetype_weekday !== null
                          ? { weekday: t(`weekday.long.${profile.archetype_weekday}`) }
                          : undefined
                      )}
                    </div>
                  )}

                  {profile.is_archive && (
                    <div className={styles.archiveBanner}>{t('publicProfile.archiveNote')}</div>
                  )}

                  <div className={styles.actions}>
                    {/* An archive record has no one behind it yet — offering
                        "add as buddy" would promise something that can't
                        happen. The way in is to claim it. */}
                    {profile.is_archive ? (
                      <Link to="/claim" className={styles.claimLink}>
                        <Button variant="primary" size="sm">{t('publicProfile.claimThis')}</Button>
                      </Link>
                    ) : !profile.is_self && (
                      <Button
                        variant={profile.is_buddy ? 'secondary' : 'primary'}
                        size="sm"
                        onClick={toggleBuddy}
                        disabled={isTogglingBuddy}
                      >
                        {profile.is_buddy ? t('profile.removeBuddy') : t('profile.addBuddy')}
                      </Button>
                    )}
                    {profile.telegram_id && (
                      <a
                        href={`https://t.me/${profile.telegram_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.telegramBtn}
                      >
                        {t('profile.chatTelegram')}
                      </a>
                    )}
                  </div>
                </div>

                {(profile.books_finished > 0 || shelf.length > 0) && (
                  <Link to={profile.is_self ? '/library' : `/readers/${profile.user_id}/shelf`} className={styles.shelfCta}>
                    <span className={styles.shelfCtaText}>
                      <span className={styles.shelfCtaKicker}>{t('nav.library')}</span>
                      <span className={styles.shelfCtaTitle}>{t('shelf.profileCta')}</span>
                      <span className={styles.shelfCtaHint}>
                        {t('shelf.profileCtaHint', {
                          count: bookCount(locale, Math.max(profile.books_finished, shelf.length), t),
                        })}
                      </span>
                    </span>
                    {/* A few spines in the colours those books wear on the shelf itself. */}
                    <span className={styles.shelfCtaSpines} aria-hidden="true">
                      {[...profile.recent_books, ...shelf.map((b) => b.title)].slice(0, 7).map((title, i) => {
                        const seed = title.trim().toLowerCase();
                        const p = paletteFor(seed);
                        const d = dimensionsFor(seed);
                        return (
                          <span
                            key={i}
                            style={{
                              background: p.cover,
                              borderTopColor: p.accent,
                              height: `${Math.round(d.height * 26)}px`,
                              width: `${Math.round(d.thickness * 44)}px`,
                            }}
                          />
                        );
                      })}
                    </span>
                    <span className={styles.shelfCtaArrow} aria-hidden="true">→</span>
                  </Link>
                )}

                {profile.recommendation_text && (
                  <Card variant="glass" padding="lg" className={styles.recCard}>
                    <div className={styles.recKicker}>{t('profile.recommends')}</div>
                    <div className={styles.recCardBody}>
                      <div className={styles.recCover}>
                        <BookCard title={profile.recommendation_text} size="md" />
                      </div>
                      <div className={styles.recText}>&ldquo;{profile.recommendation_text}&rdquo;</div>
                    </div>
                  </Card>
                )}

                {/* The top-3 in their real covers, found the way the 3D shelf finds them.
                    The books themselves live on that shelf above; no second list of them here. */}
                {profile.favorite_books.length > 0 && (
                  <div className={styles.librarySection}>
                    <div className={styles.musicKicker}>{t('profile.favoriteBooks')}</div>
                    <div className={styles.libraryGrid}>
                      {profile.favorite_books.map((title, i) => (
                        <BookCard key={i} title={title} cover={apiUrl(profile.favorite_covers?.[i])} size="md" />
                      ))}
                    </div>
                  </div>
                )}

                {shelf.length > 0 && (
                  <div className={styles.librarySection}>
                    <div className={styles.musicKicker}>{t('profile.shelfNow')}</div>
                    <div className={styles.shelfGrid}>
                      {shelf.map((book, i) => (
                        <div key={i} className={styles.shelfItem}>
                          <div className={styles.shelfCover}>
                            {book.cover_data ? (
                              <img src={book.cover_data} alt="" className={styles.shelfCoverImg} />
                            ) : (
                              <span className={styles.shelfCoverText}>
                                {book.file_format.toUpperCase()}
                              </span>
                            )}
                            {book.progress_percent > 0 && (
                              <div className={styles.shelfBar}>
                                <div
                                  className={styles.shelfBarFill}
                                  style={{ width: `${book.progress_percent}%` }}
                                />
                              </div>
                            )}
                          </div>
                          <div className={styles.shelfTitle}>{book.title}</div>
                          <div className={styles.shelfMeta}>
                            {book.progress_percent >= 100
                              ? t('profile.shelfFinished')
                              : t('library.percentRead', { percent: book.progress_percent })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <ProfileListings userId={profile.user_id} isSelf={profile.is_self} titleClass={styles.musicKicker} />

                {embedUrl && (
                  <div className={styles.musicSection}>
                    <div className={styles.musicKicker}>{t('profile.readingMusic')}</div>
                    <iframe
                      className={styles.musicEmbed}
                      src={embedUrl}
                      title="Reading music"
                      frameBorder="0"
                      allow="autoplay; encrypted-media; clipboard-write; fullscreen; picture-in-picture"
                    />
                  </div>
                )}

                <div className={styles.statGrid}>
                  <div className={styles.stat}>
                    <div className={styles.statValue}>{profile.total_hours}</div>
                    <div className={styles.statLabel}>{t('insights.totalHours')}</div>
                  </div>
                  <div className={styles.stat}>
                    <div className={styles.statValue}>{profile.longest_streak_days}</div>
                    <div className={styles.statLabel}>{t('insights.longestStreak')}</div>
                  </div>
                  <div className={styles.stat}>
                    <div className={styles.statValue}>{profile.rounds_participated}</div>
                    <div className={styles.statLabel}>{t('insights.circles')}</div>
                  </div>
                  <div className={styles.stat}>
                    <div className={styles.statValue}>{profile.books_finished}</div>
                    <div className={styles.statLabel}>{t('insights.booksFinished')}</div>
                  </div>
                  <button
                    type="button"
                    className={`${styles.stat} ${styles.statClickable}`}
                    onClick={() => setShowBadges(true)}
                  >
                    <div className={styles.statValue}>{profile.badges_earned}</div>
                    <div className={styles.statLabel}>{t('profile.badgesEarned')}</div>
                  </button>
                </div>
              </>
            )}
          </Container>
        </main>
        <Footer />
      </div>

      {showBadges && profile && createPortal(
        <div className={styles.badgeOverlay} onClick={() => setShowBadges(false)}>
          <div className={styles.badgeModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.badgeModalHeader}>
              <div className={styles.badgeModalTitle}>{t('profile.badgeModalTitle')}</div>
              <button className={styles.badgeModalClose} onClick={() => setShowBadges(false)} aria-label="Close">
                &times;
              </button>
            </div>
            <div className={styles.badgeModalGrid}>
              {profile.badges.map((b) => (
                <div
                  key={b.key}
                  className={`${styles.badgeModalCard} ${b.earned ? styles.badgeModalCardEarned : ''}`}
                >
                  <div className={styles.badgeModalIcon}>{b.earned ? '✓' : '○'}</div>
                  <div className={styles.badgeModalCardTitle}>{b.title}</div>
                  <div className={styles.badgeModalCardDesc}>{b.description}</div>
                  {!b.earned && (
                    <div className={styles.badgeModalProgress}>
                      <ProgressBar value={b.progress_current} max={b.progress_target} size="sm" />
                      <span className={styles.badgeModalProgressText}>
                        {b.progress_current}/{b.progress_target}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </PageTransition>
  );
}

