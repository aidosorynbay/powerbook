import { useI18n } from '@/shared/lib';
import { MockSettingsTab, MockEditButton, MockUsernameField } from './PhoneMock';
import styles from './TelegramGuide.module.css';

/**
 * Why the Telegram handle is required, and how to make one if you have none.
 *
 * The three steps are folded away by default: most people arriving here
 * already have a handle, and for them this is one more thing between them
 * and the button.
 */
export function TelegramGuide() {
  const { t } = useI18n();

  const steps = [
    { key: 'step1', mock: <MockSettingsTab /> },
    { key: 'step2', mock: <MockEditButton /> },
    { key: 'step3', mock: <MockUsernameField /> },
  ];

  return (
    <div className={styles.guide}>
      <div className={styles.why}>
        <span className={styles.whyIcon} aria-hidden="true">@</span>
        <div>
          <div className={styles.whyTitle}>{t('tgGuide.whyTitle')}</div>
          <p className={styles.whyText}>{t('tgGuide.whyText')}</p>
        </div>
      </div>

      <details className={styles.details}>
        <summary className={styles.summary}>
          <span>{t('tgGuide.noneTitle')}</span>
          <span className={styles.chevron} aria-hidden="true">›</span>
        </summary>

        <ol className={styles.steps}>
          {steps.map((step, i) => (
            <li key={step.key} className={styles.step}>
              {step.mock}
              <div className={styles.stepBody}>
                <span className={styles.stepNum}>{i + 1}</span>
                <span className={styles.stepText}>{t(`tgGuide.${step.key}`)}</span>
              </div>
            </li>
          ))}
        </ol>

        <p className={styles.done}>{t('tgGuide.step4')}</p>
        <p className={styles.android}>{t('tgGuide.android')}</p>
      </details>
    </div>
  );
}
