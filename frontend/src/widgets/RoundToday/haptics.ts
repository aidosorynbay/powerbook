/**
 * A tick under the finger, like the iPhone timer's wheel (the founder's wish;
 * the /llm-council spec, 2026-10-13).
 *
 * Android has navigator.vibrate. iPhone Safari does not, but since iOS 17.4
 * a <input type="checkbox" switch> taps the Taptic Engine when it flips, and
 * a click on its label flips it: a hidden one, clicked, is the tap. It is a
 * side effect, not an API, so it is tried quietly and may one day do nothing.
 */

let last = 0;
let audio: AudioContext | null = null;

/**
 * The click you hear: a few milliseconds of filtered noise, like the
 * iPhone timer's wheel. Web Audio may only start inside a touch, so the
 * dial calls this on pointerdown; on an iPhone it stays silent with the
 * ringer switch off, as the timer does.
 */
export function unlockSound() {
  try {
    if (!audio) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      audio = new Ctx();
    }
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

function click(strong: boolean) {
  const ctx = audio;
  if (!ctx || ctx.state !== 'running') return;
  const len = Math.floor(ctx.sampleRate * 0.006);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = strong ? 1800 : 2600;
  const gain = ctx.createGain();
  gain.gain.value = strong ? 0.5 : 0.28;
  src.connect(hp).connect(gain).connect(ctx.destination);
  src.start();
}

/** One tap of the Taptic Engine through a switch made for it and gone again (the way ios-haptics does it). */
function iosTap() {
  const label = document.createElement('label');
  label.ariaHidden = 'true';
  label.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  label.appendChild(input);
  document.head.appendChild(label);
  label.click();
  document.head.removeChild(label);
}

export function hapticsOn(): boolean {
  try {
    return localStorage.getItem('pb.haptics') !== '0';
  } catch {
    return true;
  }
}

/** One tick; `strong` at 30 minutes and on each full hour. Ticks closer than 50 ms are dropped, never queued. */
export function tick(strong = false) {
  if (!hapticsOn()) return;
  const now = performance.now();
  if (!strong && now - last < 50) return;
  last = now;
  click(strong);
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(strong ? 20 : 8);
      return;
    }
    iosTap();
    if (strong) window.setTimeout(iosTap, 80);
  } catch {
    /* no tick then */
  }
}

/**
 * The tap on letting go of the dial. iPhone Safari (iOS 18.4+) taps the Taptic Engine only inside a tap or a
 * release, never while a finger drags (WebKit checks for a user gesture, and a move is not one), so the wind is
 * heard as it turns and felt once when the finger lifts: twice when the day has just become counted. Android
 * vibrates on every tick already and is left alone.
 */
export function releaseTap(strong = false) {
  if (!hapticsOn() || typeof navigator.vibrate === 'function') return;
  try {
    iosTap();
    if (strong) window.setTimeout(iosTap, 90);
  } catch {
    /* no tap then */
  }
}

/** Pages lifting off: a short paper rustle (band-passed noise in little bursts). Called inside the tap on «Сохранить». */
export function rustle() {
  unlockSound();
  const ctx = audio;
  if (!ctx) return;
  const play = () => {
    const dur = 0.42;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      const flutter = 0.55 + 0.45 * Math.abs(Math.sin(t * 2 * Math.PI * 14));
      d[i] = (Math.random() * 2 - 1) * flutter * Math.min(1, t / 0.03) * (1 - t / dur) ** 1.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.22;
    src.connect(bp).connect(gain).connect(ctx.destination);
    src.start();
  };
  if (ctx.state === 'running') play();
  else void ctx.resume().then(play).catch(() => {});
}

/** The minutes land in the day: one soft wooden tick (about 40 ms, low, quiet) and a light tap. */
export function thud(_counted = false) {
  const ctx = audio;
  if (ctx && ctx.state === 'running') {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, t0);
    osc.frequency.exponentialRampToValueAtTime(150, t0 + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.08);
  }
  tick(false);
}

/** The day now counts: a short two-note chime (a fifth up, soft sine with a quick decay) and a success tap. */
export function chime() {
  const ctx = audio;
  if (ctx && ctx.state === 'running') {
    const t0 = ctx.currentTime;
    [[784, 0], [1175, 0.09]].forEach(([f, d]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.09, t0 + d + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.55);
    });
  }
  tick(true);
}
