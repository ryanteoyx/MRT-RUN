import confetti from 'canvas-confetti';
import { TIERS, nextStationIndex, pointAt } from './routes.js';
import { drawMap } from './map.js';
import { drawStreet } from './fpv.js';
import { initFP, setRoute, updateFP, drawSprites, fpAvailable, resizeFP } from './fp3d.js';
import { MotionEngine } from './motion.js';
import { joinLobby, saveRun, leaderboard, online } from './net.js';
import { sfx, initAudio, rumble, doorChime, announce } from './sound.js';

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
  escalator: { title: 'BROKEN ESCALATOR', sub: 'Wave hard!', need: 1.4, color: '#ffb020', test: (m) => m > 55, speed: 0 },
  redman: { title: 'RED MAN!', sub: 'Freeze!', need: 1.5, color: '#ff3b6b', test: (m) => m < 10, speed: 0 },
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

const street = $('street');
const sctx = street.getContext('2d');
const wave = $('waveChart').getContext('2d');
const waveHist = [];
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth || innerWidth;
  const ch = canvas.clientHeight || innerHeight;
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  street.width = innerWidth * dpr;
  street.height = innerHeight * dpr;
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
initFP($('fp3d'), $('sprites'));
addEventListener('resize', () => resizeFP());
function setRacing(on) {
  document.body.classList.toggle('racing', on);
  document.body.classList.toggle('fp', on && fpAvailable());
  if (engine) engine.showZones = on;
  requestAnimationFrame(() => { resize(); resizeFP(); });
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

async function renderTiers(withRecords = false) {
  if (!withRecords) renderTiers(true);
  const cards = await Promise.all(
    Object.values(TIERS).map(async (t) => {
      const lb = withRecords ? await leaderboard(t.id, { limit: 1 }).catch(() => []) : [];
      const best = lb[0] ? `${fmt(lb[0].time_ms)} by ${esc(lb[0].player_name)}` : 'No runs yet';
      const badges = (st) => st.codes.map((c, i) => `<i class="lb" style="background:${st.lines[i]?.color || st.lines[0].color}">${c}</i>`).join('');
      return `<button class="route ${t.id === tierId ? 'on' : ''}" data-t="${t.id}" style="--lc:${t.color}">
        <span class="r-diff r-${t.id}">${t.label}</span>
        <span class="r-main">
          <span class="r-chain">${badges(t.from)}<span class="r-walk">🚶 ${Math.round(t.length)} m</span>${badges(t.to)}</span>
          <span class="r-names">${t.from.name} → ${t.to.name}</span>
          <span class="r-best">${best === 'No runs yet' ? 'No record yet — be first' : 'Record ' + best}</span>
        </span>
        <span class="r-time"><b>${t.limitSec}s</b><small>doors close</small></span>
      </button>`;
    })
  );
  $('tiers').innerHTML = cards.join('');
}
$('tiers').onclick = (e) => {
  const b = e.target.closest('.route');
  if (!b) return;
  tierId = b.dataset.t;
  document.querySelectorAll('.route').forEach((x) => x.classList.toggle('on', x === b));
  go('setup');
};
renderTiers();
if (!online) $('joinMsg').textContent = 'Offline mode: leaderboard is saved on this browser only.';

// ---------- demo mode (?demo=1): simulated waving, no camera ----------
const DEMO = new URLSearchParams(location.search).has('demo');
function fakeEngine() {
  const e = { motion: 0, zones: { left: 0, right: 0, top: 0, tap: 0 }, lateral: 0, shrink: null, showZones: false, noise: 1 };
  e.start = async () => {
    setInterval(() => {
      const t = performance.now() / 1000;
      e.motion = 62 + 25 * Math.sin(t * 1.3);
      e.lateral = Math.sin(t * 0.45);
      e.zones.top = Math.sin(t * 0.8) > 0.6 ? 60 : 5;
      e.zones.tap = 50;
    }, 66);
    return false;
  };
  e.calibrate = async () => sleep(1500);
  e.stop = () => {};
  return e;
}

// ---------- step navigation ----------
let mode = 'solo';
function go(step) {
  $('join').dataset.step = step;
  if (step === 'setup') enterSetup();
}
$('join').addEventListener('click', (e) => {
  const t = e.target.closest('[data-go]');
  if (!t) return;
  const g = t.dataset.go;
  if (g === 'solo' || g === 'battle') {
    mode = g;
    $('battleReady').checked = g === 'battle';
    return go(g === 'solo' ? 'route' : 'setup');
  }
  go(g);
});
$('setupBack').onclick = () => go(mode === 'solo' ? 'route' : 'start');

async function enterSetup() {
  const solo = mode === 'solo';
  const t = TIERS[tierId];
  $('setupTitle').innerHTML = solo
    ? `Get ready · <span style="color:${t.color}">${t.from.name} → ${t.to.name}</span>`
    : 'Get ready · Battle';
  $('startBtn').innerHTML = solo ? 'Tap in &amp; run <span>→</span>' : 'Join battle <span>→</span>';
  $('joinMsg').textContent = '';
  // start the camera now so players can frame themselves before the run
  if (!engine) {
    engine = DEMO ? fakeEngine() : new MotionEngine($('video'), $('overlay'));
    try {
      const cv = await engine.start();
      $('engineTag').textContent = cv ? 'OpenCV.js' : 'Canvas fallback';
      $('engineTag').classList.toggle('warn', !cv);
    } catch (e) {
      engine = null;
      $('camPh').innerHTML = '<span>🚫</span>Camera blocked. Allow it in the address bar, then press Back and Next.';
      return;
    }
  }
  document.body.classList.add('setup');
  document.querySelector('.cam-slot').appendChild($('camCard'));
  $('camPh').style.display = 'none';
  show('camCard', true);
}

$('startBtn').onclick = () => {
  if (mode === 'solo') {
    document.body.classList.remove('setup');
    document.body.appendChild($('camCard'));
    return begin();
  }
  myName = $('name').value.trim().slice(0, 16);
  if (!myName) {
    $('joinMsg').textContent = 'Enter a name first.';
    return $('name').focus();
  }
  localStorage.setItem('mrtrun_name', myName);
  localStorage.setItem('mrtrun_color', myColor);
  initAudio();
  connectLobby();
  lobby.track?.({ id: myId, name: myName, color: myColor, tier: tierId, ready: true });
  $('startBtn').innerHTML = '✓ Ready · waiting for the host';
  $('startBtn').disabled = true;
  $('joinMsg').textContent = 'Keep moving a little so the green boxes appear. The race starts automatically when the host presses Start Battle on the big screen.';
};

$('againBtn').onclick = () => {
  show('finish', false);
  if (mode === 'battle') {
    show('join', true);
    phase = 'join';
    $('startBtn').disabled = false;
    return go('setup');
  }
  begin();
};
$('menuBtn').onclick = () => {
  show('finish', false);
  show('join', true);
  phase = 'join';
  $('startBtn').disabled = false;
  go(mode === 'solo' ? 'route' : 'start');
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
        document.body.classList.remove('setup');
        document.body.appendChild($('camCard'));
        $('startBtn').disabled = false;
        begin(p.startAt);
      }
    },
  });
}

