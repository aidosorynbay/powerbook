import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, formatSpent, inviteLink, KK_MONTHS, track, useI18n, type Invites, type Locale } from '@/shared/lib';
import { Avatar } from '@/shared/ui';
import { plural } from '@/pages/library/bookcase/plural';
import styles from './InviteFriends.module.css';

/** «сегодня», «вчера», «5 окт.»: when a friend last read, the freshest the proudest. */
function lastRead(iso: string, locale: Locale, t: (key: 'invite.today' | 'invite.yesterday') => string): string {
  const d = new Date(`${iso}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const ago = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (ago <= 0) return t('invite.today');
  if (ago === 1) return t('invite.yesterday');
  if (locale === 'kk') return `${d.getDate()} ${KK_MONTHS[d.getMonth()]}`;
  return d.toLocaleDateString(locale === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'short' });
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    document.body.appendChild(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }
}

/**
 * «Приведи друга», after the Sadaqa app (the founder, 2026-10-10), as simple as the council could make it: one big
 * button that sends the link (the phone's own share sheet, which has Telegram and WhatsApp in it; elsewhere it copies),
 * and the pride of it: the minutes friends have read since they came by it, and who they are.
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
  const { direct, guests } = data;

  const copied2s = async () => {
    await copyText(link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  };
  const invite = async () => {
    const share = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    track('invite_click', { method: share ? 'share' : 'copy', guests: direct.people });
    if (!share) return copied2s();
    try {
      await navigator.share({ title: 'PowerBook', text: t('invite.shareText'), url: link });
    } catch (e) {
      // closed by the reader: nothing to do; broken (some in-app browsers): the link is copied instead
      if ((e as Error)?.name !== 'AbortError') await copied2s();
    }
  };

  return (
    <div className={styles.card}>
      {direct.people === 0 ? (
        <p className={styles.lead}>{t('invite.empty')}</p>
      ) : (
        <div className={styles.hero}>
          <b className={styles.big}>{formatSpent(direct.minutes, t)}</b>
          <span className={styles.caption}>{t('invite.heroCaption')}</span>
          <span className={styles.sub}>
            {direct.people} {plural(locale, direct.people, { one: t('invite.friend.one'), few: t('invite.friend.few'), many: t('invite.friend.many') })}
            {direct.days > 0 && <> · {t('bookTime.days', { n: direct.days })}</>}
          </span>
        </div>
      )}

      <button type="button" className={styles.invite} onClick={invite}>
        {copied ? t('wl.copied') + ' ✓' : direct.people ? t('invite.more') : t('invite.button')}
      </button>
      <button type="button" className={styles.link} onClick={copied2s} title={t('wl.copy')}>
        {link.replace(/^https?:\/\//, '')}
      </button>

      {guests.length > 0 && (
        <ul className={styles.list}>
          {guests.map((g) => (
            <li key={g.user_id}>
              <Link to={`/readers/${g.user_id}`} className={styles.row}>
                <Avatar src={g.avatar_data} name={g.display_name} size="sm" />
                <span className={styles.who}>
                  <span className={styles.name}>{g.display_name}</span>
                  <span className={styles.meta}>
                    {g.last_day ? t('invite.last', { date: lastRead(g.last_day, locale, t) }) : t('invite.notYet')}
                  </span>
                </span>
                {g.minutes > 0 && <b className={styles.time}>{formatSpent(g.minutes, t)}</b>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
