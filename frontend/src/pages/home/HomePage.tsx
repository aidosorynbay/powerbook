import { Header, Hero, Stats, Reward, CallToAction, Footer } from '@/widgets';
import styles from './HomePage.module.css';

interface HomePageProps {
  onRegisterClick?: () => void;
  onLoginClick?: () => void;
}

export function HomePage({ onRegisterClick, onLoginClick }: HomePageProps) {
  const handleJoin = () => {
    onRegisterClick?.();
  };

  return (
    <div className={styles.page}>
      <Header onRegisterClick={onRegisterClick} onLoginClick={onLoginClick} />
      
      <main className={styles.main}>
        <Hero onJoinClick={handleJoin} />
        <Stats />
        <Reward />
        <CallToAction onJoinClick={handleJoin} />
      </main>
      
      <Footer />
    </div>
  );
}
