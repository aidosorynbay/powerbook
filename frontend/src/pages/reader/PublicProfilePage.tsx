import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import { useI18n, apiGet, apiPost, apiDelete, type PublicProfile } from '@/shared/lib';
import { Container, PageTransition, Avatar, Button, Card, BookCard, ProgressBar } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import styles from './PublicProfilePage.module.css';

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
  const { t } = useI18n();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTogglingBuddy, setIsTogglingBuddy] = useState(false);
  const [showBadges, setShowBadges] = useState(false);

  const load = async () => {
    if (!userId) return;
    setIsLoading(true);
    const { data } = await apiGet<PublicProfile>(`/social/profile/${userId}`, { requireAuth: true });
    if (data) setProfile(data);
    setIsLoading(false);
  };

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
            {isLoading || !profile ? (
              <div className={styles.loading}>{t('dashboard.loading')}</div>
            ) : (
              <>
                <div className={styles.hero}>
                  <Avatar src={profile.avatar_data} name={profile.display_name} size="xl" />
                  <div className={styles.name}>{profile.display_name}</div>
                  {profile.archetype_title && (
                    <div className={styles.archetype}>{profile.archetype_title}</div>
                  )}

                  <div className={styles.actions}>
                    {!profile.is_self && (
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

                {profile.favorite_books.length > 0 && (
                  <div className={styles.librarySection}>
                    <div className={styles.musicKicker}>{t('profile.favoriteBooks')}</div>
                    <div className={styles.libraryGrid}>
                      {profile.favorite_books.map((title, i) => (
                        <BookCard key={i} title={title} size="sm" />
                      ))}
                    </div>
                  </div>
                )}

                {profile.recent_books.length > 0 && (
                  <div className={styles.librarySection}>
                    <div className={styles.musicKicker}>{t('profile.library')}</div>
                    <div className={styles.libraryGrid}>
                      {profile.recent_books.map((title, i) => (
                        <BookCard key={i} title={title} size="sm" />
                      ))}
                    </div>
                  </div>
                )}

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
