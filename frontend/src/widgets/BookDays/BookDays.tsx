import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiGet, apiPut, track, useI18n, type BookDays as Days } from '@/shared/lib';
import { Button } from '@/shared/ui';
import { Sheet } from '@/pages/books/bookUi';
import { dayDate } from '@/widgets/ShareDay/shareText';
import styles from './BookDays.module.css';

type Props = {
  /** The book by the title its days are logged under and the day it was finished… */
  title?: string;
  day?: string;
  /** …or a book of the reader's shelf, whatever title it shows now. */
  volumeKey?: string;
  onClose: () => void;
  /** The days were saved: whatever shows the book's time may want it again. */
  onSaved?: () => void;
};

/** «14 ч 20 мин». */
function formatMinutes(minutes: number, h: string, m: string): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} ${m}`;
  return rest ? `${hours} ${h} ${rest} ${m}` : `${hours} ${h}`;
}

/**
 * «Дни чтения»: the reader goes through the days before they finished a
 * book and says which were its, and how many minutes. What they say stands
 * over whatever was guessed from the days with no book named.
 */
export function BookDays({ title, day, volumeKey, onClose, onSaved }: Props) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<Days | null>(null);
  const [failed, setFailed] = useState(false);
  const [minutes, setMinutes] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const take = (found: Days) => {
    setData(found);
    setMinutes(Object.fromEntries(found.days.map((d) => [d.date, d.minutes])));
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      const qs = new URLSearchParams(volumeKey ? { volume_key: volumeKey } : { title: title ?? '', day: day ?? '' });
      const { data: found } = await apiGet<Days>(`/library/book-days?${qs}`, { requireAuth: true });
      if (!alive) return;
      if (found) take(found);
      else setFailed(true);
    })();
    return () => {
      alive = false;
    };
  }, [title, day, volumeKey]);

  const set = (date: string, value: number) => {
    setSaved(false);
    setMinutes((prev) => ({ ...prev, [date]: value }));
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    const { data: found } = await apiPut<Days>(
      '/library/book-days',
      { title: data.title, day: data.day, days: data.days.map((d) => ({ date: d.date, minutes: minutes[d.date] ?? 0 })) },
      { requireAuth: true }
    );
    setSaving(false);
    if (!found) return;
    take(found);
    setSaved(true);
    track('book_days_saved', { days: found.days_read });
    onSaved?.();
  };

  const total = Object.values(minutes).reduce((n, m) => n + (m || 0), 0);
  const count = Object.values(minutes).filter((m) => m > 0).length;

  return createPortal(
    // Above the round page's day window, which it opens from.
    <div className={styles.layer}>
      <Sheet label={t('bookDays.title', { title: data?.title ?? title ?? '' })} onClose={onClose}>
        <p className={styles.hint}>{t('bookDays.hint')}</p>
        {!data && !failed && <p className={styles.hint}>{t('chat.loading')}</p>}
        {failed && <p className={styles.hint}>{t('bookDays.failed')}</p>}
        {data && (
          <>
            <p className={styles.total}>
              {t('shelf.factTimeDays', { time: formatMinutes(total, t('rings.hoursShort'), t('rings.minutesShort')), days: count })}
            </p>
            {data.days.length === 0 && <p className={styles.hint}>{t('bookDays.empty')}</p>}
            <ul className={styles.days}>
              {data.days.map((d) => {
                const on = (minutes[d.date] ?? 0) > 0;
                return (
                  <li key={d.date} className={on ? styles.on : ''}>
                    <label className={styles.tick}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={d.finish}
                        onChange={() => set(d.date, on ? 0 : d.offer || d.total)}
                      />
                      <span>
                        <strong>
                          {dayDate(d.date, locale)}
                          {d.finish && ` · ${t('bookDays.finishDay')}`}
                        </strong>
                        <small>
                          {t('bookDays.ofDay', { n: d.total })}
                          {d.others.length > 0 && ` · ${d.others.map((o) => `«${o.title}» ${o.minutes}`).join(', ')}`}
                        </small>
                      </span>
                    </label>
                    {on && (
                      <span className={styles.minutes}>
                        <input
                          type="number"
                          min="1"
                          max={d.total}
                          inputMode="numeric"
                          value={String(minutes[d.date])}
                          aria-label={t('readingBooks.minutesFor', { title: data.title })}
                          onChange={(e) => set(d.date, Math.min(d.total, Math.max(d.finish ? 1 : 0, parseInt(e.target.value, 10) || 0)))}
                        />
                        {t('readingBooks.min')}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className={styles.actions}>
              <Button onClick={save} disabled={saving}>
                {saving ? t('dashboard.saving') : t('dashboard.save')}
              </Button>
              {saved && <span className={styles.hint}>{t('bookDays.saved')}</span>}
            </div>
          </>
        )}
      </Sheet>
    </div>,
    document.body
  );
}
