import { useEffect, useRef, useState } from 'react';
import { apiPost, track, useI18n, type MyClaim } from '@/shared/lib';
import styles from './ClaimPicker.module.css';

type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

/**
 * «Подтвердить через Telegram»: Telegram's own login shows the old nickname is
 * the reader's, and the archive kept under it becomes theirs at once — no
 * waiting for the founder's ✅. A nickname changed since then finds nothing;
 * the search and «Это я» below are still there for that.
 */
export function TelegramClaim({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const widgetRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state !== 'idle') return;
    const w = window as unknown as Record<string, unknown>;
    w.onTelegramClaim = async (user: TelegramUser) => {
      setState('sending');
      setError(null);
      const { data, error: apiError } = await apiPost<MyClaim[]>('/claims/telegram', user, { requireAuth: true });
      if (apiError || !data) {
        setError(apiError === 'No archive under this Telegram' ? t('claims.tgNothing') : t('claims.tgFailed'));
        setState('idle');
        return;
      }
      track('claim_submit', { from: 'telegram' });
      setState('done');
      onDone();
    };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', 'PowerbookKZBot');
    script.setAttribute('data-size', 'medium');
    script.setAttribute('data-onauth', 'onTelegramClaim(user)');
    script.async = true;
    const host = widgetRef.current;
    host?.appendChild(script);

    return () => {
      delete w.onTelegramClaim;
      host?.replaceChildren();
    };
  }, [state, onDone, t]);

  if (state === 'done') return <div className={styles.tgClaim}>{t('claims.tgDone')}</div>;

  return (
    <div className={styles.tgClaim}>
      <div className={styles.hint}>{t('claims.tgHint')}</div>
      {state === 'sending' ? <div className={styles.hint}>{t('claims.claiming')}</div> : <div ref={widgetRef} />}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
