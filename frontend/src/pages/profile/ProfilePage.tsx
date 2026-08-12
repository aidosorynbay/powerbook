import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  useAuth,
  useI18n,
  apiPut,
  apiGet,
  apiPost,
  apiDelete,
  resizeImageToDataUrl,
  type User,
  type Buddy,
} from '@/shared/lib';
import { Button, Card, Container, Logo, PageTransition, Avatar } from '@/shared/ui';
import styles from './ProfilePage.module.css';

type Gender = 'male' | 'female' | 'unknown';

export function ProfilePage() {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = () => {
    logout();
    navigate('/');
  };
  const { t } = useI18n();

  // Profile form
  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [telegramId, setTelegramId] = useState(user?.telegram_id ?? '');
  const [gender, setGender] = useState<Gender>((user?.gender as Gender) ?? 'unknown');
  const [avatarData, setAvatarData] = useState<string | null>(user?.avatar_data ?? null);
  const [recommendationText, setRecommendationText] = useState(user?.recommendation_text ?? '');
  const [readingMusicUrl, setReadingMusicUrl] = useState(user?.reading_music_url ?? '');
  const [favoriteBooks, setFavoriteBooks] = useState<string[]>(() => {
    const existing = user?.favorite_books ?? [];
    return [0, 1, 2].map((i) => existing[i] ?? '');
  });
  const [isSaving, setIsSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  // Password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  // Reading buddies
  const [buddies, setBuddies] = useState<Buddy[]>([]);
  const [followers, setFollowers] = useState<Buddy[]>([]);

  const loadBuddyData = async () => {
    const [mine, theirs] = await Promise.all([
      apiGet<Buddy[]>('/social/buddies/mine', { requireAuth: true }),
      apiGet<Buddy[]>('/social/buddies/followers', { requireAuth: true }),
    ]);
    if (mine.data) setBuddies(mine.data);
    if (theirs.data) setFollowers(theirs.data);
  };

  useEffect(() => {
    loadBuddyData();
  }, []);

  const removeBuddy = async (buddyId: string) => {
    await apiDelete(`/social/buddies/${buddyId}`, { requireAuth: true });
    setBuddies((prev) => prev.filter((b) => b.user_id !== buddyId));
  };

  const addBuddyBack = async (buddyId: string) => {
    await apiPost(`/social/buddies/${buddyId}`, {}, { requireAuth: true });
    await loadBuddyData();
  };

  const setFavoriteBookAt = (index: number, value: string) => {
    setFavoriteBooks((prev) => prev.map((b, i) => (i === index ? value : b)));
  };

  const onAvatarChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setAvatarData(dataUrl);
    } catch {
      setProfileError(t('error.validation'));
    }
  };

  const onSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);
    setIsSaving(true);

    const { error } = await apiPut<User>('/auth/profile', {
      username,
      email: email || null,
      display_name: displayName,
      telegram_id: telegramId.replace(/^@/, '') || null,
      gender,
      avatar_data: avatarData ?? '',
      recommendation_text: recommendationText,
      reading_music_url: readingMusicUrl,
      favorite_books: favoriteBooks.map((b) => b.trim()).filter(Boolean),
    }, { requireAuth: true });

    if (error) {
      setProfileError(error === 'error.network' || error === 'error.validation' ? t(error) : error);
    } else {
      setProfileSuccess(t('profile.saved'));
      await refreshUser();
    }
    setIsSaving(false);
  };

  const onChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword !== confirmPassword) {
      setPasswordError(t('profile.passwordMismatch'));
      return;
    }

    setIsChangingPassword(true);

    const { error } = await apiPut<{ detail: string }>('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    }, { requireAuth: true });

    if (error) {
      setPasswordError(error === 'error.network' || error === 'error.validation' ? t(error) : error);
    } else {
      setPasswordSuccess(t('profile.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
    setIsChangingPassword(false);
  };

  return (
    <PageTransition>
      <div className={styles.page}>
        <Container size="sm">
          <Card variant="glass" padding="lg" className={styles.card}>
            <div className={styles.header}>
              <div>
                <div className={styles.title}>{t('profile.title')}</div>
                <div className={styles.subtitle}>{t('profile.subtitle')}</div>
              </div>
              <Link to="/" aria-label="Go to home">
                <Logo size="md" />
              </Link>
            </div>

            {profileError && <div className={styles.error}>{profileError}</div>}
            {profileSuccess && <div className={styles.success}>{profileSuccess}</div>}

            <form className={styles.form} onSubmit={onSaveProfile}>
              <div className={styles.avatarField}>
                <Avatar src={avatarData} name={displayName || username} size="xl" />
                <label className={styles.avatarUploadBtn}>
                  {t('profile.changeAvatar')}
                  <input type="file" accept="image/*" onChange={onAvatarChange} hidden />
                </label>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="username">{t('profile.username')}</label>
                <input
                  id="username"
                  className={styles.input}
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  minLength={3}
                  maxLength={60}
                  pattern="[a-zA-Z0-9._\-]+"
                  required
                />
                <div className={styles.hint}>{t('register.usernameHint')}</div>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="email">{t('profile.email')}</label>
                <input
                  id="email"
                  className={styles.input}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="displayName">
                  {t('register.name')}
                </label>
                <input
                  id="displayName"
                  className={styles.input}
                  type="text"
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="telegramId">
                  {t('register.telegram')}
                </label>
                <input
                  id="telegramId"
                  className={styles.input}
                  type="text"
                  placeholder="@username"
                  value={telegramId}
                  onChange={(e) => setTelegramId(e.target.value)}
                />
                <div className={styles.hint}>{t('register.telegramHint')}</div>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="gender">
                  {t('register.gender')}
                </label>
                <select
                  id="gender"
                  className={styles.select}
                  value={gender}
                  onChange={(e) => setGender(e.target.value as Gender)}
                >
                  <option value="unknown">{t('register.genderUnknown')}</option>
                  <option value="male">{t('register.genderMale')}</option>
                  <option value="female">{t('register.genderFemale')}</option>
                </select>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="recommendation">
                  {t('profile.recommendationLabel')}
                </label>
                <textarea
                  id="recommendation"
                  className={styles.textarea}
                  value={recommendationText}
                  onChange={(e) => setRecommendationText(e.target.value)}
                  placeholder={t('profile.recommendationPlaceholder')}
                  maxLength={280}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="readingMusic">
                  {t('profile.readingMusicLabel')}
                </label>
                <input
                  id="readingMusic"
                  className={styles.input}
                  type="url"
                  value={readingMusicUrl}
                  onChange={(e) => setReadingMusicUrl(e.target.value)}
                  placeholder="https://open.spotify.com/..."
                />
                <div className={styles.hint}>{t('profile.readingMusicHint')}</div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>{t('profile.favoriteBooks')}</label>
                <div className={styles.hint}>{t('profile.favoriteBooksHint')}</div>
                <div className={styles.favoriteBooksList}>
                  {favoriteBooks.map((book, i) => (
                    <input
                      key={i}
                      className={styles.input}
                      type="text"
                      aria-label={`${t('profile.favoriteBooksLabel')} ${i + 1}`}
                      value={book}
                      onChange={(e) => setFavoriteBookAt(i, e.target.value)}
                      placeholder={`${t('profile.favoriteBooksPlaceholder')} ${i + 1}`}
                      maxLength={200}
                    />
                  ))}
                </div>
              </div>

              <Button type="submit" fullWidth disabled={isSaving}>
                {isSaving ? t('profile.saving') : t('profile.save')}
              </Button>
            </form>

            <hr className={styles.divider} />

            <div className={styles.sectionTitle}>{t('profile.myBuddies')}</div>
            {buddies.length === 0 ? (
              <div className={styles.hint}>{t('profile.noBuddies')}</div>
            ) : (
              <div className={styles.buddyList}>
                {buddies.map((b) => (
                  <div key={b.user_id} className={styles.buddyRow}>
                    <Link to={`/readers/${b.user_id}`} className={styles.buddyLink}>
                      <Avatar src={b.avatar_data} name={b.display_name} size="sm" />
                      <span>{b.display_name}</span>
                    </Link>
                    <button className={styles.buddyRemoveBtn} onClick={() => removeBuddy(b.user_id)}>
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
            <Link className={styles.link} to="/readers">
              {t('profile.viewDirectory')}
            </Link>

            <hr className={styles.divider} />

            <div className={styles.sectionTitle}>{t('profile.whoAddedYou')}</div>
            {followers.length === 0 ? (
              <div className={styles.hint}>{t('profile.noFollowers')}</div>
            ) : (
              <div className={styles.buddyList}>
                {followers.map((f) => {
                  const alreadyBuddy = buddies.some((b) => b.user_id === f.user_id);
                  return (
                    <div key={f.user_id} className={styles.buddyRow}>
                      <Link to={`/readers/${f.user_id}`} className={styles.buddyLink}>
                        <Avatar src={f.avatar_data} name={f.display_name} size="sm" />
                        <span>{f.display_name}</span>
                      </Link>
                      {!alreadyBuddy && (
                        <button className={styles.addBackBtn} onClick={() => addBuddyBack(f.user_id)}>
                          {t('profile.addBack')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <hr className={styles.divider} />

            <div className={styles.sectionTitle}>{t('profile.changePassword')}</div>

            {passwordError && <div className={styles.error}>{passwordError}</div>}
            {passwordSuccess && <div className={styles.success}>{passwordSuccess}</div>}

            <form className={styles.form} onSubmit={onChangePassword}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="currentPassword">
                  {t('profile.currentPassword')}
                </label>
                <input
                  id="currentPassword"
                  className={styles.input}
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="newPassword">
                  {t('profile.newPassword')}
                </label>
                <input
                  id="newPassword"
                  className={styles.input}
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="confirmPassword">
                  {t('profile.confirmPassword')}
                </label>
                <input
                  id="confirmPassword"
                  className={styles.input}
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>

              <Button type="submit" fullWidth disabled={isChangingPassword}>
                {isChangingPassword ? t('profile.changingPassword') : t('profile.changePassword')}
              </Button>
            </form>

            <div className={styles.footer}>
              <Link className={styles.link} to="/round">
                {t('header.currentRound')}
              </Link>
              <button type="button" className={styles.logoutBtn} onClick={onLogout}>
                {t('header.logout')}
              </button>
            </div>
          </Card>
        </Container>
      </div>
    </PageTransition>
  );
}
