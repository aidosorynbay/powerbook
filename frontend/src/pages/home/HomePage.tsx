import { useEffect, useState } from 'react';
import { apiGet, type PublicStats } from '@/shared/lib';
import { PageTransition } from '@/shared/ui';
import { Header, Footer, LiveRoom } from '@/widgets';
import { HomeFinal, HomeHero, HowItWorks, MonthGets, PlatformPerks, RoomWayIn, SharedTotal } from './HomeSections';
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

  // «Заглянуть в читальный зал»: down into the live room.
  const toRoom = () => {
    document.getElementById('room')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
          {/* GA4, 1–14 Oct 2026: newcomers give the page ~30 s, so the first
              screen says it all; the computer's «put it on your phone» landing
              brought no installs and gave way to the live room. */}
          <HomeHero stats={stats} onHow={toRoom} />
          <div id="room">
            <LiveRoom>
              <RoomWayIn />
            </LiveRoom>
          </div>
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
