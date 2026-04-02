import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n, apiPost } from '@/shared/lib';
import { Button, Card, Container, Logo, PageTransition } from '@/shared/ui';
import styles from './ForgotPasswordPage.module.css';

type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

type Step = 'verify' | 'set-password' | 'done';

export function ForgotPasswordPage() {
  const { t } = useI18n();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('verify');
  const [tgUser, setTgUser] = useState<TelegramUser | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (step !== 'verify') return;

    (window as unknown as Record<string, unknown>).onTelegramAuth = (user: TelegramUser) => {
      setTgUser(user);
      setStep('set-password');
    };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', 'PowerbookKZBot');
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    script.async = true;

    widgetRef.current?.appendChild(script);

    return () => {
      delete (window as unknown as Record<string, unknown>).onTelegramAuth;
    };
  }, [step]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t('forgotPassword.passwordMismatch'));
      return;
    }
    if (!tgUser) return;

    setIsSubmitting(true);
    const { error: apiError } = await apiPost('/auth/reset-password', {
      ...tgUser,
      new_password: password,
    });

    if (apiError) {
      setError(apiError === 'No account linked to this Telegram'
        ? t('forgotPassword.noAccount')
        : apiError === 'Telegram auth expired, please try again'
        ? t('forgotPassword.expired')
        : apiError);
      setIsSubmitting(false);
      return;
    }

    setStep('done');
    setIsSubmitting(false);
  };

  return (
    <PageTransition>
      <div className={styles.page}>
        <Container size="sm">
          <Card variant="glass" padding="lg" className={styles.card}>
            <div className={styles.header}>
              <div>
                <div className={styles.title}>{t('forgotPassword.title')}</div>
                <div className={styles.subtitle}>
                  {step === 'verify' && t('forgotPassword.subtitleVerify')}
                  {step === 'set-password' && t('forgotPassword.subtitleSetPassword')}
                  {step === 'done' && t('forgotPassword.subtitleDone')}
                </div>
              </div>
              <Link to="/" aria-label="Go to home">
                <Logo size="md" />
              </Link>
            </div>

            {step === 'verify' && (
              <div className={styles.verifyStep}>
                <p className={styles.hint}>{t('forgotPassword.hint')}</p>
                <div ref={widgetRef} className={styles.widget} />
              </div>
            )}

            {step === 'set-password' && (
              <>
                {error && <div className={styles.error}>{error}</div>}
                <div className={styles.tgConfirm}>
                  {t('forgotPassword.verifiedAs')}{' '}
                  <strong>
                    {tgUser?.username ? `@${tgUser.username}` : tgUser?.first_name}
                  </strong>
                </div>
                <form className={styles.form} onSubmit={onSubmit}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="password">
                      {t('forgotPassword.newPassword')}
                    </label>
                    <input
                      id="password"
                      className={styles.input}
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="confirm">
                      {t('forgotPassword.confirmPassword')}
                    </label>
                    <input
                      id="confirm"
                      className={styles.input}
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={6}
                    />
                  </div>
                  <Button type="submit" fullWidth disabled={isSubmitting}>
                    {isSubmitting ? t('forgotPassword.submitting') : t('forgotPassword.submit')}
                  </Button>
                </form>
              </>
            )}

            {step === 'done' && (
              <div className={styles.done}>
                <div className={styles.doneIcon}>✓</div>
                <p>{t('forgotPassword.successMessage')}</p>
                <Button fullWidth onClick={() => navigate('/login')}>
                  {t('forgotPassword.goLogin')}
                </Button>
              </div>
            )}

            {step !== 'done' && (
              <div className={styles.footer}>
                <Link className={styles.link} to="/login">
                  {t('forgotPassword.backToLogin')}
                </Link>
              </div>
            )}
          </Card>
        </Container>
      </div>
    </PageTransition>
  );
}
