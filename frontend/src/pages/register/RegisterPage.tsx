import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, useI18n, apiPost, type TokenResponse } from '@/shared/lib';
import { Button, Card, Container, Logo } from '@/shared/ui';
import styles from './RegisterPage.module.css';

type Gender = 'male' | 'female' | 'unknown';

export function RegisterPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { t } = useI18n();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [gender, setGender] = useState<Gender>('unknown');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const { data, error: apiError } = await apiPost<TokenResponse>('/auth/register', {
      email,
      password,
      display_name: displayName,
      gender,
    });

    if (apiError) {
      setError(apiError === 'error.network' || apiError === 'error.validation' ? t(apiError) : apiError);
      setIsSubmitting(false);
      return;
    }

    if (data) {
      login(data.access_token);
      navigate('/');
    }
    setIsSubmitting(false);
  };

  return (
    <div className={styles.page}>
      <Container size="sm">
        <Card variant="glass" padding="lg" className={styles.card}>
          <div className={styles.header}>
            <div>
              <div className={styles.title}>{t('register.title')}</div>
              <div className={styles.subtitle}>{t('register.subtitle')}</div>
            </div>
            <Link to="/" aria-label="Go to home">
              <Logo size="md" />
            </Link>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <form className={styles.form} onSubmit={onSubmit}>
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
              <label className={styles.label} htmlFor="email">
                {t('register.email')}
              </label>
              <input
                id="email"
                className={styles.input}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="password">
                {t('register.password')}
              </label>
              <input
                id="password"
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
              <div className={styles.hint}>{t('register.passwordHint')}</div>
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

            <Button type="submit" fullWidth disabled={isSubmitting}>
              {isSubmitting ? t('register.submitting') : t('register.submit')}
            </Button>
          </form>

          <div className={styles.footer}>
            <span>{t('register.hasAccount')}</span>
            <Link className={styles.link} to="/login">
              {t('register.goLogin')}
            </Link>
          </div>
        </Card>
      </Container>
    </div>
  );
}

