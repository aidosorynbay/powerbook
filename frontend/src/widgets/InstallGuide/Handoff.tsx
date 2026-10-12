import { useEffect, useState } from 'react';
import { track, useI18n } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import styles from './InstallGuide.module.css';

/**
 * From a computer the app cannot be installed on the phone directly, so the
 * computer hands over: a QR code to point the camera at, or the link sent
 * to oneself in Telegram or WhatsApp. Each way carries its own ?source=
 * so analytics can tell which one people actually use.
 */
export function Handoff({ source, compact = false }: { source: string; compact?: boolean }) {
  const { t } = useI18n();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const link = (channel: string) => `${window.location.origin}/get?source=${channel}`;

  useEffect(() => {
    let alive = true;
    // The encoder is only needed here, so it loads only here.
    import('qrcode')
      .then((QR) => QR.toDataURL(link('qr'), { width: 240, margin: 1, color: { dark: '#0D1117', light: '#FFFFFF' } }))
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => {
        /* no QR: the link buttons still work */
      });
    return () => {
      alive = false;
    };
  }, []);

  const send = (channel: 'telegram' | 'whatsapp') => {
    track('handoff_click', { channel, source });
    const text = t('install.share.text');
    const url = link(channel);
    const href =
      channel === 'telegram'
        ? `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
        : `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
    window.open(href, '_blank', 'noopener');
  };

  const copy = async () => {
    track('handoff_click', { channel: 'copy', source });
    try {
      await navigator.clipboard.writeText(link('copy'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t('install.desktop.copy'), link('copy'));
    }
  };

  return (
    <div className={`${styles.handoff} ${compact ? styles.handoffCompact : ''}`}>
      <div className={styles.qrBox}>
        {qr ? (
          <img src={qr} alt={t('install.desktop.qr')} width={120} height={120} className={styles.qr} />
        ) : (
          <div className={styles.qrEmpty} aria-hidden="true" />
        )}
      </div>
      <div className={styles.handoffText}>
        {!compact && <h3 className={styles.handoffTitle}>{t('install.desktop.title')}</h3>}
        <p className={styles.handoffLead}>{t('install.desktop.text')}</p>
        <div className={styles.handoffButtons}>
          <button type="button" className={styles.chip} onClick={() => send('telegram')}>
            <Icon name="telegram" size="sm" aria-hidden="true" />
            {t('install.desktop.telegram')}
          </button>
          <button type="button" className={styles.chip} onClick={() => send('whatsapp')}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 20l1.3-3.9A8 8 0 1 1 8.2 19L4 20z" />
              <path d="M9.5 9.5c.3 1.7 2 3.6 3.9 4.2l1.1-1.1 1.9.9c-.3 1.3-1.3 1.8-2.4 1.6-2.6-.5-5.3-3.3-5.8-5.8-.2-1.1.3-2.1 1.6-2.4l.9 1.9-1.2.7z" />
            </svg>
            {t('install.desktop.whatsapp')}
          </button>
          <button type="button" className={styles.chip} onClick={copy} aria-live="polite">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V6a2 2 0 0 1 2-2h9" />
            </svg>
            {copied ? t('install.copied') : t('install.desktop.copy')}
          </button>
        </div>
      </div>
    </div>
  );
}
