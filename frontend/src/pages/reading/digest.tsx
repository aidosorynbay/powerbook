import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, useI18n, type Digest, track } from '@/shared/lib';
import store from '../books/Store.module.css';
import styles from './Reading.module.css';


/** A letter: fetched if there is one, written on request, polled while Claude writes. */
export function useDigest(kind: 'period' | 'book' | 'round', scope: string | null) {
  const { locale } = useI18n();
  const [digest, setDigest] = useState<Digest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const poll = useRef<number>();

  const fetchIt = useCallback(async () => {
    if (!scope) return null;
    const { data } = await apiGet<Digest | null>(`/reading/digest?kind=${kind}&scope=${encodeURIComponent(scope)}&lang=${locale}`, { requireAuth: true });
    setDigest(data ?? null);
    return data ?? null;
  }, [kind, scope, locale]);

  useEffect(() => {
    setDigest(null);
    setError(null);
    fetchIt();
    return () => window.clearTimeout(poll.current);
  }, [fetchIt]);

  useEffect(() => {
    if (digest?.status !== 'working') return;
    let tries = 0;
    const tick = async () => {
      tries += 1;
      const next = await fetchIt();
      // As long as the server may still be writing (reading_ai._WORKING_FOR, six
      // minutes), so the page always sees the letter or the error.
      if (next?.status === 'working' && tries < 130) poll.current = window.setTimeout(tick, 3000);
    };
    poll.current = window.setTimeout(tick, 3000);
    return () => window.clearTimeout(poll.current);
  }, [digest?.status, digest?.id, fetchIt]);

  const start = async (force: boolean) => {
    if (!scope || starting) return;
    setStarting(true);
    setError(null);
    const { data, error: failed } = await apiPost<Digest>('/reading/digest', { kind, scope, lang: locale, force }, { requireAuth: true });
    setStarting(false);
    if (data) {
      setDigest(data);
      track('ai_digest_start', { kind, force });
    } else setError(failed);
  };

  return { digest, error, start, starting };
}

export function LetterError({ code }: { code: string | null }) {
  const { t } = useI18n();
  if (!code) return null;
  const key =
    code === 'ai_off' ? 'rd.letterOff' : code === 'ai_daily_limit' ? 'rd.letterLimit' : code === 'nothing_to_summarise' ? 'rd.letterNothing' : 'rd.letterError';
  return <p className={store.formNote}>{t(key)}</p>;
}

export function Working() {
  const { t } = useI18n();
  return (
    <p className={styles.working}>
      <span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>
      {t('rd.letterWorking')}
    </p>
  );
}

