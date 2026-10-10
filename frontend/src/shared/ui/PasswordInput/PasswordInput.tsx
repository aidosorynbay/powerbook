import { useState, type InputHTMLAttributes } from 'react';
import { useI18n } from '@/shared/lib';
import styles from './PasswordInput.module.css';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * A password field with an eye button that shows what was typed. On a phone
 * a mistyped password is easy to make and hard to see; the founder asked for
 * this on every password field of the site.
 */
export function PasswordInput({ className, ...props }: Props) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const label = shown ? t('password.hide') : t('password.show');

  return (
    <span className={styles.wrap}>
      <input {...props} type={shown ? 'text' : 'password'} className={className} />
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setShown((s) => !s)}
        // Keep the caret in the field: a click here should not take focus away.
        onMouseDown={(e) => e.preventDefault()}
        aria-label={label}
        aria-pressed={shown}
        title={label}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="3" />
          {shown && <path d="M4 4l16 16" />}
        </svg>
      </button>
    </span>
  );
}
