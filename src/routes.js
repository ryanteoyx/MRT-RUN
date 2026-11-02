// Real MRT station coordinates (approximate WGS84). Routes run in travel order.
// Target seconds = how long a solid (not flat-out) effort should take.

const NSL = '#D42E12';
const EWL = '#009645';

export const TIERS = {
  easy: {
    id: 'easy',
    label: 'Easy',
    name: 'Downtown Dash',
    line: 'North-South Line',
    code: 'NS',
    color: NSL,
    targetSec: 45,
    obstacleEvery: [9, 13],
    stations: [
      ['Marina South Pier', 1.2712, 103.8632],
      ['Marina Bay', 1.2764, 103.8546],
      ['Raffles Place', 1.2840, 103.8515],
      ['City Hall', 1.2931, 103.8520],
      ['Dhoby Ghaut', 1.2990, 103.8455],
      ['Somerset', 1.3006, 103.8390],
      ['Orchard', 1.3043, 103.8322],
    ],
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    name: 'East Side Express',
    line: 'East-West Line',
    code: 'EW',
    color: EWL,
    targetSec: 75,
    obstacleEvery: [7, 11],
    stations: [
      ['Tanah Merah', 1.3272, 103.9465],
      ['Bedok', 1.3240, 103.9300],
      ['Kembangan', 1.3210, 103.9130],
      ['Eunos', 1.3198, 103.9030],
      ['Paya Lebar', 1.3177, 103.8926],
      ['Aljunied', 1.3164, 103.8829],
      ['Kallang', 1.3114, 103.8714],
      ['Lavender', 1.3073, 103.8630],
      ['Bugis', 1.3008, 103.8559],
      ['City Hall', 1.2931, 103.8520],
      ['Raffles Place', 1.2840, 103.8515],
    ],
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    name: 'North-South Marathon',
    line: 'North-South Line',
    code: 'NS',
    color: NSL,
    targetSec: 120,
    obstacleEvery: [5, 9],
    stations: [
      ['Yishun', 1.4295, 103.8350],
      ['Khatib', 1.4173, 103.8329],
      ['Yio Chu Kang', 1.3817, 103.8449],
      ['Ang Mo Kio', 1.3700, 103.8495],
      ['Bishan', 1.3510, 103.8485],
      ['Braddell', 1.3405, 103.8468],
      ['Toa Payoh', 1.3327, 103.8474],
      ['Novena', 1.3204, 103.8438],
      ['Newton', 1.3127, 103.8380],
      ['Orchard', 1.3043, 103.8322],
      ['Somerset', 1.3006, 103.8390],
      ['Dhoby Ghaut', 1.2990, 103.8455],
      ['City Hall', 1.2931, 103.8520],
      ['Raffles Place', 1.2840, 103.8515],
      ['Marina Bay', 1.2764, 103.8546],
      ['Marina South Pier', 1.2712, 103.8632],
    ],
  },
};

const R = 6371000;
function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[2] - a[2]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Precompute cumulative distance (metres) per station.
for (const t of Object.values(TIERS)) {
  let d = 0;
  t.cum = [0];
  for (let i = 1; i < t.stations.length; i++) {
    d += haversine(t.stations[i - 1], t.stations[i]);
    t.cum.push(d);
  }
  t.length = d;
}

// Position (lat,lng) and segment index at a distance along the route.
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
