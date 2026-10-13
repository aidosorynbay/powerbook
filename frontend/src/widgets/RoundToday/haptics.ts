/**
 * A tick under the finger, like the iPhone timer's wheel (the founder's wish;
 * the /llm-council spec, 2026-10-13).
 *
 * Android has navigator.vibrate. iPhone Safari does not, but since iOS 17.4
 * a <input type="checkbox" switch> taps the Taptic Engine when it flips, and
 * a click on its label flips it: a hidden one, clicked, is the tap. It is a
 * side effect, not an API, so it is tried quietly and may one day do nothing.
 */

let label: HTMLLabelElement | null = null;
let last = 0;

function iosSwitch(): HTMLLabelElement | null {
  if (label) return label;
  if (typeof document === 'undefined') return null;
  const l = document.createElement('label');
  l.setAttribute('aria-hidden', 'true');
  l.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  l.appendChild(input);
  document.body.appendChild(l);
  label = l;
  return l;
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
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(strong ? 20 : 8);
      return;
    }
    const l = iosSwitch();
    if (!l) return;
    l.click();
    if (strong) window.setTimeout(() => l.click(), 80);
  } catch {
    /* no tick then */
  }
}
