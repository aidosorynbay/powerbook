import { useEffect, useState } from 'react';
import { apiGet, type PublicStats } from '@/shared/lib';
import { PageTransition } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import { HomeFinal, HomeHero, HowItWorks, MonthGets, PlatformPerks, RoomSection, SharedTotal } from './HomeSections';
import styles from './HomePage.module.css';

/* Only the room's serif (Literata italic) for the titles over the library's pictures — the rest of the page is in the
   face the Round tab renders (the system one: Inter is declared but never loaded there), so both pages look the same
   and weight-800 numbers are a true 800. Its own marker: the bookcase loads Inter + Literata under `data-shelf-fonts`
   and must not mistake this file for its own. Added at import, not after the first paint. */
if (typeof document !== 'undefined' && !document.querySelector('link[data-serif]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@1,7..72,400..600&display=swap';
  link.dataset.serif = '1';
  document.head.appendChild(link);
}

export function HomePage() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  // The first screen eases in once a session; members coming back every day get it at once (the council).
  const [calm] = useState(() => {
    try {
      const seen = sessionStorage.getItem('pb.heroSeen') === '1';
      sessionStorage.setItem('pb.heroSeen', '1');
      return seen;
    } catch {
      return false;
    }
  });

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
          {/* The first screen: the community's own picture (the Telegram group's since 2021), the circle's words,
              and the way in. The council (2026-10-14): the room as the hero promised «reading at the same moment»,
              the competitors' model, while PowerBook is minutes added up — so the room is shown once, below. */}
          <section className={`${styles.photoHero} ${calm ? styles.calm : ''}`}>
            <picture className={styles.photoArt} aria-hidden="true">
              {/* wide landscape screens: a 2:1 cut of the panorama with the book at 72% of the width, so the cover
                  crop never moves it and the words never touch it; everything else: the phone band */}
              <source
                media="(min-width: 1100px) and (orientation: landscape)"
                type="image/webp"
                srcSet="/home/library-desk-1600.webp 1600w, /home/library-desk-2000.webp 2000w, /home/library-desk-2632.webp 2632w"
                sizes="100vw"
              />
              <source media="(min-width: 1100px) and (orientation: landscape)" srcSet="/home/library-desk-2000.jpg" />
              <source type="image/webp" srcSet="/home/library-phone.webp" />
              <img src="/home/library-phone.jpg" alt="" {...{ fetchpriority: 'high' }} />
            </picture>
            <div className={styles.photoShade} aria-hidden="true" />
            <div className={styles.photoWords}>
              <HomeHero stats={stats} calm={calm} />
            </div>
          </section>
          <SharedTotal stats={stats} />
          <RoomSection />
          <MonthGets />
          <HowItWorks />
          <PlatformPerks />
          <HomeFinal />
        </main>

        <Footer onPhone />
      </div>
    </PageTransition>
  );
}
