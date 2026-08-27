import { SOURCE_COUNTRY_ROWS, SOURCE_COUNTRY_W, SOURCE_COUNTRY_H } from './world.js';
import { COUNTRY_IDS } from './countries.js';
import { WORLD_COUNTRY_INFO } from './worldCountries.js';

// Where each country sits, and how far apart any two of them are. Derived from
// the source art rather than authored, so moving a coastline moves the freight
// bill with it and the two can never disagree.
//
// This is DATA, not a system: it is a pure function of world.js and is computed
// once at load. Nothing here reads or writes `state`.

function centroids() {
  const sum = {};
  for (const id of COUNTRY_IDS) sum[id] = { x: 0, y: 0, n: 0 };

  for (let y = 0; y < SOURCE_COUNTRY_H; y++) {
    const row = SOURCE_COUNTRY_ROWS[y];
    for (let x = 0; x < SOURCE_COUNTRY_W; x++) {
      const id = row[x];
      if (!id) continue;
      const acc = sum[id];
      acc.x += x;
      acc.y += y;
      acc.n++;
    }
  }

  const out = {};
  const fallback = Object.fromEntries(WORLD_COUNTRY_INFO.map((info) => [
    info.id,
    {
      x: (info.centre.lon + 180) * SOURCE_COUNTRY_W / 360,
      y: (90 - info.centre.lat) * SOURCE_COUNTRY_H / 180,
    },
  ]));
  for (const id of COUNTRY_IDS) {
    const acc = sum[id];
    out[id] = acc.n ? { x: acc.x / acc.n, y: acc.y / acc.n }
      : fallback[id] ?? { x: SOURCE_COUNTRY_W / 2, y: SOURCE_COUNTRY_H / 2 };
  }
  return out;
}

export const CENTROIDS = centroids();

// Longitude wraps. Tokyo and Los Angeles face each other across the Pacific,
// and a route that ignored the wrap would send that cargo the long way round
// the planet and charge for it.
function separation(a, b) {
  const A = CENTROIDS[a];
  const B = CENTROIDS[b];
  let dx = Math.abs(A.x - B.x);
  if (dx > SOURCE_COUNTRY_W / 2) dx = SOURCE_COUNTRY_W - dx;
  const dy = A.y - B.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// A full matrix, built once. Trade considers every partner every tick, so this
// is looked up thousands of times per second and must not be recomputed.
export const DISTANCE = (() => {
  const out = {};
  for (const a of COUNTRY_IDS) {
    out[a] = {};
    for (const b of COUNTRY_IDS) out[a][b] = a === b ? 0 : separation(a, b);
  }
  return out;
})();

// The longest haul on the board, so freight can be expressed as a fraction of
// "the other side of the world" instead of a raw cell count that would change
// meaning the moment the grid is resized.
export const MAX_DISTANCE = (() => {
  let max = 0;
  for (const a of COUNTRY_IDS) {
    for (const b of COUNTRY_IDS) max = Math.max(max, DISTANCE[a][b]);
  }
  return max;
})();

export function distanceBetween(a, b) {
  return DISTANCE[a]?.[b] ?? MAX_DISTANCE;
}

// 0 for a neighbour, 1 for the far side of the planet.
export function haulShare(a, b) {
  return MAX_DISTANCE ? distanceBetween(a, b) / MAX_DISTANCE : 0;
}

// Countries sorted by how close they are to `id` — the natural order for a
// first trade pact, and the order the trade system tries partners in.
export function neighboursOf(id) {
  return COUNTRY_IDS
    .filter((other) => other !== id)
    .sort((a, b) => distanceBetween(id, a) - distanceBetween(id, b));
}
