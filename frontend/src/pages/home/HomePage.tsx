import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/shared/lib';
import { Container, PageTransition } from '@/shared/ui';
import { Header, Hero, Stats, CallToAction, Footer, About, RoundsShowcase, HeroBanner, Explainer } from '@/widgets';
import styles from './HomePage.module.css';

export function HomePage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const handleJoin = () => {
    navigate(isAuthenticated ? '/round' : '/join');
  };

  // «Узнать больше» / «Толығырақ»: down to what PowerBook is.
  const handleLearnMore = () => {
    document.getElementById('powerbook')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        <Header />

        <main className={styles.main}>
          <HeroBanner />
          <Hero onJoinClick={handleJoin} onLearnMoreClick={handleLearnMore} />
          <Explainer />
          <Stats />
          <RoundsShowcase />
          <About />
          <CallToAction onJoinClick={handleJoin} />
        </main>

        <Footer />
      </div>
    </PageTransition>
  );
}

