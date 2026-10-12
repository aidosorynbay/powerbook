import { useEffect } from 'react';
import { track, useI18n } from '@/shared/lib';
import { Icon, Logo } from '@/shared/ui';
import { Handoff } from '@/widgets/InstallGuide';
import styles from './InstallLanding.module.css';

/**
 * The computer's front door. PowerBook is lived in on the phone, so a
 * visitor on a big screen is first offered the app on their phone: a QR
 * code and the link to send to oneself. «Продолжить на компьютере» is
 * there for the few who really came to use the site here, and is remembered.
 */
export function InstallLanding({ onContinue }: { onContinue: () => void }) {
  const { t } = useI18n();

  useEffect(() => {
    track('landing_view');
  }, []);

  return (
    <section className={styles.landing} aria-labelledby="landing-title">
      <header className={styles.top}>
        <Logo size="md" />
        <button type="button" className={styles.continue} onClick={onContinue}>
          {t('landing.continue')}
          <Icon name="arrow-right" size="sm" aria-hidden="true" />
        </button>
      </header>

      <div className={styles.body}>
        <div className={styles.copy}>
          <h1 id="landing-title" className={styles.title}>
            {t('landing.title')}
          </h1>
          <p className={styles.lead}>{t('landing.lead')}</p>
          <ul className={styles.points}>
            <li>{t('landing.point1')}</li>
            <li>{t('landing.point2')}</li>
            <li className={styles.pointHot}>{t('landing.point3')}</li>
          </ul>
          <div className={styles.handoff}>
            <Handoff source="landing" />
          </div>
        </div>

        <div className={styles.phoneWrap} aria-hidden="true">
          <div className={styles.phone}>
            <img src="/landing/phone-round.png" alt="" width={390} height={844} className={styles.screen} />
          </div>
        </div>
      </div>
    </section>
  );
}
