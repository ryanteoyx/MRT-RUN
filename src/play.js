import confetti from 'canvas-confetti';
import { TIERS, nextStationIndex } from './routes.js';
import { drawMap } from './map.js';
import { MotionEngine } from './motion.js';
import { joinLobby, saveRun, leaderboard, online } from './net.js';
import { sfx, initAudio } from './sound.js';

const $ = (id) => document.getElementById(id);
const COLORS = ['#ff3b6b', '#ffb020', '#2ee6a6', '#38b6ff', '#a66bff', '#ff7ad9', '#f4f6fa'];

// ---------- identity ----------
const myId = localStorage.getItem('mrtrun_id') || crypto.randomUUID();
localStorage.setItem('mrtrun_id', myId);
let myName = localStorage.getItem('mrtrun_name') || '';
let myColor = localStorage.getItem('mrtrun_color') || COLORS[0];
let tierId = localStorage.getItem('mrtrun_tier') || 'easy';

// ---------- config ----------
const COMBO_ON = 40;
const OBSTACLES = {
  signal: { title: 'SIGNAL FAULT', sub: 'THRASH HARD to reset the signal!', need: 1.4, color: '#ffb020', test: (m) => m > 55, speed: 0 },
  doors: { title: 'DOORS CLOSING', sub: 'FREEZE! Stand completely still', need: 1.5, color: '#38b6ff', test: (m) => m < 10, speed: 0 },
  crowd: { title: 'CROWD SURGE', sub: 'Keep moving to push through!', need: 2.5, color: '#ff3b6b', test: (m) => m > 35, speed: 0.35 },
};
const OB_TIMEOUT = 6;

// ---------- state ----------
const canvas = $('map');
const ctx = canvas.getContext('2d');
let engine = null;
let phase = 'join'; // join | calibrate | countdown | race | finish
let race = null;
const others = new Map();
let lobby = null;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);
resize();

// ---------- join screen ----------
$('name').value = myName;
function renderColors() {
  $('colors').innerHTML = COLORS.map(
    (c) => `<button class="swatch ${c === myColor ? 'on' : ''}" data-c="${c}" style="--c:${c}"></button>`
  ).join('');
}
$('colors').onclick = (e) => {
  const c = e.target.dataset.c;
  if (!c) return;
  myColor = c;
  renderColors();
};
renderColors();

async function renderTiers() {
  const cards = await Promise.all(
    Object.values(TIERS).map(async (t) => {
      const lb = await leaderboard(t.id, { limit: 1 }).catch(() => []);
      const best = lb[0] ? `${fmt(lb[0].time_ms)} by ${esc(lb[0].player_name)}` : 'No runs yet';
      return `<button class="tier ${t.id === tierId ? 'on' : ''}" data-t="${t.id}" style="--lc:${t.color}">
        <span class="tier-diff">${t.label}</span>
        <span class="tier-name">${t.name}</span>
        <span class="tier-route">${t.stations[0][0]} → ${t.stations.at(-1)[0]}</span>
        <span class="tier-meta">${t.line} · ${t.stations.length} stops · ${(t.length / 1000).toFixed(1)} km</span>
        <span class="tier-best">Record: ${best}</span>
      </button>`;
    })
  );
  $('tiers').innerHTML = cards.join('');
}
$('tiers').onclick = (e) => {
  const b = e.target.closest('.tier');
  if (!b) return;
  tierId = b.dataset.t;
  document.querySelectorAll('.tier').forEach((x) => x.classList.toggle('on', x === b));
};
renderTiers();
if (!online) $('joinMsg').textContent = 'Offline mode: leaderboard is saved on this browser only.';

$('startBtn').onclick = () => begin();
$('againBtn').onclick = () => begin();
$('menuBtn').onclick = () => {
  show('finish', false);
  show('join', true);
  phase = 'join';
  renderTiers();
};

// ---------- lobby ----------
function connectLobby() {
  if (lobby) return;
  lobby = joinLobby({
    presence: { id: myId, name: myName, color: myColor },
    onEvent: (ev, p) => {
      if (ev === 'tick' && p.id !== myId) others.set(p.id, { ...p, at: performance.now() });
      if (ev === 'finish') others.delete(p.id);
      if (ev === 'sabo' && p.target === myId) receiveSabo(p);
      if (ev === 'battle' && $('battleReady').checked && (phase === 'join' || phase === 'finish')) {
        tierId = p.tier;
        begin(p.startAt);
      }
    },
  });
}

