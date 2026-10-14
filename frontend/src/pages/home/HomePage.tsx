import { useEffect, useState } from 'react';
import { apiGet, type PublicStats } from '@/shared/lib';
import { PageTransition } from '@/shared/ui';
import { Header, Footer, LiveRoom } from '@/widgets';
import { HomeFinal, HomeHero, HowItWorks, MonthGets, PlatformPerks, SharedTotal } from './HomeSections';
import styles from './HomePage.module.css';

export function HomePage() {
  const [stats, setStats] = useState<PublicStats | null>(null);

  // The room's serif (Literata) for its headings, the same file the shelf loads.
  useEffect(() => {
    if (document.querySelector('link[data-shelf-fonts]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=Literata:ital,opsz,wght@0,7..72,300..700;1,7..72,300..700&display=swap';
    link.dataset.shelfFonts = '1';
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    let alive = true;
    apiGet<PublicStats>('/stats/public').then(({ data }) => {
      if (alive && data) setStats(data);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Links elsewhere point at /#powerbook (how a circle goes).
  useEffect(() => {
    if (window.location.hash !== '#powerbook') return;
    const id = window.setTimeout(
      () => document.getElementById('powerbook')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      300,
    );
    return () => window.clearTimeout(id);
  }, []);

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />

        <main className={styles.main}>
          {/* The live reading room is the first screen (founder, 14 Oct: the room once, as the hero, live): the
              circle's hall with whoever reads in it now, and the way in. GA4 showed newcomers give the page ~30 s,
              and the computer's «put it on your phone» landing brought no installs. The still photo shows until
              the living one is drawn. */}
          <LiveRoom
            hall="round"
            keepChairsClear
            className={styles.hero}
            uiClassName={styles.heroUi}
            poster={
              <picture>
                <source media="(min-width: 760px)" type="image/webp" srcSet="/home/room-night-wide-1600.webp 1600w, /home/room-night-wide-2560.webp 2560w" sizes="100vw" />
                <source type="image/webp" srcSet="/home/room-night-tall-750.webp 750w, /home/room-night-tall-1080.webp 1080w" sizes="100vw" />
                <img src="/home/room-night-tall-750.jpg" alt="" {...{ fetchpriority: 'high' }} />
              </picture>
            }
          >
            <HomeHero stats={stats} />
          </LiveRoom>
          <SharedTotal stats={stats} />
          <MonthGets />
          <HowItWorks />
          <PlatformPerks />
          <HomeFinal />
        </main>

        <Footer />
      </div>
    </PageTransition>
  );
}
