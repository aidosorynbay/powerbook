import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { track, useI18n, type MyDayCard, type ShareChannel } from '@/shared/lib';
import {
  STICKERS,
  STORY_WIDTH,
  drawSticker,
  drawStory,
  loadImage,
  loadStickerAssets,
  loadStickerFonts,
  roomFor,
  stickerData,
  toBlob,
  type Ink,
  type StickerAssets,
  type StickerKind,
} from './stickers';
import { localToday } from './shareText';
import styles from './StoryShare.module.css';

/** A sticker kept as its file: the canvas it was drawn on is let go at once. */
type Drawn = { blob: Blob; url: string };
type Detail = Record<string, string>;

const INKS: readonly Ink[] = ['light', 'dark'];
type Mode = 'room' | 'photo';
const MODES: readonly Mode[] = ['photo', 'room'];

/** One Analytics event per sticker, so GA4's own Events report compares them with no custom dimensions set up. */
const EVENT: Record<StickerKind, string> = {
  page: 'sticker_page',
  shelf: 'sticker_shelf',
  calendar: 'sticker_calendar',
  shelfCalendar: 'sticker_shelf_calendar',
};

function remembered<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: it is only a convenience */
  }
}

/** A picture on the clipboard: Safari and Chrome on phones, most desktop browsers. */
function canCopyImage(): boolean {
  if (typeof window === 'undefined' || !('ClipboardItem' in window) || typeof navigator.clipboard?.write !== 'function') return false;
  const supports = (ClipboardItem as unknown as { supports?: (type: string) => boolean }).supports;
  return typeof supports !== 'function' || supports('image/png');
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * «Сторис»: the day as a sticker, the way Strava hands runners their stats.
 * The sticker has no background: copied here, it goes into an Instagram story
 * on top of the reader's own photo (Instagram offers to add it as soon as the
 * story opens). No editor here: Instagram is where it is moved and sized.
 * For someone without a photo there is the whole picture, the sticker over
 * the reading room.
 */