// ---------- flow ----------
async function begin(battleStartAt) {
  myName = $('name').value.trim().slice(0, 16);
  if (!myName) {
    $('joinMsg').textContent = 'Enter a name first.';
    $('name').focus();
    return;
  }
  localStorage.setItem('mrtrun_name', myName);
  localStorage.setItem('mrtrun_color', myColor);
  localStorage.setItem('mrtrun_tier', tierId);
  initAudio();
  connectLobby();
  lobby.track?.({ id: myId, name: myName, color: myColor, tier: tierId });

  show('join', false);
  show('finish', false);
  show('camCard', true);
  const tier = TIERS[tierId];
  race = newRace(tier, Boolean(battleStartAt));
  setHud(tier);

  if (!engine) {
    engine = new MotionEngine($('video'), $('overlay'));
    center('Starting camera…');
    try {
      const cv = await engine.start();
      $('engineTag').textContent = cv ? 'OpenCV.js' : 'Canvas fallback';
      $('engineTag').classList.toggle('warn', !cv);
    } catch (e) {
      center('Camera blocked. Allow camera access and reload.');
      return;
    }
  }
  phase = 'calibrate';
  center('<b>Stand still</b><br><small>Calibrating your room</small>');
  await engine.calibrate(2200);

  phase = 'countdown';
  const startAt = battleStartAt || Date.now() + 3000;
  if (battleStartAt) center('<b>BATTLE</b><br><small>Get ready</small>');
  await countdown(startAt);
  center(null);
  show('hud', true);
  show('saboBar', true);
  race.t0 = performance.now();
  phase = 'race';
  sfx.horn();
}

function newRace(tier, battle) {
  const vmax = tier.length / (0.62 * tier.targetSec);
  return {
    tier, battle, vmax, dist: 0, v: 0, t0: 0, elapsed: 0,
    comboT: 0, lowT: 0, mult: 1,
    obstacles: [], nextObAt: rand(...tier.obstacleEvery), active: null, cleared: 0,
    boostUntil: 0, frozenUntil: 0, shrinkUntil: 0, immuneUntil: 0,
    charges: 0, sabosSent: 0, lastStation: 0,
    trace: [], ghost: loadGhost(tier.id),
  };
}

async function countdown(startAt) {
  while (Date.now() < startAt) {
    const s = Math.ceil((startAt - Date.now()) / 1000);
    if (s <= 3) center(`<span class="big">${s}</span>`);
    await sleep(100);
  }
  center('<span class="big go">GO!</span>');
  setTimeout(() => phase === 'race' && center(null), 600);
}

