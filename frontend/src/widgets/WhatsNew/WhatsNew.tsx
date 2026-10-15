import { useState } from 'react';
import { track, useI18n } from '@/shared/lib';
import { Button } from '@/shared/ui';
import { Sheet } from '@/widgets/RoundToday';
import rt from '@/widgets/RoundToday/RoundToday.module.css';
import styles from './WhatsNew.module.css';

const KEY = 'pb.nav2.seen';

/**
 * Once, for members who knew the old places: four lines on where Архив, Результаты, Топ, the language, the theme
 * and the settings went when the menu became four places (2026-10-14). «Понятно» closes it for good.
 */
export function WhatsNew() {
  const { t } = useI18n();
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== '1';
    } catch {
      return false;
    }
  });
  const close = () => {
    setOpen(false);
    track('whats_new_ok', {});
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // storage blocked: it may come back next visit, and that is all
    }
  };
  return (
    <Sheet open={open} onClose={close} label={t('wn.title')}>
      <h3 className={rt.sheetTitle}>{t('wn.title')}</h3>
      <p className={rt.sheetLead}>{t('wn.lead')}</p>
      <ul className={styles.list}>
        {[1, 2, 3, 4].map((n) => (
          <li key={n}>{t(`wn.${n}`)}</li>
        ))}
      </ul>
      <Button fullWidth onClick={close}>{t('wn.ok')}</Button>
    </Sheet>
  );
}
