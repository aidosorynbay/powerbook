import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useI18n, apiPut, type User } from '@/shared/lib';
import { Button, Card, Container, Logo, PageTransition } from '@/shared/ui';
import styles from './ProfilePage.module.css';

type Gender = 'male' | 'female' | 'unknown';

export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const { t } = useI18n();

  // Profile form
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [telegramId, setTelegramId] = useState(user?.telegram_id ?? '');
  const [gender, setGender] = useState<Gender>((user?.gender as Gender) ?? 'unknown');
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

  const onSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);
    setIsSaving(true);

    const { error } = await apiPut<User>('/auth/profile', {
      display_name: displayName,
      telegram_id: telegramId.replace(/^@/, '') || null,
      gender,
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

              <Button type="submit" fullWidth disabled={isSaving}>
                {isSaving ? t('profile.saving') : t('profile.save')}
              </Button>
            </form>

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
            </div>
          </Card>
        </Container>
      </div>
    </PageTransition>
  );
}
