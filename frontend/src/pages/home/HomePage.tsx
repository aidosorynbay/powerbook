import { useEffect, useState } from 'react';
import { apiGet, isStandalone, track, type PublicStats } from '@/shared/lib';
import { useMediaQuery } from '@/shared/hooks';
import { PageTransition } from '@/shared/ui';
import { Header, Footer } from '@/widgets';
import { InstallLanding } from '@/widgets/InstallLanding';
import { CircleTreasury, HomeFinal, HomeHero, HowItWorks } from './HomeSections';
import styles from './HomePage.module.css';

// «Продолжить на компьютере» is remembered this long.
const LANDING_SKIP_KEY = 'pb.landing.skip';
const LANDING_SKIP_DAYS = 30;

function landingSkipped(): boolean {
  try {
    return Number(localStorage.getItem(LANDING_SKIP_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
}

export function HomePage() {
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    let alive = true;
    apiGet<PublicStats>('/stats/public').then(({ data }) => {
      if (alive && data) setStats(data);
    });
    return () => {
      alive = false;
    };
  }, []);

  // A big screen with a mouse is the computer; the phone's own home page is
  // untouched. ?desktop=1 skips the landing for a link that must land here.
  const desktop = useMediaQuery('(min-width: 1024px) and (hover: hover)');
  const [landing, setLanding] = useState(
    () => !isStandalone() && !landingSkipped() && !new URLSearchParams(window.location.search).has('desktop'),
  );
  const showLanding = desktop && landing;

  // «Узнать больше» / «Толығырақ»: down to what PowerBook is.
  const handleLearnMore = () => {
    document.getElementById('powerbook')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const continueOnDesktop = () => {
    track('landing_continue');
    try {
      localStorage.setItem(LANDING_SKIP_KEY, String(Date.now() + LANDING_SKIP_DAYS * 86_400_000));
    } catch {
      /* storage blocked: the landing comes back next visit */
    }
    setLanding(false);
    window.scrollTo({ top: 0 });
  };

  // Links elsewhere point at /#powerbook.
  useEffect(() => {
    if (window.location.hash !== '#powerbook') return;
    const id = window.setTimeout(handleLearnMore, 300);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <PageTransition>
      <div className={styles.page}>
        {showLanding ? <InstallLanding onContinue={continueOnDesktop} /> : <Header />}

        <main className={styles.main}>
          {/* GA4, 1–14 Oct 2026: newcomers stay ~30 s and only 18% reach the
              bottom, so the page is the reading room, one shared number, how a
              circle goes, and one last button — nothing else. */}
          <HomeHero stats={stats} onHow={handleLearnMore} />
          <CircleTreasury stats={stats} />
          <HowItWorks />
          <HomeFinal />
        </main>

        <Footer />
      </div>
    </PageTransition>
  );
}
