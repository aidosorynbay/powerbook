import { ReactNode, useEffect, useState } from 'react';
import styles from './PageTransition.module.css';

interface PageTransitionProps {
  children: ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    if (prefersReducedMotion) {
      setEntered(true);
      return;
    }

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setEntered(true);
      });
    });

    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={`${styles.pageTransition} ${entered ? styles.entered : ''}`}>
      {children}
    </div>
  );
}
