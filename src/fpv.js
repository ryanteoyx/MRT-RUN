// First-person street view: a cartoon pseudo-3D CBD street that scrolls with distance run.
// Buildings, trees and lamp posts are billboards placed along the route by distance (seeded),
// projected toward a vanishing point, so faster waving = the street rushes past faster.

const sky = new Image();
sky.src = '/skyline.svg';

const PALETTE = ['#f4c7a1', '#bfe3d0', '#f7e3a1', '#b9d7f0', '#f2b5b5', '#d9c8f0', '#c8e6a0'];
const ROOF = ['#c0563b', '#7a8f6a', '#a4553f', '#5d7fa3'];

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const cache = new Map();
function propsFor(tier) {
  if (cache.has(tier.id)) return cache.get(tier.id);
  const rnd = seeded(tier.id.length * 9973 + Math.round(tier.length));
  const items = [];
  for (let d = 0; d < tier.length + 200; d += 9 + rnd() * 10) {
    for (const side of [-1, 1]) {
      const r = rnd();
      if (r < 0.62) {
        const tall = rnd() < (tier.id === 'easy' || tier.id === 'hard' ? 0.35 : 0.15);
        items.push({ d: d + rnd() * 4, side, kind: tall ? 'tower' : 'shop', h: tall ? 3.5 + rnd() * 3 : 1.1 + rnd() * 0.6, w: 0.9 + rnd() * 0.6, c: PALETTE[Math.floor(rnd() * PALETTE.length)], roof: ROOF[Math.floor(rnd() * ROOF.length)] });
      } else if (r < 0.85) items.push({ d: d + rnd() * 4, side, kind: 'tree', h: 0.9 + rnd() * 0.4 });
      else items.push({ d: d + rnd() * 4, side, kind: 'lamp' });
    }
  }
  cache.set(tier.id, items);
  return items;
}

