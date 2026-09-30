import { Link } from 'react-router-dom';
import { useI18n } from '@/shared/lib';
import { Icon, type IconName } from '@/shared/ui';
import styles from './RoundRules.module.css';

/**
 * What a circle asks of a reader, said before they join: whoever opens a
 * shared link to the round should know what it is and what signing up means,
 * the book exchange included.
 */
export function RoundRules({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const items: [IconName, string][] = [
    ['clock', t('wl.what1')],
    ['pen', t('rules.log')],
    ['users', t('wl.what2')],
    ['gift', t('wl.what3')],
    ['calendar', t('rules.dates')],
  ];
  return (
    <section className={`${styles.rules} ${compact ? styles.compact : ''}`} aria-label={t('rules.title')}>
      <h3>{t('rules.title')}</h3>
      <ul>
        {items.map(([icon, text]) => (
          <li key={icon}>
            <span className={styles.icon} aria-hidden="true">
              <Icon name={icon} size="sm" />
            </span>
            {text}
          </li>
        ))}
      </ul>
      <Link to="/#powerbook" className={styles.more}>
        {t('rules.more')}
      </Link>
    </section>
  );
}
