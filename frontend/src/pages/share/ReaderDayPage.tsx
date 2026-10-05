import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet, rememberInvite, track, useAuth, useI18n, type DayCard } from '@/shared/lib';
import { Avatar, Container } from '@/shared/ui';
import { Footer, Header } from '@/widgets';
import { RoundRules, dayOf } from '@/widgets/JoinPrompt';
import { DayGrid, DayLegend, ShareDay } from '@/widgets/ShareDay';
import { plural } from '@/pages/library/bookcase/plural';
import styles from './ReaderDayPage.module.css';

/** Today as the visitor's own calendar has it, "2026-10-05". */
function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Where a shared day leads (/r/:username), open to anyone: the reader's
 * minutes, their run of days and the round in squares, then the way into the
 * next circle. Whoever signs up from here is counted as the reader's guest.
 * Only a reader who has shared a day has a page; it never shows books or comments.
 */
export function ReaderDayPage() {
  const { username = '' } = useParams();
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const [card, setCard] = useState<DayCard | null>(null);
  const [missing, setMissing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const name = username.replace(/^@/, '');
  const own = !!user && user.username.toLowerCase() === name.toLowerCase();

  useEffect(() => {
    let live = true;
    setCard(null);
    setMissing(false);
    apiGet<DayCard>(`/share/r/${encodeURIComponent(name)}`).then(({ data }) => {
      if (!live) return;
      if (data) setCard(data);
      else setMissing(true);
      track('day_page_view', { found: !!data });
    });
    return () => {
      live = false;
    };
  }, [name]);

  // Whoever goes on to sign up from here is this reader's guest.
  useEffect(() => {
    if (!own) rememberInvite(name);
  }, [own, name]);

  useEffect(() => {
    if (!card) return;
    document.title = `${card.display_name} · PowerBook`;
    return () => {
      document.title = 'PowerBook';
    };
  }, [card]);

  const today = card?.day === localToday();
  const streakWord = card
    ? plural(locale, card.streak, {
        one: t('dayPage.streak.one'),
        few: t('dayPage.streak.few'),
        many: t('dayPage.streak.many'),
      })
    : '';

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <Container size="sm">
          {!card && !missing ? (
            <p className={styles.muted}>{t('dashboard.loading')}</p>
          ) : card ? (
            <article className={styles.card}>
              <div className={styles.who}>
                <Avatar src={card.avatar_data} name={card.display_name} size="lg" />
                <div>
                  <h1 className={styles.name}>{card.display_name}</h1>
                  <p className={styles.reads}>{t('dayPage.reads')}</p>
                </div>
              </div>

              <div className={styles.stats}>
                <div className={styles.stat}>
                  <b>{card.minutes}</b>
                  <span>{today ? t('dayPage.minToday') : t('dayPage.minOn', { date: dayOf(card.day, locale, t) })}</span>
                </div>
                <div className={styles.stat}>
                  <b>🔥 {card.streak}</b>
                  <span>{streakWord}</span>
                </div>
                <div className={styles.stat}>
                  <b>
                    {card.goal_days}/{card.day_number}
                  </b>
                  <span>{t('dayPage.goalDays')}</span>
                </div>
              </div>

              <div className={styles.month}>
                <div className={styles.monthHead}>
                  <strong>
                    {t(`month.${card.month}`)} {card.year}
                  </strong>
                  <span>{t('dayPage.dayOf', { n: card.day_number, total: card.days.length })}</span>
                </div>
                <DayGrid card={card} />
                <DayLegend goal={t('dayPage.legendGoal')} some={t('dayPage.legendSome')} none={t('dayPage.legendNone')} />
              </div>

              {own && (
                <div className={styles.own}>
                  <p>{t('dayPage.own')}</p>
                  <button type="button" className={styles.ctaBtn} onClick={() => setSharing(true)}>
                    {t('shareDay.button')}
                  </button>
                </div>
              )}
            </article>
          ) : (
            <article className={styles.card}>
              <h1 className={styles.name}>{t('dayPage.closedTitle')}</h1>
              <p className={styles.reads}>{t('dayPage.closedText')}</p>
            </article>
          )}

          {!own && (card || missing) && (
            <section className={styles.cta}>
              <h2 className={styles.ctaTitle}>{t('dayPage.ctaTitle')}</h2>
              <p className={styles.ctaText}>{t('dayPage.ctaText')}</p>
              <Link
                className={styles.ctaBtn}
                to={`/join?ref=${encodeURIComponent(name)}`}
                onClick={() => track('day_page_join', { found: !!card })}
              >
                {t('dayPage.cta')}
              </Link>
              <RoundRules compact />
            </section>
          )}
        </Container>
      </main>
      <Footer />
      {sharing && <ShareDay day={localToday()} onClose={() => setSharing(false)} />}
    </div>
  );
}
