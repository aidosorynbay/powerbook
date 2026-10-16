/** A fortress of bricks for «Битва кланов» (approved 2026-10-17): every brick is a
 * share of its strength, the lost ones go from the top down and lie at its foot;
 * the team's banner flies on a pole that stands to the end. */
export type TeamKey = 'lighthouse' | 'sail';

const PAL: Record<TeamKey, { light: string; mid: string; dark: string; mortar: string; flag: string }> = {
  lighthouse: { light: '#8fb0c8', mid: '#5d7b93', dark: '#2f475a', mortar: '#14222c', flag: '/leagues/diamond.jpg' },
  sail: { light: '#e0a46c', mid: '#b07a4a', dark: '#6b4122', mortar: '#24160c', flag: '/leagues/bronze.jpg' },
};

let uid = 0;
const rng = (seed: number) => {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
};

type Brick = { x: number; y: number; w: number; h: number; merlon?: boolean };

/** hp 0..100; `falling` bricks (the latest strikes) tumble down on a loop. */
export function fortressSvg(team: TeamKey, hp: number, falling = 0, seed = team === 'lighthouse' ? 11 : 5): string {
  const P = PAL[team];
  const k = `wf${++uid}`;
  const r = rng(seed);
  const W = 14;
  const H = 8;
  const blocks: [number, number, number, number][] = [
    [12, 52, 72, 210],
    [148, 188, 72, 210],
    [52, 148, 122, 210],
    [74, 126, 42, 122],
  ];
  const bricks: Brick[] = [];
  for (const [x0, x1, y0, y1] of blocks) {
    let row = 0;
    for (let y = y1 - H; y >= y0 - 0.1; y -= H, row++) {
      for (let x = x0 - (row % 2 ? W / 2 : 0); x < x1; x += W) {
        const bx = Math.max(x0, x);
        const bw = Math.min(x + W, x1) - bx;
        if (bw < 3) continue;
        if (bx < 112 && bx + bw > 88 && y + H > 168) continue; // the gate
        bricks.push({ x: bx, y, w: bw, h: H });
      }
    }
  }
  for (const [x0, x1, y0] of [[12, 52, 72], [148, 188, 72], [52, 148, 122], [74, 126, 42]] as const)
    for (let x = x0; x + 9 <= x1 + 0.1; x += 13) bricks.push({ x, y: y0 - 9, w: 9, h: 9, merlon: true });

  const order = bricks
    .map((b, i) => [b.y + r() * 46 - (b.merlon ? 30 : 0), i] as const)
    .sort((a, z) => a[0] - z[0])
    .map((z) => z[1]);
  const lost = Math.round((bricks.length * (100 - Math.max(0, Math.min(100, hp)))) / 100);
  const gone = new Set(order.slice(0, lost));
  const tumbling = new Set(order.slice(Math.max(0, lost - falling), lost));

  let wall = '';
  bricks.forEach((b, i) => {
    const tone = r();
    const fill = tone < 0.33 ? P.light : tone < 0.75 ? P.mid : P.dark;
    if (gone.has(i) && !tumbling.has(i)) return;
    const rect =
      `<rect x="${b.x - 0.2}" y="${b.y - 0.2}" width="${b.w + 0.4}" height="${b.h + 0.4}" fill="${P.mortar}"/>` +
      `<rect x="${b.x + 0.7}" y="${b.y + 0.7}" width="${b.w - 1.4}" height="${b.h - 1.4}" rx="1.2" fill="${fill}"/>` +
      `<rect x="${b.x + 0.7}" y="${b.y + 0.7}" width="${b.w - 1.4}" height="1.5" rx="1" fill="#fff" opacity=".22"/>` +
      `<rect x="${b.x + 0.7}" y="${b.y + b.h - 2.3}" width="${b.w - 1.4}" height="1.6" rx="1" fill="#000" opacity=".28"/>`;
    if (tumbling.has(i)) {
      const dx = ((r() - 0.5) * 30).toFixed(1);
      const rot = ((r() - 0.5) * 200).toFixed(0);
      const d = (r() * 0.8).toFixed(2);
      wall += `<g style="--dx:${dx}px;--rot:${rot}deg;transform-box:fill-box;transform-origin:center;animation:fall${k} 3s ${d}s infinite">${rect}</g>`;
    } else wall += rect;
  });

  let rubble = '';
  for (let i = 0, n = Math.min(22, Math.round(lost / 3)); i < n; i++) {
    const x = 6 + r() * 188;
    rubble += `<rect x="${x.toFixed(1)}" y="${(204 + r() * 5).toFixed(1)}" width="${(5 + r() * 7).toFixed(1)}" height="${(3 + r() * 3).toFixed(1)}" rx="1" fill="${r() < 0.5 ? P.mid : P.dark}" transform="rotate(${((r() - 0.5) * 40).toFixed(0)} ${x.toFixed(1)} 207)"/>`;
  }
  let cracks = '';
  if (hp < 85) cracks += '<path d="M60 140 l6 10 -4 8 7 12" stroke="#000" stroke-opacity=".55" stroke-width="1.2" fill="none"/>';
  if (hp < 60)
    cracks +=
      '<path d="M140 150 l-5 9 5 7 -6 14" stroke="#000" stroke-opacity=".55" stroke-width="1.2" fill="none"/><path d="M95 70 l4 9 -3 9" stroke="#000" stroke-opacity=".5" stroke-width="1" fill="none"/>';

  const wave1 = 'M101 -16 Q118 -20 135 -16 T168 -16 L168 14 Q151 10 135 14 T101 14 Z';
  const wave2 = 'M101 -16 Q118 -12 135 -16 T168 -16 L168 14 Q151 18 135 14 T101 14 Z';
  return `<svg viewBox="-8 -46 216 262" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="overflow:visible;display:block;width:100%;height:auto">
<style>@keyframes fall${k}{0%,50%{transform:translate(0,0) rotate(0);opacity:1}85%{transform:translate(var(--dx),110px) rotate(var(--rot));opacity:1}100%{transform:translate(var(--dx),110px) rotate(var(--rot));opacity:0}}</style>
<defs><linearGradient id="${k}fs" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset=".5" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>
<clipPath id="${k}fl"><path d="${wave1}"><animate attributeName="d" dur="2.4s" repeatCount="indefinite" values="${wave1};${wave2};${wave1}"/></path></clipPath></defs>
<line x1="100" y1="210" x2="100" y2="-18" stroke="#c9b27a" stroke-width="2.2"/><circle cx="100" cy="-19" r="2.4" fill="#ffd659"/>
<g clip-path="url(#${k}fl)"><image href="${P.flag}" x="101" y="-40" width="67" height="120" preserveAspectRatio="xMidYMid slice"/><rect x="101" y="-16" width="67" height="30" fill="url(#${k}fs)"/></g>
${wall}
<path d="M88 210 V178 a12 12 0 0 1 24 0 V210 Z" fill="#05090c"/>
${cracks}${rubble}
</svg>`;
}
