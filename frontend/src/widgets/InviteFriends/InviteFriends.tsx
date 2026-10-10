import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, formatSpent, inviteLink, KK_MONTHS, track, useI18n, type Invites, type Locale } from '@/shared/lib';
import { Avatar } from '@/shared/ui';
import { plural } from '@/pages/library/bookcase/plural';
import styles from './InviteFriends.module.css';

/** «5 окт.», «5 қазан», «Oct 5»: short, so a guest's line fits a phone. */
function dayLabel(iso: string, locale: Locale): string {
  const d = new Date(`${iso}T12:00:00`);
  if (locale === 'kk') return `${d.getDate()} ${KK_MONTHS[d.getMonth()]}`;
  return d.toLocaleDateString(locale === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'short' });
}

/**
 * «Приведи друга», after the Sadaqa app (the founder, 2026-10-10): the reader's own link, and what it has brought:
 * who signed up by it and the days and minutes they have read since, never pages; those they brought in turn too.
 */
export function InviteFriends() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<Invites | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiGet<Invites>('/share/invites', { requireAuth: true }).then(({ data }) => data && setData(data));
  }, []);
  if (!data) return null;

  const link = inviteLink(data.username);
  const text = t('invite.shareText');
  const sent = (channel: string) => track('invite_share', { channel, guests: data.direct.people });
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
    sent('copy');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  };
  const native = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const { direct, further, guests } = data;

  return (
    <div className={styles.card}>
      <p className={styles.hint}>{t('invite.hint')}</p>

      <input className={styles.linkField} value={link} readOnly onFocus={(e) => e.target.select()} aria-label={t('wl.copy')} />
      <div className={styles.buttons}>
        <button type="button" className={`${styles.btn} ${styles.copy}`} onClick={copy}>
          {copied ? t('wl.copied') : t('invite.copy')}
        </button>
        <a
          className={`${styles.btn} ${styles.telegram}`}
          href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => sent('telegram')}
        >
          Telegram
        </a>
        <a
          className={`${styles.btn} ${styles.whatsapp}`}
          href={`https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => sent('whatsapp')}
        >
          WhatsApp
        </a>
        {native && (
          <button
            type="button"
            className={styles.btn}
            onClick={() => {
              sent('native');
              navigator.share({ title: 'PowerBook', text, url: link }).catch(() => undefined);
            }}
          >
            {t('wl.shareMore')}
          </button>
        )}
      </div>

      {direct.people === 0 ? (
        <p className={styles.empty}>{t('invite.empty')}</p>
      ) : (
        <>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <b>{direct.people}</b>
              <span>{plural(locale, direct.people, { one: t('invite.people.one'), few: t('invite.people.few'), many: t('invite.people.many') })}</span>
            </div>
            <div className={styles.stat}>
              <b>{formatSpent(direct.minutes, t)}</b>
              <span>{t('invite.read')}</span>
            </div>
            <div className={styles.stat}>
              <b>{direct.days}</b>
              <span>{t('invite.days')}</span>
            </div>
          </div>
          {direct.finished > 0 && <p className={styles.note}>{t('invite.finished', { n: direct.finished })}</p>}
          {further.people > 0 && (
            <p className={styles.note}>{t('invite.further', { n: further.people, time: formatSpent(further.minutes, t) })}</p>
          )}

          <ul className={styles.list}>
            {guests.map((g) => (
              <li key={g.user_id}>
                <Link to={`/readers/${g.user_id}`} className={styles.row}>
                  <Avatar src={g.avatar_data} name={g.display_name} size="sm" />
                  <span className={styles.who}>
                    <span className={styles.name}>{g.display_name}</span>
                    <span className={styles.meta}>
                      {g.last_day
                        ? t('invite.last', { date: dayLabel(g.last_day, locale) })
                        : <>{g.joined && <>{t('invite.since', { date: dayLabel(g.joined, locale) })} · </>}{t('invite.notYet')}</>}
                      {g.brought > 0 && <> · {t('invite.brought', { n: g.brought })}</>}
                    </span>
                  </span>
                  {g.minutes > 0 && (
                    <span className={styles.time}>
                      <b>{formatSpent(g.minutes, t)}</b>
                      <span>{t('bookTime.days', { n: g.days })}</span>
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
