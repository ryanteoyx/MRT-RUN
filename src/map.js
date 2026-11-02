// 2D MRT map renderer: real station geometry, following camera, minimap.
import { pointAt } from './routes.js';

const LAT0 = 1.35;
const KX = Math.cos((LAT0 * Math.PI) / 180) * 111320; // metres per deg lng
const KY = 110574; // metres per deg lat
const toM = (lat, lng) => ({ x: (lng - 103.8) * KX, y: -(lat - LAT0) * KY });

// Seeded decorative "streets" so the map has texture without real tiles.
const streets = (() => {
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out = [];
  for (let i = 0; i < 260; i++) {
    const x = -6000 + rnd() * 24000;
    const y = -12000 + rnd() * 20000;
    const a = rnd() * Math.PI;
    const len = 400 + rnd() * 2200;
    out.push([x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, rnd() > 0.85 ? 2 : 1]);
  }
  return out;
})();

export function drawMap(ctx, w, h, tier, st) {
  const pts = tier.stations.map((s) => toM(s[1], s[2]));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const bounds = {
    x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys),
  };

  let cx, cy, scale;
  const me = st.dist != null ? pointAt(tier, st.dist) : null;
  const meM = me ? toM(me.lat, me.lng) : null;
  if (st.follow && meM) {
    scale = Math.min(w, h) / (st.viewMetres || 2600);
    // look slightly ahead
    const ahead = toM(...latlng(pointAt(tier, st.dist + 350)));
    cx = meM.x * 0.6 + ahead.x * 0.4;
    cy = meM.y * 0.6 + ahead.y * 0.4;
  } else {
    const pad = 70;
    scale = Math.min((w - pad * 2) / (bounds.x1 - bounds.x0 || 1), (h - pad * 2) / (bounds.y1 - bounds.y0 || 1));
    cx = (bounds.x0 + bounds.x1) / 2;
    cy = (bounds.y0 + bounds.y1) / 2;
  }
  const P = (p) => ({ x: w / 2 + (p.x - cx) * scale, y: h / 2 + (p.y - cy) * scale });

  // background
  const g = ctx.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, '#16202e');
  g.addColorStop(1, '#0a0f17');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // streets
  ctx.lineCap = 'round';
  for (const [x1, y1, x2, y2, major] of streets) {
    const a = P({ x: x1, y: y1 });
    const b = P({ x: x2, y: y2 });
    ctx.strokeStyle = major === 2 ? 'rgba(120,140,170,0.16)' : 'rgba(120,140,170,0.08)';
    ctx.lineWidth = major === 2 ? Math.max(1.5, 14 * scale) : Math.max(1, 7 * scale);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // track: casing + line colour + progress glow
  const sp = pts.map(P);
  const lw = st.follow ? 14 : 8;
  path(ctx, sp);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = lw + 6;
  ctx.stroke();
  path(ctx, sp);
  ctx.strokeStyle = tier.color;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (st.dist != null) {
    const done = [];
    for (let i = 0; i < tier.cum.length && tier.cum[i] <= st.dist; i++) done.push(sp[i]);
    done.push(P(meM));
    path(ctx, done);
    ctx.strokeStyle = tier.color;
    ctx.shadowColor = tier.color;
    ctx.shadowBlur = 18;
    ctx.lineWidth = lw;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // obstacles
  for (const o of st.obstacles || []) {
    if (o.done) continue;
    const p = P(toM(...latlng(pointAt(tier, o.dist))));
    const r = st.follow ? 20 : 10;
    const pulse = 1 + 0.15 * Math.sin(performance.now() / 120);
    ctx.fillStyle = o.color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - r * pulse);
    ctx.lineTo(p.x + r * pulse, p.y + r * 0.8 * pulse);
    ctx.lineTo(p.x - r * pulse, p.y + r * 0.8 * pulse);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = `800 ${st.follow ? 18 : 10}px Inter, system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText('!', p.x, p.y + r * 0.55);
  }

  // stations
  ctx.textAlign = 'left';
  tier.stations.forEach((s, i) => {
    const p = sp[i];
    const passed = st.dist != null && tier.cum[i] <= st.dist;
    const terminus = i === 0 || i === tier.stations.length - 1;
    const r = st.follow ? (terminus ? 11 : 8) : terminus ? 7 : 5;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = passed ? tier.color : '#3a4658';
    ctx.lineWidth = st.follow ? 4 : 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (st.follow || terminus || st.labels !== false) {
      const label = `${tier.code}·${s[0]}`;
      ctx.font = `${terminus ? 700 : 600} ${st.follow ? 15 : 11}px Inter, system-ui`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(10,15,23,0.75)';
      roundRect(ctx, p.x + r + 6, p.y - 11, tw + 12, 22, 6);
      ctx.fill();
      ctx.fillStyle = passed ? '#fff' : '#9fb0c6';
      ctx.fillText(label, p.x + r + 12, p.y + 5);
    }
  });

  // other trains (ghosts)
  for (const o of st.others || []) {
    const p = P(toM(...latlng(pointAt(tier, o.dist))));
    drawTrain(ctx, p, angleAt(tier, o.dist, P), o.color, st.follow ? 0.9 : 0.6, 0.55, o.name);
  }
  // personal-best ghost
  if (st.ghostDist != null) {
    const p = P(toM(...latlng(pointAt(tier, st.ghostDist))));
    drawTrain(ctx, p, angleAt(tier, st.ghostDist, P), '#ffffff', st.follow ? 0.9 : 0.6, 0.25, 'PB');
  }
  // me
  if (meM) {
    const p = P(meM);
    drawTrain(ctx, p, angleAt(tier, st.dist, P), st.myColor || tier.color, st.follow ? 1.15 : 0.8, 1, null, st.frozen);
  }

  if (st.follow && st.minimap !== false) drawMinimap(ctx, w, h, tier, st, pts, bounds);
}

function latlng(p) {
  return [p.lat, p.lng];
}

function angleAt(tier, dist, P) {
  const a = P(toM(...latlng(pointAt(tier, Math.max(0, dist - 40)))));
  const b = P(toM(...latlng(pointAt(tier, Math.min(tier.length, dist + 40)))));
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function drawTrain(ctx, p, ang, color, s, alpha, label, frozen) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(p.x, p.y);
  ctx.rotate(ang);
  ctx.scale(s, s);
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;
  ctx.fillStyle = frozen ? '#9fe8ff' : '#f4f6fa';
  roundRect(ctx, -34, -11, 68, 22, 9);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.fillRect(-34, 3, 68, 4);
  ctx.fillStyle = '#1b2533';
  for (let i = -26; i < 22; i += 13) roundRect(ctx, i, -7, 9, 7, 2), ctx.fill();
  ctx.fillStyle = '#ffe680';
  ctx.beginPath();
  ctx.arc(31, 0, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (label) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha + 0.3);
    ctx.font = '700 12px Inter, system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.fillText(label, p.x, p.y - 22 * s);
    ctx.restore();
  }
}

function drawMinimap(ctx, w, h, tier, st, pts, b) {
  const mw = 190;
  const mh = 150;
  const x0 = w - mw - 16;
  const y0 = h - mh - 16;
  ctx.fillStyle = 'rgba(8,12,18,0.82)';
  roundRect(ctx, x0, y0, mw, mh, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
  const pad = 18;
  const sc = Math.min((mw - pad * 2) / (b.x1 - b.x0 || 1), (mh - pad * 2) / (b.y1 - b.y0 || 1));
  const M = (p) => ({
    x: x0 + mw / 2 + (p.x - (b.x0 + b.x1) / 2) * sc,
    y: y0 + mh / 2 + (p.y - (b.y0 + b.y1) / 2) * sc,
  });
  path(ctx, pts.map(M));
  ctx.strokeStyle = tier.color;
  ctx.lineWidth = 4;
  ctx.stroke();
  for (const p of pts.map(M)) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  const me = M(toM(...latlng(pointAt(tier, st.dist))));
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(me.x, me.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function path(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
