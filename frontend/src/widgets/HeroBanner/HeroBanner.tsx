import styles from './HeroBanner.module.css';

/**
 * Panoramic band above the hero — the bookstore image the community has
 * used for years. Deliberately a strip, not a full-height cover: the hero's
 * join CTA has to stay near the top of the page.
 */
export function HeroBanner() {
  return (
    <div className={styles.banner} aria-hidden="true">
      <img
        className={styles.image}
        src="/library-banner.jpg"
        alt=""
        loading="eager"
        decoding="async"
      />
      <div className={styles.fade} />
    </div>
  );
}
