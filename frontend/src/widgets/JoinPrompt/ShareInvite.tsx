import { useState } from 'react';
import { inviteLink, useI18n } from '@/shared/lib';
import { monthOf } from './words';
import styles from './JoinPrompt.module.css';

/** The reader's invitation link, and the ways to send it. */
export function ShareInvite({ refName, month, invited }: { refName: string | null; month: number; invited?: number }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const link = inviteLink(refName);
  const text = t('wl.shareText', { month: monthOf(t, month) });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const field = document.createElement('textarea');
      field.value = link;
      document.body.appendChild(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  };

  const native = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <div className={styles.share}>
      <div className={styles.shareHead}>
        <strong>{t('wl.share')}</strong>
        <span>{t('wl.shareHint')}</span>
      </div>
      <div className={styles.linkRow}>
        <input className={styles.linkField} value={link} readOnly onFocus={(e) => e.target.select()} aria-label={t('wl.copy')} />
        <button type="button" className={styles.copy} onClick={copy}>
          {copied ? t('wl.copied') : t('wl.copy')}
        </button>
      </div>
      <div className={styles.shareButtons}>
        <a
          className={`${styles.shareBtn} ${styles.telegram}`}
          href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Telegram
        </a>
        <a
          className={`${styles.shareBtn} ${styles.whatsapp}`}
          href={`https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          WhatsApp
        </a>
        {native && (
          <button type="button" className={styles.shareBtn} onClick={() => navigator.share({ title: 'PowerBook', text, url: link }).catch(() => undefined)}>
            {t('wl.shareMore')}
          </button>
        )}
      </div>
      {!!invited && <p className={styles.invited}>{t('wl.invitedN', { n: invited })}</p>}
    </div>
  );
}
