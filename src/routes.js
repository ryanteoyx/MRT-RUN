// MRT RUN challenges: real CBD transfers between two MRT stations.
// Walking paths are real pedestrian routes from OpenStreetMap (FOSSGIS OSRM foot profile).
// limitSec = the next train's doors close this many seconds after you tap in.

const LINES = {
  NS: { code: 'NS', name: 'North-South', color: '#D42E12' },
  EW: { code: 'EW', name: 'East-West', color: '#009645' },
  NE: { code: 'NE', name: 'North East', color: '#9900AA' },
  CC: { code: 'CC', name: 'Circle', color: '#FA9E0D' },
  DT: { code: 'DT', name: 'Downtown', color: '#005EC4' },
  TE: { code: 'TE', name: 'Thomson-East Coast', color: '#9D5B25' },
};

const P = (s) => s.map(([lat, lng]) => ['', lat, lng]);

const RAW = {
  easy: {
    label: 'Easy',
    name: 'Telok Ayer Dash',
    from: { name: 'Telok Ayer', codes: ['DT18'], lines: [LINES.DT] },
    to: { name: 'Raffles Place', codes: ['NS26', 'EW14'], lines: [LINES.NS, LINES.EW] },
    blurb: 'Lunch-hour sprint up Cross Street to catch the East-West Line.',
    limitSec: 50,
    walkSec: 459,
    obstacleEvery: [8, 12],
    path: [[1.28209,103.84859],[1.2822,103.84857],[1.28226,103.84861],[1.28197,103.8491],[1.28174,103.84949],[1.28227,103.84984],[1.28257,103.85006],[1.2827,103.85025],[1.28258,103.85031],[1.28262,103.85044],[1.28258,103.85084],[1.28253,103.85098],[1.28252,103.85113],[1.28248,103.85125],[1.28264,103.85139],[1.28289,103.85141],[1.28381,103.85148],[1.284,103.85149]],
  },
  medium: {
    label: 'Medium',
    name: 'Riverside Run',
    from: { name: 'Clarke Quay', codes: ['NE5'], lines: [LINES.NE] },
    to: { name: 'Fort Canning', codes: ['DT20'], lines: [LINES.DT] },
    blurb: 'Out of the North East Line, along the river, up to Fort Canning.',
    limitSec: 60,
    walkSec: 569,
    obstacleEvery: [7, 10],
    path: [[1.28883,103.84682],[1.28892,103.84684],[1.28895,103.84694],[1.28893,103.84699],[1.28919,103.8472],[1.28914,103.84726],[1.2893,103.8474],[1.28947,103.8475],[1.28956,103.84751],[1.28963,103.84763],[1.29002,103.8479],[1.29005,103.84792],[1.29008,103.84781],[1.29017,103.84775],[1.29034,103.84735],[1.29046,103.84715],[1.29056,103.84694],[1.29103,103.8463],[1.29118,103.84605],[1.29121,103.84595],[1.29131,103.84578],[1.2914,103.84571],[1.29153,103.84551],[1.29191,103.84502],[1.2921,103.84477],[1.29222,103.84462],[1.29226,103.84448],[1.2919,103.84425]],
  },
  hard: {
    label: 'Hard',
    name: 'Shenton Way Scramble',
    from: { name: 'Tanjong Pagar', codes: ['EW15'], lines: [LINES.EW] },
    to: { name: 'Downtown', codes: ['DT17'], lines: [LINES.DT] },
    blurb: 'Cross the CBD from Tanjong Pagar to Downtown before the Downtown Line leaves.',
    limitSec: 95,
    walkSec: 1012,
    obstacleEvery: [6, 9],
    path: [[1.27625,103.84552],[1.27626,103.84564],[1.2763,103.84599],[1.27636,103.84637],[1.27644,103.84645],[1.27655,103.84655],[1.27664,103.84667],[1.27673,103.84668],[1.27689,103.84685],[1.27694,103.84688],[1.27682,103.847],[1.27667,103.84716],[1.27676,103.84731],[1.27679,103.84736],[1.27671,103.84743],[1.2764,103.84788],[1.27625,103.84808],[1.27629,103.84818],[1.2784,103.84952],[1.27876,103.84973],[1.27865,103.84992],[1.27907,103.85017],[1.27984,103.85064],[1.27961,103.85104],[1.27923,103.85166],[1.27904,103.85188],[1.27916,103.85198],[1.27905,103.85215],[1.27954,103.85246],[1.27972,103.85258],[1.27984,103.8527],[1.2797,103.85293],[1.27938,103.85273],[1.2794,103.8527]],
  },
};

export const TIERS = {};
for (const [id, r] of Object.entries(RAW)) {
  const stations = P(r.path);
  stations[0][0] = r.from.name;
  stations[0][3] = `${r.from.codes.join('/')} ${r.from.name}`;
  stations.at(-1)[0] = r.to.name;
  stations.at(-1)[3] = `${r.to.codes.join('/')} ${r.to.name}`;
  TIERS[id] = {
    id,
    ...r,
    walk: true,
    stations,
    code: r.to.codes[0].replace(/\d+/, ''),
    color: r.to.lines[0].color,
    fromColor: r.from.lines[0].color,
    line: `${r.from.codes.join('/')} → ${r.to.codes.join('/')}`,
    targetSec: r.limitSec * 0.78, // decent runner arrives with ~10% to spare
    viewMetres: 420,
  };
}

const R = 6371000;
function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[2] - a[2]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

for (const t of Object.values(TIERS)) {
  let d = 0;
  t.cum = [0];
  for (let i = 1; i < t.stations.length; i++) {
    d += haversine(t.stations[i - 1], t.stations[i]);
    t.cum.push(d);
  }
  t.length = d;
}

export function pointAt(tier, dist) {
  const { stations, cum } = tier;
  const d = Math.max(0, Math.min(dist, tier.length));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const f = (d - cum[i - 1]) / seg;
  const a = stations[i - 1];
  const b = stations[i];
  return { lat: a[1] + (b[1] - a[1]) * f, lng: a[2] + (b[2] - a[2]) * f, seg: i };
}

export function nextStationIndex(tier, dist) {
  return tier.cum.findIndex((c) => c > dist + 1);
}