export function StoryShare({ card, link, onSent }: { card: MyDayCard; link: string; onSent: (channel: ShareChannel, detail: Detail) => void }) {
  const { t, locale } = useI18n();
  // A reader's first sticker is picked at random, then kept: whichever one the
  // sheet opened on would otherwise win the month's count in Analytics.
  const [kind, setKind] = useState<StickerKind>(() =>
    remembered('pb.sticker.kind', STICKERS, STICKERS[Math.floor(Math.random() * STICKERS.length)])
  );
  const [ink, setInk] = useState<Ink>(() => remembered('pb.sticker.ink', INKS, 'light'));
  const [drawn, setDrawn] = useState<Partial<Record<StickerKind, Drawn>>>({});
  const [fontsTick, setFontsTick] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // The sticker alone, for one's own photo in a story (Strava's runners' favourite, so it comes first), or the picture
  // on the reading room, to any app: a switch, so the four stickers stay the month's test (the founder, 2026-10-15).
  // Always opens on «Своё фото», whatever was picked last time (the founder, 2026-10-15).
  const [mode, setMode] = useState<Mode>('photo');
  const assets = useRef<StickerAssets | null>(null);
  const urls = useRef<string[]>([]);
  const story = useRef<{ key: string; file: File } | null>(null);
  const rail = useRef<HTMLDivElement>(null);
  const howto = useRef<HTMLParagraphElement>(null);
  const frame = useRef(0);
  const copyable = useMemo(canCopyImage, []);
  const touch = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches, []);
  const phone = useMemo(() => typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent), []);
  const data = useMemo(() => stickerData(card, t, locale, localToday()), [card, t, locale]);
  const shownKind = useRef(kind);
  shownKind.current = kind;

  // Fonts that arrive after the first drawing: draw again with them.
  useEffect(() => {
    if (!('fonts' in document)) return;
    const again = () => setFontsTick((n) => n + 1);
    document.fonts.addEventListener('loadingdone', again);
    return () => document.fonts.removeEventListener('loadingdone', again);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      await loadStickerFonts();
      assets.current ??= await loadStickerAssets();
      const next: Partial<Record<StickerKind, Drawn>> = {};
      const made: string[] = [];
      // The sticker on show first, and on screen as soon as it is drawn: no «Рисуем…» for the other three.
      const first = shownKind.current;
      for (const k of [first, ...STICKERS.filter((x) => x !== first)]) {
        if (!live) break;
        const canvas = drawSticker(k, data, ink, assets.current);
        const blob = await toBlob(canvas, 'image/png');
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        made.push(url);
        next[k] = { blob, url };
        if (live) setDrawn((d) => ({ ...d, [k]: next[k] }));
      }
      if (!live) {
        made.forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = made;
      setDrawn(next);
    })();
    return () => {
      live = false;
    };
  }, [data, ink, fontsTick]);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  useEffect(() => remember('pb.sticker.kind', kind), [kind]);
  useEffect(() => remember('pb.sticker.ink', ink), [ink]);

  const current = drawn[kind];
  const storyKey = current ? `${kind}:${ink}:${current.url}` : '';
  const fileName = (what: string, ext: string) => `powerbook-${card.day}-${what}.${ext}`;

  const drawWhole = async (): Promise<File | null> => {
    if (!current) return null;
    const sticker = await loadImage(current.url);
    if (!sticker) return null;
    const blob = await toBlob(await drawStory(kind, sticker, ink, link), 'image/jpeg');
    return blob ? new File([blob], fileName(kind, 'jpg'), { type: 'image/jpeg' }) : null;
  };

  // The whole picture is drawn ahead, so sharing it happens inside the tap (iOS needs that).
  useEffect(() => {
    if (!storyKey || story.current?.key === storyKey) return;
    let live = true;
    const id = window.setTimeout(async () => {
      const file = await drawWhole();
      if (live && file) story.current = { key: storyKey, file };
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
    // drawWhole reads what storyKey stands for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyKey]);

  const step = () => {
    const slide = rail.current?.querySelector<HTMLElement>('[data-slide]');
    return slide ? slide.offsetWidth + 12 : 1;
  };

  // Open on the sticker chosen last time.
  useLayoutEffect(() => {
    if (rail.current) rail.current.scrollLeft = STICKERS.indexOf(kind) * step();
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = rail.current;
      if (!el) return;
      const i = Math.max(0, Math.min(STICKERS.length - 1, Math.round(el.scrollLeft / step())));
      setKind(STICKERS[i]);
    });
  };

  const pick = (k: StickerKind) => {
    setKind(k);
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    rail.current?.scrollTo({ left: STICKERS.indexOf(k) * step(), behavior: still ? 'auto' : 'smooth' });
  };

  /** Counted twice in Analytics: in `day_share` with the rest of the day's shares, and as the sticker's own event. */
  const done = (channel: ShareChannel, action: string) => {
    onSent(channel, { action, template: kind, ink });
    track(EVENT[kind], { method: channel, action, ink });
  };
  const copiedKey = `${kind}:${ink}`;

  // What to do next, in view as soon as the sticker is on the clipboard.
  useEffect(() => {
    if (copied) howto.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [copied]);

  // Straight from the tap, with the picture already drawn: Safari allows the clipboard only so.
  const copy = () => {
    if (!current) return;
    navigator.clipboard.write([new ClipboardItem({ 'image/png': current.blob })]).then(
      () => {
        setCopied(copiedKey);
        setFailed(false);
        done('sticker', 'copy');
        // One tap, as on Strava: on a phone the story camera opens at once, and Instagram offers the sticker itself.
        if (phone && mode === 'photo') {
          track('share_open_instagram', { auto: true });
          window.location.href = 'instagram://story-camera';
        }
      },
      () => setFailed(true)
    );
  };

  /** On a phone the share sheet saves to Photos («Сохранить изображение»); elsewhere a download. */
  const save = async () => {
    if (!current) return;
    const file = new File([current.blob], fileName(`${kind}-sticker`, 'png'), { type: 'image/png' });
    if (touch && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        done('sticker', 'save');
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    download(file);
    done('sticker', 'download');
  };

  /** The picture alone, no text: with text beside it, Instagram on iPhone keeps the text and drops the picture. */
  const shareWhole = async () => {
    let file = story.current?.key === storyKey ? story.current.file : null;
    if (!file) {
      setBusy(true);
      file = await drawWhole();
      setBusy(false);
    }
    if (!file) return;
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        done('story', 'share');
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    download(file);
    done('story', 'download');
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.stage}>
        <div className={styles.track} ref={rail} onScroll={onScroll}>
          {STICKERS.map((k) => {
            const d = drawn[k];
            const on = k === kind;
            return (
              <button
                key={k}
                type="button"
                data-slide
                className={`${styles.slide} ${on ? styles.on : ''}`}
                onClick={() => pick(k)}
                aria-pressed={on}
                aria-label={t(`sticker.${k}`)}
              >
                <span
                  className={`${styles.frame} ${mode === 'photo' ? styles.framePhoto : ''}`}
                  data-ink={ink}
                  style={mode === 'room' ? { backgroundImage: `url(${roomFor(ink)})` } : undefined}
                >
                  {mode === 'photo' && <span className={styles.photoNote}>{t('shareDay.yourPhoto')}</span>}
                  {d ? (
                    <img src={d.url} alt="" draggable={false} style={{ width: `${STORY_WIDTH[k] * 100}%` }} />
                  ) : (
                    <span className={styles.drawing}>{t('shareDay.drawing')}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div className={styles.pips} aria-hidden="true">
          {STICKERS.map((k) => (
            <i key={k} className={k === kind ? styles.pipOn : undefined} />
          ))}
        </div>
      </div>

      <div className={styles.modes} role="group" aria-label={t('shareDay.title')}>
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              track('share_mode', { mode: m });
            }}
          >
            {t(m === 'room' ? 'shareDay.modeRoom' : 'shareDay.modePhoto')}
          </button>
        ))}
      </div>

      {/* One button, as on Strava: the picture as it is shown, to the phone's own share sheet (Instagram, Telegram,
          WhatsApp are all in it); on «Своё фото», the sticker to the clipboard and then Instagram (the council, 2026-10-15). */}
      {mode === 'room' ? (
        <button type="button" className={`${styles.primary} ${styles.share}`} onClick={shareWhole} disabled={!current || busy}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 8 5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>
          {t('shareDay.share')}
        </button>
      ) : copied === copiedKey && phone ? (
        <a className={`${styles.primary} ${styles.share}`} href="instagram://story-camera" onClick={() => track('share_open_instagram')}>
          {t('shareDay.openInstagram')}
        </a>
      ) : (
        <button type="button" className={`${styles.primary} ${styles.share}`} onClick={copyable ? copy : save} disabled={!current}>
          {copied === copiedKey ? `✓ ${t('shareDay.stickerCopied')}` : t(!copyable ? 'shareDay.saveSticker' : phone ? 'shareDay.toInstagram' : 'shareDay.copySticker')}
        </button>
      )}

      {mode === 'photo' && (
        <>
          <div className={styles.inks}>
            {INKS.map((i) => (
              <button
                key={i}
                type="button"
                className={`${styles.ink} ${i === 'light' ? styles.inkLight : styles.inkDark}`}
                aria-pressed={ink === i}
                onClick={() => setInk(i)}
              >
                <i aria-hidden="true" />
                {t(i === 'light' ? 'shareDay.inkLight' : 'shareDay.inkDark')}
              </button>
            ))}
          </div>
          {copied === copiedKey ? (
            <p className={styles.howto} role="status" ref={howto}>
              {t('shareDay.howTo')}
            </p>
          ) : (
            <p className={styles.hint} role={failed ? 'alert' : undefined}>
              {t(failed ? 'shareDay.copyFailed' : phone && copyable ? 'shareDay.photoHintPhone' : 'shareDay.photoHint')}
            </p>
          )}
        </>
      )}

    </div>
  );
}
