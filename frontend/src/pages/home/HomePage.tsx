import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/shared/lib';
import { PageTransition } from '@/shared/ui';
import { Header, Hero, Stats, Reward, CallToAction, Footer } from '@/widgets';
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
          <Hero onJoinClick={handleJoin} />
          <Stats />
          <Reward />
          <CallToAction onJoinClick={handleJoin} />
        </main>

        <Footer />
      </div>
    </PageTransition>
  );
}

