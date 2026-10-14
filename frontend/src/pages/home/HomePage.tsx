import { useEffect, useState } from 'react';
import { apiGet, type PublicStats } from '@/shared/lib';
import { PageTransition } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import { HomeFinal, HomeHero, HowItWorks, MonthGets, PlatformPerks, RoomSection, SharedTotal } from './HomeSections';
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
          {/* The first screen: the community's own picture (the Telegram group's since 2021), the circle's words,
              and the way in. The council (2026-10-14): the room as the hero promised «reading at the same moment»,
              the competitors' model, while PowerBook is minutes added up — so the room is shown once, below. */}
          <section className={styles.photoHero}>
            <picture className={styles.photoArt} aria-hidden="true">
              <source media="(max-width: 759px)" type="image/webp" srcSet="/home/library-phone.webp" />
              <source media="(max-width: 759px)" srcSet="/home/library-phone.jpg" />
              <img
                src="/library-banner-1920.jpg"
                srcSet="/library-banner-1920.jpg 1920w, /library-banner-3840.jpg 3840w"
                sizes="100vw"
                alt=""
                {...{ fetchpriority: 'high' }}
              />
            </picture>
            <div className={styles.photoShade} aria-hidden="true" />
            <div className={styles.photoWords}>
              <HomeHero stats={stats} />
            </div>
          </section>
          <SharedTotal stats={stats} />
          <RoomSection />
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
