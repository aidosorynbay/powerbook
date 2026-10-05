import { INKS, ORANGE, SANS, font, roundRect, type Ctx, type Ink } from './canvas';
import type { StickerData } from './types';

const GOAL = 30;

/** Square side, gap between squares, height of the weekday row, size of the day numbers. */
export type CalendarSize = { cell: number; gap: number; head: number; numbers: number };

/** Monday-first weekday of an ISO date: 0 for Monday, 6 for Sunday. */
function weekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(y, m - 1, d, 12).getDay() + 6) % 7;
}

export function calendarWidth(s: CalendarSize): number {
  return 7 * s.cell + 6 * s.gap;
}

export function calendarHeight(data: StickerData, s: CalendarSize): number {
  const rows = Math.ceil((weekday(data.days[0]?.date ?? data.day) + data.days.length) / 7);
  return s.head + rows * s.cell + (rows - 1) * s.gap;
}

/**
 * The month as a wall calendar, Monday first. A day of 30 minutes is filled
 * orange, a shorter day half-filled, a missed day stays an empty square, and
 * the days ahead are faint. Today has a ring. Returns the y under the last row.
 */
export function drawCalendar(ctx: Ctx, data: StickerData, ink: Ink, x: number, y: number, s: CalendarSize): number {
  const colors = INKS[ink];
  const step = s.cell + s.gap;
  const r = s.cell * 0.22;
  const line = Math.max(2, s.cell * 0.04);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = font(s.numbers * 0.92, 600, SANS);
  ctx.fillStyle = colors.soft;
  data.words.weekdays.forEach((w, i) => ctx.fillText(w, x + i * step + s.cell / 2, y + s.head / 2 - s.gap / 2));

  const top = y + s.head;
  const offset = weekday(data.days[0]?.date ?? data.day);
  ctx.font = font(s.numbers, 600, SANS);
  data.days.forEach((d, i) => {
    const k = offset + i;
    const cx = x + (k % 7) * step;
    const cy = top + Math.floor(k / 7) * step;
    const ahead = d.date > data.day;
    const goal = !ahead && d.minutes >= GOAL;
    const some = !ahead && !goal && d.minutes >= 2;

    if (goal || some) {
      ctx.fillStyle = goal ? ORANGE : 'rgba(242, 100, 48, 0.45)';
      roundRect(ctx, cx, cy, s.cell, s.cell, r);
      ctx.fill();
    } else {
      ctx.globalAlpha = ahead ? 0.5 : 1;
      ctx.strokeStyle = colors.faint;
      ctx.lineWidth = line;
      roundRect(ctx, cx + line / 2, cy + line / 2, s.cell - line, s.cell - line, r);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = goal ? '#FFFFFF' : some ? colors.fg : ahead ? colors.faint : colors.soft;
    ctx.fillText(String(Number(d.date.slice(8, 10))), cx + s.cell / 2, cy + s.cell / 2 + s.numbers * 0.04);

    if (d.date === data.day) {
      const o = line * 2.2;
      ctx.strokeStyle = colors.fg;
      ctx.lineWidth = line * 1.2;
      roundRect(ctx, cx - o, cy - o, s.cell + 2 * o, s.cell + 2 * o, r + o);
      ctx.stroke();
    }
  });
  ctx.restore();
  return y + calendarHeight(data, s);
}
