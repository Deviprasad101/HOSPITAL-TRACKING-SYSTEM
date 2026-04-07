/**
 * Regenerate ap_state_boundary.geojson from OpenStreetMap (Overpass).
 * Run from this folder: npm run fetch-boundary
 */
import fs from 'fs';
import https from 'https';

const query = '[out:json][timeout:120];relation["name"="Andhra Pradesh"]["admin_level"="4"];out geom;';

function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
      },
      res => {
        let d = '';
        res.on('data', c => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, text: d }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function dist(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

function chainSegments(segs) {
  if (!segs.length) return [];
  const result = [...segs[0]];
  const used = new Set([0]);
  for (let i = 1; i < segs.length * 3; i++) {
    const last = result[result.length - 1];
    let found = false;
    for (let j = 0; j < segs.length; j++) {
      if (used.has(j)) continue;
      const s = segs[j];
      if (dist(last, s[0]) < 0.03) {
        result.push(...s.slice(1));
        used.add(j);
        found = true;
        break;
      }
      if (dist(last, s[s.length - 1]) < 0.03) {
        result.push(...[...s].reverse().slice(1));
        used.add(j);
        found = true;
        break;
      }
    }
    if (!found || used.size === segs.length) break;
  }
  return result;
}

function douglasPeucker(points, epsilon) {
  if (points.length < 3) return points;
  let dmax = 0;
  let idx = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpDist(points[i], points[0], points[end]);
    if (d > dmax) {
      idx = i;
      dmax = d;
    }
  }
  if (dmax > epsilon) {
    const a = douglasPeucker(points.slice(0, idx + 1), epsilon);
    const b = douglasPeucker(points.slice(idx), epsilon);
    return a.slice(0, -1).concat(b);
  }
  return [points[0], points[end]];
}

function perpDist(p, a, b) {
  const x = p[1],
    y = p[0],
    x1 = a[1],
    y1 = a[0],
    x2 = b[1],
    y2 = b[0];
  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  const dot = A * C + B * D;
  const len = C * C + D * D;
  let t = len !== 0 ? dot / len : 0;
  t = Math.max(0, Math.min(1, t));
  const xx = x1 + t * C;
  const yy = y1 + t * D;
  return Math.hypot(x - xx, y - yy);
}

const mirrors = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

async function main() {
  const body = new URLSearchParams({ data: query }).toString();
  let text = '';
  for (const m of mirrors) {
    const { status, text: t } = await post(m, body);
    const tr = t.trim();
    if (status === 200 && tr.startsWith('{')) {
      text = t;
      console.log('OK from', m);
      break;
    }
    console.warn('Skip', m, status, tr.slice(0, 80));
  }
  if (!text) {
    console.error('No data');
    process.exit(1);
  }
  const data = JSON.parse(text);
  const rel = data.elements?.[0];
  if (!rel?.members) {
    console.error('Bad relation');
    process.exit(1);
  }
  const outerWays = rel.members.filter(x => x.type === 'way' && x.role === 'outer');
  const segments = outerWays.map(w => w.geometry.map(g => [g.lat, g.lon]));
  const ring = chainSegments(segments);
  if (ring.length < 4) {
    console.error('Ring too small', ring.length);
    process.exit(1);
  }
  const coords = ring.map(p => [p[1], p[0]]);
  const closed =
    coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1]
      ? coords
      : [...coords, coords[0]];
  const simplified = douglasPeucker(closed, 0.004);
  const feature = {
    type: 'Feature',
    properties: { name: 'Andhra Pradesh', source: 'OpenStreetMap via Overpass (ODbL)' },
    geometry: { type: 'Polygon', coordinates: [simplified] }
  };
  fs.writeFileSync('ap_state_boundary.geojson', JSON.stringify(feature));
  console.log('Wrote ap_state_boundary.geojson,', simplified.length, 'points');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
