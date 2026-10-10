import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, useI18n, apiPost, type TokenResponse } from '@/shared/lib';
import { Button, Card, Container, Logo, PageTransition, PasswordInput } from '@/shared/ui';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const { t } = useI18n();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claimArmed = searchParams.get('redirect') === '/claim';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const { data, error: apiError } = await apiPost<TokenResponse>('/auth/login', { login: username, password });

    if (apiError) {
      // Translate known error keys
      setError(apiError === 'error.network' || apiError === 'error.validation' ? t(apiError) : apiError);
      setIsSubmitting(false);
      return;
    }

    if (data) {
      login(data.access_token);
      const redirect = searchParams.get('redirect');
      const safeRedirect = redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/';
      navigate(safeRedirect);
    }
    setIsSubmitting(false);
  };

  return (
    <PageTransition>
      <div className={styles.page}>
        <Container size="sm">
        <Card variant="glass" padding="lg" className={styles.card}>
          <div className={styles.header}>
            <div>
              <div className={styles.title}>{t('login.title')}</div>
              <div className={styles.subtitle}>{t('login.subtitle')}</div>
            </div>
            <Link to="/" aria-label="Go to home">
              <Logo size="md" />
            </Link>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <form className={styles.form} onSubmit={onSubmit}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="username">
                {t('login.username')}
              </label>
              <input
                id="username"
                className={styles.input}
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
              <div className={styles.hint}>{t('login.usernameHint')}</div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="password">
                {t('login.password')}
              </label>
              <PasswordInput
                id="password"
                className={styles.input}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <Button type="submit" fullWidth disabled={isSubmitting}>
              {isSubmitting ? t('login.submitting') : t('login.submit')}
            </Button>
          </form>

          {/* Most people arriving here read in the circles for years before
              the site existed. Finding that history is the first thing they
              want, so it sits with the form rather than behind a menu.
              Once armed, signing in lands on the search instead of home. */}
          {claimArmed ? (
            <div className={`${styles.claimCta} ${styles.claimCtaArmed}`}>
              <span className={styles.claimCtaTitle}>{t('login.claimArmedTitle')}</span>
              <span className={styles.claimCtaText}>{t('login.claimArmedText')}</span>
            </div>
          ) : (
            <Link to="/login?redirect=%2Fclaim" className={styles.claimCta}>
              <span className={styles.claimCtaTitle}>{t('login.claimTitle')}</span>
              <span className={styles.claimCtaText}>{t('login.claimText')}</span>
            </Link>
          )}

          <div className={styles.footer}>
            <span>{t('login.noAccount')}</span>
            <Link className={styles.link} to={searchParams.get('redirect') ? `/register?redirect=${encodeURIComponent(searchParams.get('redirect') ?? '/')}` : '/register'}>
              {t('login.goRegister')}
            </Link>
          </div>
          <div className={styles.footer} style={{ justifyContent: 'center' }}>
            <Link className={styles.link} to="/forgot-password">
              {t('login.forgotPassword')}
            </Link>
          </div>
        </Card>
        </Container>
      </div>
    </PageTransition>
  );
}

