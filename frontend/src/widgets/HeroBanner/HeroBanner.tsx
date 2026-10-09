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
        /* the photo upscaled ×4 (Real-ESRGAN, 2026-10-10): a wide retina screen gets the 3840px one, the rest 1920px */
        src="/library-banner-1920.jpg"
        srcSet="/library-banner-1920.jpg 1920w, /library-banner-3840.jpg 3840w"
        sizes="100vw"
        alt=""
        loading="eager"
        decoding="async"
      />
      <div className={styles.fade} />
    </div>
  );
}
