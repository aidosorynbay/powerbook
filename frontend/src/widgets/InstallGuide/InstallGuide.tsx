import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { track, useI18n } from '@/shared/lib';
import { useInstall } from '@/shared/hooks';
import { Button, Icon } from '@/shared/ui';
import { AndroidAddRow, AndroidInstall, AndroidMenu, IosAddButton, IosHomeRow, IosShare } from './InstallMocks';
import { Handoff } from './Handoff';
import styles from './InstallGuide.module.css';

/**
 * «PowerBook на экране „Домой“»: the one guide, shaped by what this device
 * can do. Android Chrome gets the real one-tap button; iPhone gets three
 * pictures, because Apple gives sites no install button; Telegram's and
 * Instagram's built-in browsers get «open this in Safari»; a computer gets
 * the hand-over to the phone; the installed app gets a tick.
 */

type Step = { mock: ReactNode; text: string };

function Steps({ steps, note, onDone }: { steps: Step[]; note?: string; onDone?: () => void }) {
  const { t } = useI18n();
  const [i, setI] = useState(0);
  const last = i === steps.length - 1;
  const step = steps[i];

  return (
    <div className={styles.steps}>
      <div className={styles.slide} key={i}>
        {step.mock}
        <p className={styles.stepText}>
          <span className={styles.stepNum}>{i + 1}</span>
          <span>{step.text}</span>
        </p>
      </div>
      <div className={styles.dots} role="status" aria-label={t('install.stepOf', { n: i + 1, m: steps.length })}>
        {steps.map((_, k) => (
          <span key={k} className={k === i ? styles.dotOn : styles.dot} />
        ))}
      </div>
      <div className={styles.nav}>
        {i > 0 ? (
          <Button variant="secondary" onClick={() => setI(i - 1)}>
            {t('install.back')}
          </Button>
        ) : (
          <span />
        )}
        {last ? (
          <Button onClick={onDone}>{t('install.gotIt')}</Button>
        ) : (
          <Button onClick={() => setI(i + 1)}>{t('install.next')}</Button>
        )}
      </div>
      {last && note && <p className={styles.note}>{note}</p>}
    </div>
  );
}

function Installed() {
  const { t } = useI18n();
  return (
    <div className={styles.done}>
      <span className={styles.doneIcon} aria-hidden="true">
        <Icon name="check" size="md" />
      </span>
      <h3 className={styles.doneTitle}>{t('install.installed.title')}</h3>
      <p className={styles.doneText}>{t('install.installed.text')}</p>
      <Link to="/round" className={styles.doneLink}>
        {t('install.open')}
      </Link>
    </div>
  );
}

function InApp({ source }: { source: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/get?source=inapp`;
  const copy = async () => {
    track('handoff_click', { channel: 'inapp_copy', source });
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t('install.inapp.copy'), link);
    }
  };
  return (
    <div className={styles.inapp}>
      <h3 className={styles.doneTitle}>{t('install.inapp.title')}</h3>
      <p className={styles.doneText}>{t('install.inapp.text')}</p>
      <Button onClick={copy}>{copied ? t('install.copied') : t('install.inapp.copy')}</Button>
      <p className={styles.note}>{t('install.inapp.hint')}</p>
    </div>
  );
}

export function InstallGuideBody({ source, onDone }: { source: string; onDone?: () => void }) {
  const { t } = useI18n();
  const { state, env, prompt } = useInstall();
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<'accepted' | 'dismissed' | 'unavailable' | null>(null);

  useEffect(() => {
    track('install_guide_view', { state, source });
    // Once, for the state the guide opened in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'installed' || outcome === 'accepted') return <Installed />;
  if (state === 'inapp') return <InApp source={source} />;
  if (state === 'desktop') return <Handoff source={source} />;

  if (state === 'prompt' && !manual) {
    const tap = async () => {
      setBusy(true);
      const result = await prompt();
      setBusy(false);
      setOutcome(result);
      if (result === 'unavailable') setManual(true);
    };
    return (
      <div className={styles.promptBlock}>
        <Button size="lg" onClick={tap} disabled={busy}>
          {busy ? t('install.installing') : t('install.button')}
        </Button>
        {outcome === 'dismissed' && <p className={styles.note}>{t('install.dismissed')}</p>}
        <button type="button" className={styles.linkButton} onClick={() => setManual(true)}>
          {t('install.manual')}
        </button>
      </div>
    );
  }

  if (state === 'ios') {
    const steps: Step[] = [
      { mock: <IosShare />, text: t('install.ios.step1') },
      { mock: <IosHomeRow />, text: t('install.ios.step2') },
      { mock: <IosAddButton />, text: t('install.ios.step3') },
    ];
    return <Steps steps={steps} note={env.browser === 'chrome' ? t('install.ios.chrome') : undefined} onDone={onDone} />;
  }

  const steps: Step[] = [
    { mock: <AndroidMenu />, text: t('install.android.step1') },
    { mock: <AndroidAddRow />, text: t('install.android.step2') },
    { mock: <AndroidInstall />, text: t('install.android.step3') },
  ];
  return <Steps steps={steps} note={env.browser === 'samsung' ? t('install.android.samsung') : undefined} onDone={onDone} />;
}

/** The guide as a sheet over the current page. */
export function InstallSheet({ open, onClose, source }: { open: boolean; onClose: () => void; source: string }) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className={styles.close} onClick={onClose} aria-label={t('install.close')}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <h2 id="install-sheet-title" className={styles.title}>
          {t('install.title')}
        </h2>
        <p className={styles.lead}>{t('install.lead')}</p>
        <InstallGuideBody source={source} onDone={onClose} />
      </div>
    </div>
  );
}
