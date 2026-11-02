// First-person 3D street view built from real OpenStreetMap data (MapLibre GL + OpenFreeMap tiles).
// The camera sits at head height on the real walking path and looks along it; game sprites
// (pedestrians, kopi, barriers, gantry) are drawn on a canvas above, projected from real coordinates.
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { pointAt } from './routes.js';

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const PASTEL = ['#f4c7a1', '#bfe3d0', '#f7e3a1', '#b9d7f0', '#f2b5b5', '#d9c8f0'];

let map = null;
let ready = false;
let failed = false;
let overlay, octx;

export function initFP(container, overlayCanvas) {
  if (map) return;
  overlay = overlayCanvas;
  octx = overlay.getContext('2d');
  try {
    map = new maplibregl.Map({
      container,
      style: STYLE,
      center: [103.8515, 1.284],
      zoom: 18.6,
      pitch: 78,
      maxPitch: 85,
      interactive: false,
      attributionControl: { compact: true },
      fadeDuration: 0,
    });
  } catch (e) {
    failed = true;
    return;
  }
  map.on('error', () => {});
  map.on('load', () => {
    ready = true;
    try {
      const style = map.getStyle();
      for (const layer of style.layers) {
        // keep streets and buildings readable; drop POI clutter
        if (layer.type === 'symbol' && !/road|street|water/i.test(layer.id)) map.setLayoutProperty(layer.id, 'visibility', 'none');
        if (layer.type === 'fill-extrusion') {
          // realistic CBD palette by height: shophouses, HDB/office blocks, glass towers
          const hgt = ['coalesce', ['to-number', ['get', 'render_height']], ['to-number', ['get', 'height']], 10];
          map.setPaintProperty(layer.id, 'fill-extrusion-color', [
            'case',
            ['<', hgt, 16], ['match', ['%', ['round', ['*', hgt, 7]], 5], 0, '#e8c9a6', 1, '#d9a98a', 2, '#efe0bf', 3, '#c9b59a', '#e2cfb4'],
            ['<', hgt, 60], ['match', ['%', ['round', hgt], 4], 0, '#e7e2d6', 1, '#d8d4cb', 2, '#cfd6dc', '#ece6da'],
            ['match', ['%', ['round', hgt], 3], 0, '#8fa7bd', 1, '#a9bccd', '#7f97ad'],
          ]);
          map.setPaintProperty(layer.id, 'fill-extrusion-opacity', 1);
          try { map.setPaintProperty(layer.id, 'fill-extrusion-vertical-gradient', true); } catch {}
        }
        if (layer.type === 'fill' && /park|grass|wood|landcover|landuse/i.test(layer.id)) {
          try { map.setPaintProperty(layer.id, 'fill-color', '#a9cf8f'); } catch {}
        }
        if (layer.type === 'fill' && /water/i.test(layer.id)) {
          try { map.setPaintProperty(layer.id, 'fill-color', '#7fb8cf'); } catch {}
        }
        if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', '#d6d2c8');
      }
      if (map.setSky) map.setSky({ 'sky-color': '#8ec5e8', 'horizon-color': '#f6d7b8', 'fog-color': '#f3e3cf', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.3 });
      if (map.setLight) map.setLight({ anchor: 'map', color: '#fff1d6', intensity: 0.5, position: [1.5, 230, 35] });
      // the walking route as a glowing line on the pavement
    } catch {}
  });
}

export function setRoute(tier) {
  if (!map) return;
  const add = () => {
    const coords = tier.stations.map((s) => [s[2], s[1]]);
    const data = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } };
    if (map.getSource('route')) map.getSource('route').setData(data);
    else {
      map.addSource('route', { type: 'geojson', data });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#0b0f14', 'line-width': 16, 'line-opacity': 0.35 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#2ee6a6', 'line-width': 9, 'line-dasharray': [1.2, 1.2] }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    }
  };
  if (ready) add();
  else map.once('load', add);
}

export function fpAvailable() {
  return Boolean(map) && ready && !failed;
}