// ---------- main loop ----------
let last = performance.now();
let lastTick = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (phase === 'race') update(dt, now);
  render(now);
  if (phase === 'race' && now - lastTick > 200) {
    lastTick = now;
    broadcastTick();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function update(dt, now) {
  const r = race;
  const t = r.tier;
  r.elapsed = (now - r.t0) / 1000;
  const m = engine ? engine.motion : 0;
  $('meterFill').style.width = `${m}%`;

  // shrink sabotage
  if (engine) engine.shrink = now < r.shrinkUntil ? { x: 0.38, y: 0.3, w: 0.24, h: 0.4 } : null;

  // combo
  if (m > COMBO_ON) {
    r.comboT += dt;
    r.lowT = 0;
  } else {
    r.lowT += dt;
    if (r.lowT > 0.6) r.comboT = 0;
  }
  const newMult = r.comboT >= 10 ? 2 : r.comboT >= 6 ? 1.5 : r.comboT >= 3 ? 1.25 : 1;
  if (newMult > r.mult) sfx.combo();
  r.mult = newMult;

  // obstacles: spawn ahead on the track
  if (!r.active && r.elapsed > r.nextObAt && r.dist < t.length - 500) {
    const keys = Object.keys(OBSTACLES);
    const type = keys[Math.floor(Math.random() * keys.length)];
    r.obstacles.push({ type, dist: r.dist + 220 + Math.random() * 180, color: OBSTACLES[type].color });
    r.nextObAt = r.elapsed + rand(...t.obstacleEvery) + 3;
  }
  // hit obstacle
  if (!r.active) {
    const hit = r.obstacles.find((o) => !o.done && r.dist >= o.dist);
    if (hit) startObstacle(hit);
  }

  let speedFactor = 1;
  if (r.active) {
    const a = r.active;
    const def = OBSTACLES[a.type];
    a.t += dt;
    if (def.test(m)) a.progress += dt;
    $('obFill').style.width = `${Math.min(100, (a.progress / def.need) * 100)}%`;
    speedFactor = def.speed;
    if (a.progress >= def.need) endObstacle(true);
    else if (a.t > OB_TIMEOUT) endObstacle(false);
  }

  const frozen = now < r.frozenUntil;
  const boost = now < r.boostUntil ? 1.45 : 1;
  const target = frozen ? 0 : r.vmax * (m / 100) * r.mult * boost * speedFactor;
  r.v += (target - r.v) * Math.min(1, dt * 2.2);
  r.dist = Math.min(t.length, r.dist + r.v * dt);

  // ghost trace every 0.5 s
  const slot = Math.floor(r.elapsed * 2);
  if (r.trace.length <= slot) r.trace.push(Math.round(r.dist));

  // stations
  const ni = nextStationIndex(t, r.dist);
  const passed = ni === -1 ? t.stations.length - 1 : ni - 1;
  if (passed > r.lastStation) {
    r.lastStation = passed;
    if (passed < t.stations.length - 1) {
      toast(`Now at <b>${t.stations[passed][0]}</b>`, t.color);
      sfx.dingdong();
    }
  }

  // HUD
  $('timer').textContent = fmt(r.elapsed * 1000);
  $('progressFill').style.width = `${(r.dist / t.length) * 100}%`;
  $('nextStation').textContent = ni === -1 ? t.stations.at(-1)[0] : t.stations[ni][0];
  $('speed').textContent = Math.round(Math.min(130, (r.v / r.vmax) * 80));
  $('combo').textContent = `x${r.mult}`;
  $('comboBox').classList.toggle('hot', r.mult > 1);
  renderSabo();

  if (r.dist >= t.length - 0.5) finish();
}

function startObstacle(o) {
  race.active = { ...o, ref: o, t: 0, progress: 0 };
  const def = OBSTACLES[o.type];
  $('obTitle').textContent = def.title;
  $('obSub').textContent = def.sub;
  $('obstacle').style.setProperty('--oc', def.color);
  $('obFill').style.width = '0%';
  show('obstacle', true);
  sfx.alarm();
}

function endObstacle(ok) {
  const a = race.active;
  a.ref.done = true;
  race.active = null;
  show('obstacle', false);
  if (ok) {
    race.cleared++;
    race.boostUntil = performance.now() + 2200;
    const gained = race.charges < 2;
    race.charges = Math.min(2, race.charges + 1);
    toast(`Cleared! <b>Speed boost</b>${gained ? ' · +1 sabotage' : ''}`, '#2ee6a6');
    sfx.clear();
  } else {
    toast('Too slow! Obstacle timed out', '#ff3b6b');
  }
}

// ---------- sabotage ----------
function pickTarget() {
  const now = performance.now();
  const live = [...others.values()].filter((o) => now - o.at < 3000 && o.status === 'race');
  const same = live.filter((o) => o.tier === tierId);
  const pool = same.length ? same : live;
  if (!pool.length) return null;
  const myProg = race ? race.dist / race.tier.length : 0;
  const ahead = pool.filter((o) => o.progress > myProg).sort((a, b) => a.progress - b.progress);
  return ahead[0] || pool.sort((a, b) => b.progress - a.progress)[0];
}

function renderSabo() {
  const tgt = pickTarget();
  $('charges').innerHTML = [0, 1].map((i) => `<span class="pip ${i < race.charges ? 'on' : ''}"></span>`).join('');
  const can = race.charges > 0 && tgt;
  $('saboFreeze').disabled = !can;
  $('saboShrink').disabled = !can;
  $('saboTarget').innerHTML = tgt
    ? `Target: <b style="color:${tgt.color}">${esc(tgt.name)}</b>`
    : race.charges
      ? 'No rivals racing right now'
      : 'Clear obstacles to earn sabotage';
}

function fireSabo(type) {
  if (phase !== 'race' || race.charges < 1) return;
  const tgt = pickTarget();
  if (!tgt) return;
  race.charges--;
  race.sabosSent++;
  lobby.send('sabo', { from: myId, fromName: myName, fromColor: myColor, target: tgt.id, type });
  toast(`${type === 'freeze' ? 'Froze' : 'Shrunk'} <b>${esc(tgt.name)}</b>!`, '#a66bff');
  sfx.zap();
}
$('saboFreeze').onclick = () => fireSabo('freeze');
$('saboShrink').onclick = () => fireSabo('shrink');
addEventListener('keydown', (e) => {
  if (e.key === '1') fireSabo('freeze');
  if (e.key === '2') fireSabo('shrink');
});

function receiveSabo(p) {
  if (phase !== 'race') return;
  const now = performance.now();
  if (now < race.immuneUntil) return;
  race.immuneUntil = now + 6000;
  if (p.type === 'freeze') {
    race.frozenUntil = now + 3000;
    toast(`<b style="color:${p.fromColor}">${esc(p.fromName)}</b> FROZE your train!`, '#9fe8ff', 2800);
    document.body.classList.add('frozen');
    setTimeout(() => document.body.classList.remove('frozen'), 3000);
  } else {
    race.shrinkUntil = now + 5000;
    toast(`<b style="color:${p.fromColor}">${esc(p.fromName)}</b> SHRUNK your camera zone!`, '#ff3b6b', 2800);
  }
  sfx.alarm();
}

// ---------- network tick ----------
function broadcastTick() {
  const r = race;
  const ni = nextStationIndex(r.tier, r.dist);
  lobby?.send('tick', {
    id: myId, name: myName, color: myColor, tier: tierId, status: 'race',
    dist: Math.round(r.dist), progress: r.dist / r.tier.length,
    station: r.tier.stations[ni === -1 ? r.tier.stations.length - 1 : ni][0],
    speed: Math.round(Math.min(130, (r.v / r.vmax) * 80)), mult: r.mult,
    elapsed: r.elapsed, motion: Math.round(engine?.motion || 0),
  });
}

// ---------- finish ----------
async function finish() {
  phase = 'finish';
  const r = race;
  const ms = Math.round(r.elapsed * 1000);
  show('hud', false);
  show('saboBar', false);
  show('obstacle', false);
  lobby?.send('finish', { id: myId, name: myName, color: myColor, tier: tierId, time_ms: ms });
  sfx.horn();
  confetti({ particleCount: 160, spread: 80, origin: { y: 0.6 }, colors: [myColor, r.tier.color, '#ffffff'] });

  const prevGhost = r.ghost;
  const pb = !prevGhost || ms < prevGhost.ms;
  if (pb) localStorage.setItem(`mrtrun_ghost_${tierId}`, JSON.stringify({ ms, trace: r.trace }));

  await saveRun({
    player_id: myId, player_name: myName, color: myColor, tier: tierId,
    time_ms: ms, obstacles_cleared: r.cleared, sabos_sent: r.sabosSent, mode: r.battle ? 'battle' : 'solo',
  });

  $('finStation').textContent = r.tier.stations.at(-1)[0];
  $('finStation').style.color = r.tier.color;
  $('finTime').textContent = fmt(ms);
  $('finMeta').innerHTML = `${r.tier.name} · ${r.cleared} obstacles cleared${pb ? ' · <b class="pb">NEW PERSONAL BEST</b>' : ''}`;
  const lb = await leaderboard(tierId, { limit: 5 });
  $('finBoard').innerHTML = lb
    .map((row, i) => `<div class="row ${row.player_name === myName ? 'me' : ''}"><span>${i + 1}</span><i style="background:${row.color}"></i><span class="n">${esc(row.player_name)}</span><span class="t">${fmt(row.time_ms)}</span></div>`)
    .join('');
  show('finish', true);
}

// ---------- render ----------
function render(now) {
  const tier = race ? race.tier : TIERS[tierId];
  for (const [id, o] of others) if (now - o.at > 4000) others.delete(id);
  const ghost = race?.ghost;
  const ghostDist = ghost && phase === 'race' ? ghost.trace[Math.min(ghost.trace.length - 1, Math.floor(race.elapsed * 2))] : null;
  drawMap(ctx, innerWidth, innerHeight, tier, {
    dist: race ? race.dist : phase === 'join' ? null : 0,
    follow: Boolean(race) && phase !== 'join',
    obstacles: race?.obstacles,
    others: [...others.values()].filter((o) => o.tier === tier.id).map((o) => ({ dist: o.dist, color: o.color, name: o.name })),
    ghostDist,
    myColor,
    frozen: race && now < race.frozenUntil,
    viewMetres: 2400,
  });
}

// ---------- helpers ----------
function setHud(t) {
  $('lineBadge').textContent = t.code;
  $('lineBadge').style.background = t.color;
}
function show(id, on) {
  $(id).classList.toggle('hidden', !on);
}
function center(html) {
  if (!html) return show('center', false);
  $('center').innerHTML = html;
  show('center', true);
}
let toastTimer;
function toast(html, color = '#fff', ms = 1800) {
  const el = $('toast');
  el.innerHTML = html;
  el.style.setProperty('--tc', color);
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}
function loadGhost(t) {
  try {
    return JSON.parse(localStorage.getItem(`mrtrun_ghost_${t}`));
  } catch {
    return null;
  }
}
export function fmt(ms) {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
const rand = (a, b) => a + Math.random() * (b - a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
