import { useCallback, useEffect, useState } from 'react';
import { useI18n, apiGet, apiPost, apiDelete, type ClaimCandidate, type MyClaim } from '@/shared/lib';
import { Button } from '@/shared/ui';
import styles from './ClaimPicker.module.css';

/** How many round labels a collapsed list shows before the toggle. */
const COLLAPSED_ROUNDS = 4;

/**
 * A reader who has been around since 2021 carries fifty-odd round labels, and
 * printed in full they bury the name they belong to. Four of them plus a count
 * says the same thing; the rest are one tap away for anyone checking.
 */
function RoundList({ rounds, className }: { rounds: string[]; className: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  if (rounds.length <= COLLAPSED_ROUNDS + 2) {
    return <span className={className}>{rounds.join(', ')}</span>;
  }

  const shown = expanded ? rounds : rounds.slice(0, COLLAPSED_ROUNDS);

  return (
    <span className={className}>
      {shown.join(', ')}
      {expanded ? ' ' : '… '}
      <button
        type="button"
        className={styles.roundsToggle}
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
      >
        {expanded
          ? t('claims.roundsCollapse')
          : t('claims.roundsMore', { count: rounds.length - COLLAPSED_ROUNDS })}
      </button>
    </span>
  );
}

interface ClaimPickerProps {
  onChange?: () => void;
}

export function ClaimPicker({ onChange }: ClaimPickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ClaimCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [myClaims, setMyClaims] = useState<MyClaim[]>([]);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMyClaims = useCallback(async () => {
    const { data } = await apiGet<MyClaim[]>('/claims/mine', { requireAuth: true });
    if (data) setMyClaims(data);
  }, []);

  useEffect(() => {
    loadMyClaims();
  }, [loadMyClaims]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      const { data } = await apiGet<ClaimCandidate[]>(
        `/claims/search?q=${encodeURIComponent(query.trim())}`,
        { requireAuth: true }
      );
      setResults(data ?? []);
      setSearching(false);
    }, 350);
    return () => clearTimeout(handle);
  }, [query]);

  const claim = async (candidate: ClaimCandidate) => {
    setSubmittingId(candidate.user_id);
    setError(null);
    const { error: apiError } = await apiPost('/claims', { ghost_user_id: candidate.user_id }, { requireAuth: true });
    setSubmittingId(null);
    if (apiError) {
      setError(apiError);
      return;
    }
    setQuery('');
    setResults([]);
    await loadMyClaims();
    onChange?.();
  };

  const unclaim = async (claimId: string) => {
    await apiDelete(`/claims/${claimId}`, { requireAuth: true });
    await loadMyClaims();
    onChange?.();
  };

  const approvedClaims = myClaims.filter((c) => c.status === 'approved');
  const pendingClaims = myClaims.filter((c) => c.status === 'pending');
  const claimedIds = new Set(approvedClaims.map((c) => c.ghost_user_id));
  const pendingIds = new Set(pendingClaims.map((c) => c.ghost_user_id));

  return (
    <div className={styles.wrap}>
      <input
        className={styles.input}
        type="text"
        placeholder={t('claims.searchPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {error && <div className={styles.error}>{error}</div>}

      {results.length > 0 && (
        <ul className={styles.results}>
          {results.map((c) => (
            <li key={c.user_id} className={styles.resultRow}>
              <div className={styles.resultInfo}>
                <div className={styles.resultName}>
                  {c.display_name} <span className={styles.resultUsername}>@{c.username}</span>
                </div>
                <RoundList rounds={c.rounds} className={styles.resultRounds} />
              </div>
              <Button
                size="sm"
                variant={claimedIds.has(c.user_id) || pendingIds.has(c.user_id) ? 'secondary' : 'primary'}
                disabled={
                  submittingId === c.user_id ||
                  claimedIds.has(c.user_id) ||
                  pendingIds.has(c.user_id)
                }
                onClick={() => claim(c)}
              >
                {claimedIds.has(c.user_id)
                  ? t('claims.claimed')
                  : pendingIds.has(c.user_id)
                    ? t('claims.pending')
                    : submittingId === c.user_id
                      ? t('claims.claiming')
                      : t('claims.claimBtn')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {searching && <div className={styles.hint}>{t('claims.searching')}</div>}
      {!searching && query.trim().length >= 2 && results.length === 0 && (
        <div className={styles.hint}>{t('claims.noResults')}</div>
      )}

      {pendingClaims.length > 0 && (
        <div className={styles.myClaims}>
          <div className={styles.myClaimsLabel}>{t('claims.pendingLabel')}</div>
          <div className={styles.hint}>{t('claims.pendingHint')}</div>
          {pendingClaims.map((c) => (
            <div key={c.id} className={styles.myClaimRow}>
              <div className={styles.myClaimInfo}>
                <span className={styles.myClaimName}>{c.ghost_display_name}</span>
                <RoundList rounds={c.rounds} className={styles.myClaimRounds} />
              </div>
              <button className={styles.unclaimBtn} onClick={() => unclaim(c.id)}>
                {t('claims.cancelRequest')}
              </button>
            </div>
          ))}
        </div>
      )}

      {approvedClaims.length > 0 && (
        <div className={styles.myClaims}>
          <div className={styles.myClaimsLabel}>{t('claims.myClaimsLabel')}</div>
          {approvedClaims.map((c) => (
            <div key={c.id} className={styles.myClaimRow}>
              <div className={styles.myClaimInfo}>
                <span className={styles.myClaimName}>{c.ghost_display_name}</span>
                <RoundList rounds={c.rounds} className={styles.myClaimRounds} />
              </div>
              <button className={styles.unclaimBtn} onClick={() => unclaim(c.id)}>
                {t('claims.unclaim')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