export function resizeFP() {
  map?.resize();
  if (overlay) {
    const dpr = window.devicePixelRatio || 1;
    overlay.width = innerWidth * dpr;
    overlay.height = innerHeight * dpr;
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function bearingAt(tier, dist) {
  const a = pointAt(tier, Math.max(0, dist - 6));
  const b = pointAt(tier, Math.min(tier.length, dist + 14));
  const y = (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180);
  const x = b.lat - a.lat;
  return (Math.atan2(y, x) * 180) / Math.PI;
}

// metres offset to the side of the path (+ = right of travel)
function offsetPoint(tier, dist, side) {
  const p = pointAt(tier, dist);
  const br = (bearingAt(tier, dist) * Math.PI) / 180;
  const east = Math.cos(br) * side; // right-hand perpendicular
  const north = -Math.sin(br) * side;
  return [p.lng + east / (111320 * Math.cos((p.lat * Math.PI) / 180)), p.lat + north / 110574];
}

let camBearing = null;
export function updateFP(tier, dist, lane, bob) {
  if (!map) return;
  const target = bearingAt(tier, dist + 4);
  if (camBearing == null) camBearing = target;
  let d = target - camBearing;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  camBearing += d * 0.12; // smooth turning
  const c = offsetPoint(tier, dist + 9, lane * 1.6);
  map.jumpTo({ center: c, bearing: camBearing, pitch: 80 + bob, zoom: 19.6 });
}

// Draw game sprites over the 3D view. items: [{dist, lane(-1..1), kind}]
export function drawSprites(tier, dist, items, laneNow) {
  if (!octx) return;
  const w = innerWidth;
  const h = innerHeight;
  octx.clearRect(0, 0, w, h);
  if (!map || !ready) return;
  const vis = items.filter((it) => !it.done && it.dist > dist + 1 && it.dist < dist + 60).sort((a, b) => b.dist - a.dist);
  for (const it of vis) {
    const ll = offsetPoint(tier, it.dist, (it.lane || 0) * 1.6);
    const p = map.project(ll);
    const dd = it.dist - dist;
    const s = Math.max(0.15, Math.min(3, 14 / dd));
    if (p.y < h * 0.25 || p.y > h * 1.1) continue;
    octx.save();
    octx.translate(p.x, p.y);
    octx.scale(s, s);
    drawKind(octx, it);
    octx.restore();
  }
  // your feet / shadow + lane indicator
  octx.fillStyle = 'rgba(0,0,0,0.18)';
  octx.beginPath();
  octx.ellipse(w / 2 + laneNow * w * 0.12, h * 0.94, 70, 16, 0, 0, Math.PI * 2);
  octx.fill();
}

function drawKind(c, it) {
  switch (it.kind) {
    case 'ped': {
      const col = it.color || '#5b6b7a';
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.beginPath(); c.ellipse(0, 0, 16, 5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = col; c.fillRect(-9, -48, 18, 30);
      c.fillStyle = '#2b3440'; c.fillRect(-8, -18, 6, 18); c.fillRect(2, -18, 6, 18);
      c.fillStyle = '#f1c9a5'; c.beginPath(); c.arc(0, -56, 8, 0, Math.PI * 2); c.fill();
      if (it.phone) { c.fillStyle = '#111'; c.fillRect(6, -46, 5, 9); }
      break;
    }
    case 'kopi': {
      c.fillStyle = 'rgba(0,0,0,0.18)'; c.beginPath(); c.ellipse(0, 0, 12, 4, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.moveTo(-10, -28); c.lineTo(10, -28); c.lineTo(7, -4); c.lineTo(-7, -4); c.closePath(); c.fill();
      c.fillStyle = '#8b5a2b'; c.fillRect(-9, -26, 18, 6);
      c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.arc(12, -16, 5, -1.2, 1.2); c.stroke();
      c.fillStyle = '#ffd23f'; c.font = '800 12px Inter'; c.textAlign = 'center'; c.fillText('BOOST', 0, -36);
      break;
    }
    case 'barrier': {
      c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(-60, -2, 120, 4);
      c.fillStyle = '#ffd400'; c.fillRect(-60, -30, 120, 14);
      c.fillStyle = '#111'; for (let x = -56; x < 60; x += 24) c.fillRect(x, -30, 12, 14);
      c.fillStyle = '#9aa3ad'; c.fillRect(-58, -16, 6, 16); c.fillRect(52, -16, 6, 16);
      c.fillStyle = '#fff'; c.font = '800 13px Inter'; c.textAlign = 'center'; c.fillText('HANDS UP TO JUMP', 0, -38);
      break;
    }
    case 'gantry': {
      c.fillStyle = '#c9d1d9'; for (const x of [-80, -27, 27, 80]) c.fillRect(x - 8, -60, 16, 60);
      c.fillStyle = '#2ee6a6'; for (const x of [-80, -27, 27, 80]) c.fillRect(x - 6, -56, 12, 6);
      c.fillStyle = '#d42e12'; c.fillRect(-55, -38, 110, 6);
      c.fillStyle = '#fff'; c.font = '800 14px Inter'; c.textAlign = 'center'; c.fillText('TAP EZ-LINK', 0, -70);
      break;
    }
    case 'junction': {
      c.fillStyle = 'rgba(46,230,166,0.9)';
      c.font = '900 64px Inter'; c.textAlign = 'center';
      c.fillText(it.dir < 0 ? '⬅' : '➡', 0, -20);
      break;
    }
    default:
  }
}
