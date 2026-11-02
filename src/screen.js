import confetti from 'canvas-confetti';
import QRCode from 'qrcode';
import { TIERS } from './routes.js';
import { drawMap } from './map.js';
import { joinLobby, leaderboard, onNewRun, online } from './net.js';

const $ = (id) => document.getElementById(id);
const live = new Map(); // id -> latest tick
let range = 'all';
const tops = {}; // tier -> best time ms (to detect new records)

// ---------- QR ----------
const playUrl = location.origin + '/';
$('playUrl').textContent = playUrl.replace(/^https?:\/\//, '');
QRCode.toCanvas($('qr'), playUrl, { width: 132, margin: 1, color: { dark: '#0a0f17', light: '#ffffff' } });

// ---------- boards ----------
async function renderBoards() {
  const html = await Promise.all(
    Object.values(TIERS).map(async (t) => {
      const rows = await leaderboard(t.id, { today: range === 'today', limit: 6 });
      const prev = tops[t.id];
      if (rows[0] && prev !== undefined && rows[0].time_ms < prev) celebrate(t, rows[0]);
      if (rows[0]) tops[t.id] = rows[0].time_ms;
      else if (prev === undefined) tops[t.id] = Infinity;
      const body = rows.length
        ? rows
            .map(
              (r, i) => `<div class="b-row ${i === 0 ? 'first' : ''}"><span class="rk">${i === 0 ? '👑' : i + 1}</span><i style="background:${r.color}"></i><span class="n">${esc(r.player_name)}</span><span class="t">${fmt(r.time_ms)}</span></div>`
            )
            .join('')
        : '<div class="b-empty">No runs yet. Be first!</div>';
      return `<div class="board" style="--lc:${t.color}"><div class="b-head"><span class="b-diff">${t.label}</span><span class="b-name">${t.name}</span><span class="b-route">${t.stations[0][0]} → ${t.stations.at(-1)[0]}</span></div>${body}</div>`;
    })
  );
  $('boards').innerHTML = html.join('');
}
$('rangeSeg').onclick = (e) => {
  const r = e.target.dataset.r;
  if (!r) return;
  range = r;
  [...$('rangeSeg').children].forEach((b) => b.classList.toggle('on', b.dataset.r === r));
  renderBoards();
};
renderBoards();
onNewRun(() => renderBoards());
setInterval(renderBoards, 15000);

function celebrate(t, row) {
  banner(`👑 NEW ${t.label.toUpperCase()} RECORD · <b style="color:${row.color}">${esc(row.player_name)}</b> · ${fmt(row.time_ms)}`);
  confetti({ particleCount: 220, spread: 100, origin: { y: 0.4 }, colors: [row.color, t.color, '#fff'] });
}

// ---------- lobby ----------
const lobby = joinLobby({
  presence: null,
  onPresence: (state) => {
    const ready = Object.values(state).flat().filter((m) => m.ready);
    $('readyCount').textContent = ready.length ? `${ready.length} ready` : 'No one ready';
    $('readyNames').innerHTML = ready.map((m) => `<i style="background:${m.color}" title="${esc(m.name)}"></i>`).join('');
  },
  onEvent: (ev, p) => {
    if (ev === 'tick') live.set(p.id, { ...p, at: performance.now() });
    if (ev === 'finish') {
      live.delete(p.id);
      feed(p.missed ? `🚪 <b style="color:${p.color}">${esc(p.name)}</b> MISSED the train at ${TIERS[p.tier]?.to.name}` : `🚇 <b style="color:${p.color}">${esc(p.name)}</b> CAUGHT the train at ${TIERS[p.tier]?.to.name} in ${fmt(p.time_ms)}`);
      setTimeout(renderBoards, 1200);
    }
    if (ev === 'sabo') {
      const tgt = live.get(p.target);
      feed(`⚡ <b style="color:${p.fromColor}">${esc(p.fromName)}</b> ${p.type === 'freeze' ? 'froze' : 'shrank'} <b style="color:${tgt?.color || '#fff'}">${esc(tgt?.name || 'a rival')}</b>`);
    }
  },
});
$('liveDot').classList.toggle('off', !online);
$('liveDot').textContent = online ? 'LIVE' : 'LOCAL';

$('battleBtn').onclick = () => {
  const tier = $('battleTier').value;
  const startAt = Date.now() + 8000;
  lobby.send('battle', { tier, startAt });
  banner(`⚔️ BATTLE on ${TIERS[tier].name} starts in 8 seconds!`, 6000);
};

// ---------- map + now playing ----------
const canvas = $('scrMap');
const ctx = canvas.getContext('2d');
function sizeCanvas() {
  const r = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = r.width * dpr;
  canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvas._w = r.width;
  canvas._h = r.height;
}
addEventListener('resize', sizeCanvas);
sizeCanvas();

let shownTier = 'medium';
let lastSwitch = 0;
function frame(now) {
  for (const [id, p] of live) if (now - p.at > 4000) live.delete(id);
  const players = [...live.values()].sort((a, b) => b.progress - a.progress);
  // show the busiest tier, else rotate every 8 s
  const counts = {};
  players.forEach((p) => (counts[p.tier] = (counts[p.tier] || 0) + 1));
  const busiest = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (busiest) shownTier = busiest;
  else if (now - lastSwitch > 8000) {
    const ids = Object.keys(TIERS);
    shownTier = ids[(ids.indexOf(shownTier) + 1) % ids.length];
    lastSwitch = now;
  }
  const tier = TIERS[shownTier];
  const npH = $('npList').parentElement.offsetHeight || 80;
  drawMap(ctx, canvas._w, canvas._h, tier, {
    dist: null,
    follow: false,
    padTop: 90,
    padBottom: npH + 50,
    padLeft: 60,
    padRight: 200,
    labelSize: canvas._w > 1200 ? 13 : 11,
    othersScale: canvas._w > 1200 ? 0.95 : 0.75,
    othersAlpha: 1,
    tagSize: canvas._w > 1200 ? 15 : 13,
    others: players.filter((p) => p.tier === tier.id).map((p) => ({ dist: p.dist, color: p.color, name: p.name })),
  });
  $('mapLabel').innerHTML = `<span style="background:${tier.color}">${tier.code}</span>${tier.name} · ${tier.line}`;

  $('npCount').textContent = players.length ? `(${players.length})` : '';
  $('npList').innerHTML = players.length
    ? players
        .map(
          (p) => `<div class="np-row"><i style="background:${p.color}"></i><span class="n">${esc(p.name)}</span><span class="tb" style="background:${TIERS[p.tier]?.color}">${TIERS[p.tier]?.label}</span><div class="np-bar"><div style="width:${(p.progress * 100).toFixed(1)}%;background:${p.color}"></div></div><span class="st">${esc(p.station)}</span><span class="sp">${p.speed} km/h${p.mult > 1 ? ` · x${p.mult}` : ''}</span><div class="np-motion"><div style="height:${p.motion}%"></div></div></div>`
        )
        .join('')
    : '<div class="np-empty">Nobody racing. Scan the QR or open the link on a laptop to play.</div>';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- helpers ----------
function feed(html) {
  const el = document.createElement('div');
  el.className = 'feed-item';
  el.innerHTML = html;
  $('feed').prepend(el);
  setTimeout(() => el.remove(), 7000);
}
let bt;
function banner(html, ms = 4500) {
  $('banner').innerHTML = html;
  $('banner').classList.remove('hidden');
  clearTimeout(bt);
  bt = setTimeout(() => $('banner').classList.add('hidden'), ms);
}
function fmt(ms) {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
