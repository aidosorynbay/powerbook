import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/shared/lib';
import { Container, PageTransition } from '@/shared/ui';
import { Header, Hero, Stats, Reward, CallToAction, Footer, About, RoundsShowcase, HeroBanner } from '@/widgets';
import styles from './HomePage.module.css';

export function HomePage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const handleJoin = () => {
    navigate(isAuthenticated ? '/round' : '/register');
  };

  return (
    <PageTransition>
      <div className={styles.page}>
        <Header />

        <main className={styles.main}>
          <HeroBanner />
          <Hero onJoinClick={handleJoin} />
          <Stats />
          <RoundsShowcase />
          <Reward />
          <About />
          <CallToAction onJoinClick={handleJoin} />
        </main>

        <Footer />
      </div>
    </PageTransition>
  );
}

