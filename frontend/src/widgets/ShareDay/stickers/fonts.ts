/** The bookcase's typefaces, the same stylesheet the shelf loads: a canvas draws
 * text only in faces the page has already downloaded. */
const HREF =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=Literata:ital,opsz,wght@0,7..72,300..700;1,7..72,300..700&display=swap';

// Every subset a sticker can need: Kazakh letters live in Cyrillic Extended.
const SAMPLE = 'Aa Яя Әә Ғғ Ққ Ңң Өө Ұұ Үү Һһ Іі «»“” 0123456789';
const FACES = ['300 40px "Literata"', 'italic 400 40px "Literata"', '600 40px "Inter"'];

let pending: Promise<void> | null = null;

function stylesheet(): Promise<void> {
  let link = document.querySelector<HTMLLinkElement>('link[data-shelf-fonts]');
  if (link?.sheet) return Promise.resolve();
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = HREF;
    link.dataset.shelfFonts = '1';
    document.head.appendChild(link);
  }
  const el = link;
  return new Promise((resolve) => {
    el.addEventListener('load', () => resolve(), { once: true });
    el.addEventListener('error', () => resolve(), { once: true });
  });
}

/** Never fails and never waits long: without the fonts the stickers draw in
 * Georgia and Arial, and draw again once the fonts arrive. */
export function loadStickerFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
  pending ??= (async () => {
    const loaded = stylesheet()
      .then(() => Promise.all(FACES.map((face) => document.fonts.load(face, SAMPLE))))
      .then(
        () => undefined,
        () => undefined
      );
    await Promise.race([loaded, new Promise<void>((resolve) => window.setTimeout(resolve, 3500))]);
  })();
  return pending;
}
