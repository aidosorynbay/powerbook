import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, useI18n, apiPost, type TokenResponse } from '@/shared/lib';
import { Button, Card, Container, Logo, PageTransition } from '@/shared/ui';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { t } = useI18n();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      navigate('/');
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
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="password">
                {t('login.password')}
              </label>
              <input
                id="password"
                className={styles.input}
                type="password"
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

          <div className={styles.footer}>
            <span>{t('login.noAccount')}</span>
            <Link className={styles.link} to="/register">
              {t('login.goRegister')}
            </Link>
          </div>
        </Card>
        </Container>
      </div>
    </PageTransition>
  );
}