export function drawStreet(ctx, w, h, tier, dist, opts = {}) {
  const horizon = h * 0.42;
  const vx = w / 2;
  // sky + skyline
  const g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, '#8ec5e8');
  g.addColorStop(1, '#f6d7b8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, horizon + 2);
  if (sky.complete && sky.naturalWidth) {
    const sw = w * 1.3;
    const sh = sw * (900 / 1600);
    const shift = (dist * 0.15) % 40;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(sky, -w * 0.15 - shift, horizon - sh * 0.62, sw, sh);
    ctx.globalAlpha = 1;
  }
  // ground
  ctx.fillStyle = '#d9cfb8';
  ctx.fillRect(0, horizon, w, h - horizon);
  // road (trapezoid) + pavements
  const roadTop = 0.04 * w;
  const roadBot = 0.9 * w;
  ctx.fillStyle = '#8f98a2';
  ctx.beginPath();
  ctx.moveTo(vx - roadTop, horizon);
  ctx.lineTo(vx + roadTop, horizon);
  ctx.lineTo(vx + roadBot / 2, h);
  ctx.lineTo(vx - roadBot / 2, h);
  ctx.closePath();
  ctx.fill();
  // pavement where you run (centre strip, lighter)
  ctx.fillStyle = '#e9e2d0';
  ctx.beginPath();
  ctx.moveTo(vx - roadTop * 0.35, horizon);
  ctx.lineTo(vx + roadTop * 0.35, horizon);
  ctx.lineTo(vx + w * 0.16, h);
  ctx.lineTo(vx - w * 0.16, h);
  ctx.closePath();
  ctx.fill();
  // moving paving lines
  const z = (k) => 1 / k; // depth helper
  ctx.strokeStyle = 'rgba(150,140,120,0.5)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 18; i++) {
    const dd = i * 4 - (dist % 4);
    if (dd <= 0.5) continue;
    const y = horizon + (h - horizon) * (2 / dd);
    if (y > h) continue;
    const half = (w * 0.16 - roadTop * 0.35) * (y - horizon) / (h - horizon) + roadTop * 0.35;
    ctx.beginPath();
    ctx.moveTo(vx - half, y);
    ctx.lineTo(vx + half, y);
    ctx.stroke();
  }
  // billboards from far to near
  const items = propsFor(tier);
  const vis = items.filter((it) => it.d > dist + 1.5 && it.d < dist + 70).sort((a, b) => b.d - a.d);
  for (const it of vis) {
    const dd = it.d - dist;
    const s = 2 / dd; // perspective scale
    const y = horizon + (h - horizon) * s;
    const xOff = (it.kind === 'lamp' ? 0.55 : it.kind === 'tree' ? 0.75 : 1.25) * w * s * 1.1;
    const x = vx + it.side * xOff;
    const unit = w * s * 0.5;
    if (it.kind === 'shop' || it.kind === 'tower') {
      const bw = unit * it.w * 1.6;
      const bh = unit * it.h * 1.6;
      const bx = it.side < 0 ? x - bw : x;
      ctx.fillStyle = it.kind === 'tower' ? '#a9bccb' : it.c;
      ctx.fillRect(bx, y - bh, bw, bh);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(it.side < 0 ? bx + bw - bw * 0.12 : bx, y - bh, bw * 0.12, bh);
      if (it.kind === 'shop') {
        ctx.fillStyle = it.roof;
        ctx.fillRect(bx - bw * 0.04, y - bh - bh * 0.1, bw * 1.08, bh * 0.12);
        ctx.fillStyle = 'rgba(60,70,80,0.55)';
        for (let k = 0; k < 3; k++) ctx.fillRect(bx + bw * (0.12 + k * 0.29), y - bh * 0.8, bw * 0.16, bh * 0.28);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(bx, y - bh * 0.32, bw, bh * 0.06);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        for (let k = 1; k < 10; k++) ctx.fillRect(bx, y - bh * (k / 10), bw, Math.max(1, bh * 0.012));
      }
    } else if (it.kind === 'tree') {
      const r = unit * it.h * 0.55;
      ctx.fillStyle = '#7b5a3c';
      ctx.fillRect(x - r * 0.08, y - r * 1.2, r * 0.16, r * 1.2);
      ctx.fillStyle = '#5e9e58';
      ctx.beginPath();
      ctx.arc(x, y - r * 1.5, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7fbf6a';
      ctx.beginPath();
      ctx.arc(x - r * 0.25, y - r * 1.7, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const lh = unit * 2.2;
      ctx.strokeStyle = '#4a5560';
      ctx.lineWidth = Math.max(1, unit * 0.06);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - lh);
      ctx.lineTo(x - it.side * unit * 0.3, y - lh);
      ctx.stroke();
    }
  }
  // destination station sign approaching at the end
  const toGo = tier.length - dist;
  if (toGo < 70) {
    const s = 2 / Math.max(2, toGo);
    const y = horizon + (h - horizon) * s;
    const sw = w * s * 0.9;
    const sh = sw * 0.32;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(vx - sw / 2, y - sh * 3.2, sw, sh);
    ctx.fillStyle = tier.color;
    ctx.fillRect(vx - sw / 2, y - sh * 3.2, sw * 0.22, sh);
    ctx.fillStyle = '#111';
    ctx.font = `800 ${Math.max(8, sh * 0.42)}px Inter, system-ui`;
    ctx.textAlign = 'left';
    ctx.fillText(tier.to.name, vx - sw / 2 + sw * 0.26, y - sh * 3.2 + sh * 0.62);
  }
  // speed lines when fast
  const sp = opts.speed || 0;
  if (sp > 0.55) {
    ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.5, (sp - 0.55) * 1.2)})`;
    ctx.lineWidth = 2;
    const t = performance.now() / 60;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + t * 0.01;
      const r0 = w * 0.28 + ((t * 30 + i * 80) % (w * 0.3));
      ctx.beginPath();
      ctx.moveTo(vx + Math.cos(a) * r0, horizon + Math.sin(a) * r0 * 0.6);
      ctx.lineTo(vx + Math.cos(a) * (r0 + 40), horizon + Math.sin(a) * (r0 + 40) * 0.6);
      ctx.stroke();
    }
  }
  // gentle head-bob vignette
  const vg = ctx.createRadialGradient(vx, h * 0.55, h * 0.3, vx, h * 0.55, h * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}
