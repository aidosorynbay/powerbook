import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useI18n, apiPost, type Suggestion } from '@/shared/lib';
import { Button, Card, Container, PageTransition } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import styles from './SuggestionsPage.module.css';

const DRAFT_KEY = 'suggestion_draft';

export function SuggestionsPage() {
  const { t } = useI18n();
  const { isAuthenticated, user } = useAuth();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Restore a draft left behind by "log in to use your username" — the
  // login round trip unmounts this page, so plain component state would
  // otherwise lose whatever the person had already typed.
  useEffect(() => {
    const saved = sessionStorage.getItem(DRAFT_KEY);
    if (saved) {
      try {
        const draft = JSON.parse(saved) as { name?: string; message?: string };
        if (draft.name) setName(draft.name);
        if (draft.message) setMessage(draft.message);
      } catch {
        // ignore malformed draft
      }
      sessionStorage.removeItem(DRAFT_KEY);
    }
  }, []);

  const goLoginKeepingDraft = () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ name, message }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const { error: err } = await apiPost<Suggestion>('/suggestions', {
      name: name.trim() || null,
      message: message.trim(),
    }, { requireAuth: true });

    if (err) {
      setError(err === 'error.network' || err === 'error.validation' ? t(err) : err);
    } else {
      setSubmitted(true);
    }
    setIsSubmitting(false);
  };

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />
        <main className={styles.main}>
          <Container size="sm">
            <Card variant="glass" padding="lg" className={styles.card}>
              <div className={styles.title}>{t('suggestions.title')}</div>
              <div className={styles.subtitle}>{t('suggestions.subtitle')}</div>

              {submitted ? (
                <div className={styles.success}>{t('suggestions.thanks')}</div>
              ) : (
                <form className={styles.form} onSubmit={onSubmit}>
                  {error && <div className={styles.error}>{error}</div>}

                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="suggestionName">
                      {t('suggestions.nameLabel')}
                    </label>
                    {isAuthenticated ? (
                      <div className={styles.asProfile}>
                        {t('suggestions.sendingAs', { name: user?.display_name ?? '' })}
                      </div>
                    ) : (
                      <>
                        <input
                          id="suggestionName"
                          className={styles.input}
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder={t('suggestions.namePlaceholder')}
                          maxLength={120}
                        />
                        <Link
                          to="/login?redirect=/suggestions"
                          className={styles.useProfileLink}
                          onClick={goLoginKeepingDraft}
                        >
                          {t('suggestions.useProfileLink')}
                        </Link>
                      </>
                    )}
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="suggestionMessage">
                      {t('suggestions.messageLabel')}
                    </label>
                    <textarea
                      id="suggestionMessage"
                      className={styles.textarea}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder={t('suggestions.messagePlaceholder')}
                      maxLength={4000}
                      required
                      rows={6}
                    />
                  </div>

                  <Button type="submit" fullWidth disabled={isSubmitting || !message.trim()}>
                    {isSubmitting ? t('suggestions.submitting') : t('suggestions.submit')}
                  </Button>
                </form>
              )}
            </Card>
          </Container>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
}
