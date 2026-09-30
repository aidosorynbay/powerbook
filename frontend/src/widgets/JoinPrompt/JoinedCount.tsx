import { useI18n } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import styles from './JoinedCount.module.css';

/** «12 · уже записались на круг «Октябрь»»: how many are in the circle that is open for sign-up. */
export function JoinedCount({ n, month, className = '' }: { n: number; month: number; className?: string }) {
  const { t } = useI18n();
  const name = t(`month.${month}`);
  return (
    <div className={`${styles.joined} ${className}`} role="status" aria-label={t('wl.joinedN', { month: name, n })}>
      <span className={styles.icon} aria-hidden="true">
        <Icon name="users" size="md" />
      </span>
      <strong className={styles.n} aria-hidden="true">
        {n}
      </strong>
      <span className={styles.label} aria-hidden="true">
        <span>{t('wl.joinedTop', { month: name })}</span>
        <span>{t('wl.joinedBottom', { month: name })}</span>
      </span>
    </div>
  );
}