// ---------- flow ----------
let starting = false;
async function begin(battleStartAt) {
  if (starting || phase === 'calibrate' || phase === 'countdown' || phase === 'race') return;
  starting = true;
  try {
    await beginInner(battleStartAt);
  } finally {
    starting = false;
  }
}
async function beginInner(battleStartAt) {
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
  setRoute(tier);
  document.body.classList.remove('frozen');
  setHud(tier);

  if (!engine) {
    engine = DEMO ? fakeEngine() : new MotionEngine($('video'), $('overlay'));
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
  // ---- first person: you are on the train ----
  phase = 'calibrate';
  center(null);
  const fromBadge = tier.from.codes.map((c, i) => `<i class="lb" style="background:${tier.from.lines[i]?.color || tier.from.lines[0].color}">${c}</i>`).join('');
  const toBadge = tier.to.codes.map((c, i) => `<i class="lb" style="background:${tier.to.lines[i]?.color || tier.to.lines[0].color}">${c}</i>`).join('');
  $('stars').innerHTML = `<span class="s-now">${fromBadge} ${tier.from.name}</span><span class="s-walk">🚶 ${Math.round(tier.length)} m</span><span class="s-next">${toBadge} ${tier.to.name}</span>`;
  $('doors').classList.remove('open');
  $('doorLight').classList.remove('on');
  show('onboard', true);
  rumble(6);
  const setMsg = (h) => ($('announce').innerHTML = h);
  setMsg(`<small>Arriving</small><b>${tier.from.name}</b><span>Hold still…</span>`);
  announce(`Next station, ${tier.from.name}. Transfer to the ${tier.to.lines.map((l) => l.name).join(' and ')} line at ${tier.to.name}. Your train leaves in ${tier.limitSec} seconds.`);
  await engine.calibrate(2600);
  setMsg(`<small>Doors opening</small><b>Wave to run</b><span>${tier.to.name} · ${tier.limitSec}s</span>`);

  phase = 'countdown';
  const startAt = battleStartAt || Date.now() + 3500;
  while (Date.now() < startAt - 1200) await sleep(100);
  $('doorLight').classList.add('on');
  doorChime();
  await sleep(1200);
  $('doors').classList.add('open');
  setMsg('<b class="go">GO!</b>');
  await sleep(700);
  show('onboard', false);
  center(null);
  setRacing(true);
  waveHist.length = 0;
  show('waveBox', true);
  show('hud', true);
  show('dirBox', true);
  show('saboBar', mode === 'battle');
  race.t0 = performance.now();
  phase = 'race';
  sfx.horn();
}

function newRace(tier, battle) {
  const vmax = tier.length / (0.8 * tier.targetSec); // tuned via sim: decent player ~51/85/139s
  return {
    tier, battle, vmax, dist: 0, v: 0, t0: 0, elapsed: 0,
    comboT: 0, lowT: 0, mult: 1,
    obstacles: [], nextObAt: rand(...tier.obstacleEvery), active: null, cleared: 0,
    boostUntil: 0, frozenUntil: 0, shrinkUntil: 0, immuneUntil: 0,
    charges: 0, sabosSent: 0, lastStation: 0,
    trace: [], ghost: loadGhost(tier.id),
    lane: 0, items: buildItems(tier), stumbleUntil: 0, detourUntil: 0, gate: null,
  };
}

// ---------- interactive street items generated from the real path ----------
function headingAt(t, d) {
  const a = pointAt(t, Math.max(0, d));
  const b = pointAt(t, Math.min(t.length, d + 10));
  return Math.atan2((b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat);
}
function buildItems(t) {
  const items = [];
  let lastJ = -999;
  for (let d = 20; d < t.length - 30; d += 5) {
    let turn = headingAt(t, d) - headingAt(t, d - 10);
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    if (Math.abs(turn) > 0.7 && d - lastJ > 45) {
      items.push({ kind: 'junction', dist: d, dir: Math.sign(turn), lane: 0 });
      lastJ = d;
    }
  }
  const peds = ['#c0563b', '#5d7fa3', '#7a8f6a', '#a66bff', '#2b3440', '#d48a2b'];
  for (let d = 35; d < t.length - 40; d += 28 + Math.random() * 22) {
    if (items.some((j) => j.kind === 'junction' && Math.abs(j.dist - d) < 14)) continue;
    const r = Math.random();
    const lane = [-1, 0, 1][Math.floor(Math.random() * 3)];
    if (r < 0.55) items.push({ kind: 'ped', dist: d, lane, color: peds[Math.floor(Math.random() * peds.length)], phone: Math.random() < 0.5 });
    else if (r < 0.8) items.push({ kind: 'kopi', dist: d, lane: lane || (Math.random() < 0.5 ? -1 : 1) });
    else items.push({ kind: 'barrier', dist: d, lane: 0 });
  }
  items.push({ kind: 'gantry', dist: t.length - 12, lane: 0 });
  return items.sort((a, b) => a.dist - b.dist);
}
function prompt(html, color) {
  if (!html) return show('prompt', false);
  $('prompt').innerHTML = html;
  $('prompt').style.setProperty('--pc', color || '#2ee6a6');
  show('prompt', true);
}
function updateItems(r, t, m, now, dt) {
  const z = engine ? engine.zones : { top: 0, tap: 0 };
  // lane follows which side you wave on
  const targetLane = m > 12 ? Math.max(-1, Math.min(1, (engine?.lateral || 0) * 1.6)) : r.lane * 0.98;
  r.lane += (targetLane - r.lane) * Math.min(1, dt * 3);
  let factor = 1;
  let shown = false;
  for (const it of r.items) {
    if (it.done) continue;
    const ahead = it.dist - r.dist;
    if (ahead > 30) break;
    if (it.kind === 'junction') {
      if (ahead < 28 && ahead > 0) {
        if (Math.sign(r.lane) === it.dir && Math.abs(r.lane) > 0.35) it.ok = (it.ok || 0) + dt;
        if (!shown) prompt(`${it.dir < 0 ? '⬅' : '➡'} Turn ${it.dir < 0 ? 'LEFT' : 'RIGHT'} · wave on your ${it.dir < 0 ? 'left' : 'right'}`, (it.ok || 0) > 0.4 ? '#2ee6a6' : '#ffd23f');
        shown = true;
      }
      if (ahead <= 0) {
        it.done = true;
        if ((it.ok || 0) > 0.4) { toast('Nice turn!', '#2ee6a6'); sfx.combo(); }
        else { r.detourUntil = now + 2600; toast('Wrong way! Doubling back…', '#ff3b6b'); sfx.alarm(); }
      }
    } else if (it.kind === 'barrier') {
      if (ahead < 14 && ahead > 0) {
        if (z.top > 30) it.jumped = true;
        if (!shown) prompt(it.jumped ? '✔ Ready to jump' : '🙌 Barrier! Hands up to jump', it.jumped ? '#2ee6a6' : '#ffd23f');
        shown = true;
      }
      if (ahead <= 0) {
        it.done = true;
        if (it.jumped) { toast('Hop! Cleared the barrier', '#2ee6a6'); sfx.clear(); }
        else { r.stumbleUntil = now + 1400; toast('Tripped on the barrier!', '#ff3b6b'); sfx.alarm(); }
      }
    } else if (it.kind === 'ped' && ahead <= 0) {
      it.done = true;
      if (Math.abs(r.lane - it.lane) < 0.55) { r.stumbleUntil = now + 1200; toast('Bumped into someone on their phone!', '#ff3b6b'); sfx.alarm(); }
      else sfx.combo();
    } else if (it.kind === 'kopi' && ahead <= 0) {
      it.done = true;
      if (Math.abs(r.lane - it.lane) < 0.6) { r.boostUntil = now + 2500; toast('☕ Kopi boost!', '#ffd23f'); sfx.clear(); }
    } else if (it.kind === 'gantry' && ahead <= 0) {
      if (!r.gate) { r.gate = { t: 0, tap: 0 }; sfx.alarm(); }
      r.gate.t += dt;
      if (z.tap > 30) r.gate.tap += dt;
      prompt('💳 Tap your EZ-Link · wave inside the yellow box', '#ffd23f');
      shown = true;
      factor = 0;
      if (r.gate.tap > 0.5 || r.gate.t > 5) {
        it.done = true;
        toast(r.gate.tap > 0.5 ? 'Beep! Gantry open' : 'Gantry finally opened…', '#2ee6a6');
        sfx.dingdong();
      }
    }
  }
  if (!shown) prompt(null);
  if (now < r.stumbleUntil) factor *= 0.3;
  if (now < r.detourUntil) factor *= 0.35;
  return factor;
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
  const m = engine && Number.isFinite(engine.motion) ? Math.max(0, Math.min(100, engine.motion)) : 0;
  $('meterFill').style.width = `${m}%`;
  waveHist.push([m, Math.min(100, (r.v / r.vmax) * 100)]);
  if (waveHist.length > 240) waveHist.shift();

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
  // spawn 12-20% of the route ahead (60-220 m) and never in the last 40 m before the platform
  const ahead = Math.max(60, Math.min(220, t.length * rand(0.12, 0.2)));
  if (!r.active && r.elapsed > r.nextObAt && r.dist + ahead < t.length - 40) {
    const keys = Object.keys(OBSTACLES);
    const type = keys[Math.floor(Math.random() * keys.length)];
    r.obstacles.push({ type, dist: r.dist + ahead, color: OBSTACLES[type].color });
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

  speedFactor *= updateItems(r, t, m, now, dt);
  const frozen = now < r.frozenUntil;
  const boost = now < r.boostUntil ? 1.45 : 1;
  const target = frozen ? 0 : r.vmax * (m / 100) * r.mult * boost * speedFactor;
  r.v += (target - r.v) * Math.min(1, dt * 2.2);
  r.dist = Math.min(t.length, r.dist + r.v * dt);

  // ghost trace every 0.5 s
  const slot = Math.floor(r.elapsed * 2);
  while (r.trace.length <= slot) r.trace.push(Math.round(r.dist));

  // stations
  const ni = nextStationIndex(t, r.dist);
  const passed = ni === -1 ? t.stations.length - 1 : ni - 1;
  if (passed > r.lastStation) {
    r.lastStation = passed;
    if (passed < t.stations.length - 1 && t.stations[passed][0]) {
      toast(`Now at <b>${t.stations[passed][0]}</b>`, t.color);
      sfx.dingdong();
    }
  }

  // HUD
  // direction arrow (north-up): from where you are to a point 40 m ahead on the path
  {
    const head = (a, b) => {
      const p0 = pointAt(t, a);
      const p1 = pointAt(t, b);
      return Math.atan2(-(p1.lat - p0.lat), (p1.lng - p0.lng) * Math.cos(p0.lat * Math.PI / 180));
    };
    const now0 = head(Math.max(0, r.dist - 8), r.dist + 8);
    const next = head(r.dist + 18, Math.min(t.length, r.dist + 40));
    let turn = next - now0;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    const deg = (turn * 180) / Math.PI;
    const clamp = Math.max(-90, Math.min(90, deg));
    $('dirArrow').style.transform = `rotate(${Math.abs(deg) < 25 ? 0 : clamp}deg)`;
    $('dirHint').textContent = Math.abs(deg) < 25 ? 'Straight on to' : deg > 0 ? 'Turn right for' : 'Turn left for';
    $('dirTo').textContent = t.to.name;
    $('dirLeft').textContent = `${Math.max(0, Math.round(t.length - r.dist))} m`;
  }
  const left = t.limitSec - r.elapsed;
  $('timer').textContent = fmt(Math.max(0, left) * 1000);
  $('timer').classList.toggle('warn', left < 20 && left >= 10);
  $('timer').classList.toggle('danger', left < 10);
  if (left <= 0 && r.dist < t.length - 0.5) return missed();
  $('progressFill').style.width = `${(r.dist / t.length) * 100}%`;
  $('nextStation').textContent = `${Math.max(0, Math.round(t.length - r.dist))} m to ${t.to.name}`;
  $('speed').textContent = Math.round(Math.min(35, (r.v / r.vmax) * 22));
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
  if (engine) engine.shrink = null; // don't leak a sabotage shrink into the next calibration
  const ms = Math.round(r.elapsed * 1000);
  show('hud', false);
  show('saboBar', false);
  show('dirBox', false);
  show('waveBox', false);
  prompt(null);
  setRacing(false);
  show('obstacle', false);
  lobby?.send('finish', { id: myId, name: myName, color: myColor, tier: tierId, time_ms: ms });
  sfx.horn();
  confetti({ particleCount: 160, spread: 80, origin: { y: 0.6 }, colors: [myColor, r.tier.color, '#ffffff'] });

  const prevGhost = r.ghost;
  const pb = !prevGhost || ms < prevGhost.ms;
  if (pb) localStorage.setItem(`mrtrun_ghost_${tierId}`, JSON.stringify({ ms, trace: r.trace }));

  const spare = r.tier.limitSec - r.elapsed;
  document.querySelector('.finish-card').classList.remove('missed');
  document.querySelector('.fin-label').textContent = 'CAUGHT IT!';
  $('finStation').textContent = `${r.tier.to.codes.join('/')} ${r.tier.to.name}`;
  $('finStation').style.color = r.tier.color;
  $('finTime').textContent = fmt(ms);
  $('finMeta').innerHTML = `Doors closed ${spare.toFixed(1)}s after you boarded · ${r.cleared} obstacles cleared${pb ? ' · <b class="pb">NEW PERSONAL BEST</b>' : ''}`;
  $('finBoard').innerHTML = '';
  show('finish', true); // show immediately; leaderboard fills in when the network answers
  await saveRun({
    player_id: myId, player_name: myName, color: myColor, tier: tierId,
    time_ms: ms, obstacles_cleared: r.cleared, sabos_sent: r.sabosSent, mode: r.battle ? 'battle' : 'solo',
  }).catch((e) => console.warn('saveRun failed', e));
  if (race !== r || phase !== 'finish') return;

  const lb = await leaderboard(tierId, { limit: 5 }).catch(() => []);
  if (race !== r || phase !== 'finish') return; // a new run (e.g. battle) started while we waited
  $('finBoard').innerHTML = lb
    .map((row, i) => `<div class="row ${row.player_name === myName ? 'me' : ''}"><span>${i + 1}</span><i style="background:${row.color}"></i><span class="n">${esc(row.player_name)}</span><span class="t">${fmt(row.time_ms)}</span></div>`)
    .join('');
  show('finish', true);
}

async function missed() {
  phase = 'finish';
  const r = race;
  if (engine) engine.shrink = null;
  show('hud', false);
  show('saboBar', false);
  show('dirBox', false);
  show('waveBox', false);
  prompt(null);
  setRacing(false);
  show('obstacle', false);
  lobby?.send('finish', { id: myId, name: myName, color: myColor, tier: tierId, time_ms: null, missed: true });
  sfx.alarm();
  const left = Math.max(0, Math.round(r.tier.length - r.dist));
  document.querySelector('.finish-card').classList.add('missed');
  document.querySelector('.fin-label').textContent = 'MISSED IT';
  $('finStation').textContent = `Doors closed at ${r.tier.to.name}`;
  $('finStation').style.color = '#ff3b6b';
  $('finTime').textContent = `${left} m short`;
  $('finMeta').innerHTML = `Next train in 4 min… ${r.cleared} obstacles cleared. Thrash harder and hold your combo!`;
  $('finBoard').innerHTML = '';
  show('finish', true);
  const lb = await leaderboard(tierId, { limit: 5 }).catch(() => []);
  if (race !== r || phase !== 'finish') return;
  $('finBoard').innerHTML = lb
    .map((row, i) => `<div class="row"><span>${i + 1}</span><i style="background:${row.color}"></i><span class="n">${esc(row.player_name)}</span><span class="t">${fmt(row.time_ms)}</span></div>`)
    .join('');
  show('finish', true);
}

// ---------- render ----------
function render(now) {
  const tier = race ? race.tier : TIERS[tierId];
  for (const [id, o] of others) if (now - o.at > 4000) others.delete(id);
  const ghost = race?.ghost;
  const ghostDist = ghost && phase === 'race' ? ghost.trace[Math.min(ghost.trace.length - 1, Math.floor(race.elapsed * 2))] : null;
  const racing = document.body.classList.contains('racing') && race;
  if (racing) {
    const useFP = fpAvailable();
    if (document.body.classList.contains('fp') !== useFP) { document.body.classList.toggle('fp', useFP); resizeFP(); }
    if (useFP) {
      updateFP(tier, race.dist, race.lane, Math.sin(now / 110) * Math.min(1.2, race.v / race.vmax) * 0.8);
      drawSprites(tier, race.dist, race.items, race.lane);
    } else drawStreet(sctx, innerWidth, innerHeight, tier, race.dist, { speed: race.v / race.vmax });
    drawWave();
  }
  drawMap(ctx, canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight, tier, racing ? {
    dist: race.dist,
    follow: false,
    minimap: false,
    obstacles: race.obstacles,
    others: [...others.values()].filter((o) => o.tier === tier.id).map((o) => ({ dist: o.dist, color: o.color, name: o.name })),
    myColor,
    padTop: 30, padBottom: 30, padLeft: 30, padRight: 110,
  } : {
    dist: race ? race.dist : phase === 'join' ? null : 0,
    follow: Boolean(race) && phase !== 'join',
    obstacles: race?.obstacles,
    others: [...others.values()].filter((o) => o.tier === tier.id).map((o) => ({ dist: o.dist, color: o.color, name: o.name })),
    ghostDist,
    myColor,
    frozen: race && now < race.frozenUntil,
    viewMetres: tier.viewMetres || 2400,
  });
}

function drawWave() {
  const W = 560, H = 200;
  wave.clearRect(0, 0, W, H);
  wave.strokeStyle = 'rgba(255,255,255,0.08)';
  wave.lineWidth = 1;
  for (let y = 0; y <= 4; y++) {
    wave.beginPath();
    wave.moveTo(0, (H / 4) * y);
    wave.lineTo(W, (H / 4) * y);
    wave.stroke();
  }
  const n = waveHist.length;
  const line = (k, color, fill) => {
    wave.beginPath();
    waveHist.forEach((v, i) => {
      const x = W - (n - 1 - i) * (W / 239);
      const y = H - (v[k] / 100) * (H - 8) - 4;
      i ? wave.lineTo(x, y) : wave.moveTo(x, y);
    });
    wave.strokeStyle = color;
    wave.lineWidth = 4;
    wave.lineJoin = 'round';
    wave.stroke();
    if (fill) {
      wave.lineTo(W, H);
      wave.lineTo(W - (n - 1) * (W / 239), H);
      wave.closePath();
      wave.fillStyle = fill;
      wave.fill();
    }
  };
  if (n > 1) {
    line(0, '#2ee6a6', 'rgba(46,230,166,0.15)');
    line(1, '#ffd23f');
  }
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
