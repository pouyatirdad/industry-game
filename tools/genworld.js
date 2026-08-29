// Rasterises real polygons into the game's world data.
//
//   node tools/genworld.js <path-to-ne_10m_admin_1_states_provinces.geojson>
//
// The repo carries no polygons — it carries the RASTER made from them, exactly
// as `worldCountries.js` always has. This script is how that raster is remade,
// and it is checked in so the next person does not have to reverse-engineer the
// encoding from the data file.
//
// Natural Earth's admin-1 layer is the only input, because the union of a
// country's provinces IS the country: one pass gives both who owns a cell and
// which province of theirs it is in, and the two can never disagree.
//
// Two rules are load-bearing:
//
//   * A span narrower than a cell still paints ONE cell. Scanline fill drops
//     anything thinner than the sample spacing, and at a quarter of a degree
//     that is most of Indonesia, the Caribbean, and every fjord and peninsula
//     that makes a coastline recognisable.
//   * A country the admin-1 layer does not cover keeps the OLD coarse grid,
//     under one province named after itself. Seventeen territories are in that
//     position and they would otherwise vanish from the map.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const W = 1440;
const H = 720;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = process.argv[2];

if (!SOURCE || !fs.existsSync(SOURCE)) {
  console.error('usage: node tools/genworld.js <ne_10m_admin_1_states_provinces.geojson>');
  process.exit(1);
}

// The existing data file is the authority on WHICH countries the game has —
// 258 of them, most with no hand-balancing — so it is copied through rather
// than rebuilt from the polygons, which know about a different 241.
function readExisting() {
  const text = fs.readFileSync(path.join(ROOT, 'src/data/worldCountries.js'), 'utf8');
  const body = text.replace(/^export /gm, '');
  const load = new Function(`${body}\nreturn { WORLD_COUNTRY_INFO, SOURCE_COUNTRY_ROWS };`);
  return load();
}

function latToRow(lat) {
  return (90 - lat) * H / 180 - 0.5;
}

function rowToLat(y) {
  return 90 - (y + 0.5) * 180 / H;
}

function lonToCol(lon) {
  return (lon + 180) * W / 360 - 0.5;
}

function paintPolygon(rings, grid, value) {
  let minLat = 90;
  let maxLat = -90;
  for (const ring of rings) {
    for (const point of ring) {
      if (point[1] < minLat) minLat = point[1];
      if (point[1] > maxLat) maxLat = point[1];
    }
  }
  const from = Math.max(0, Math.floor(latToRow(maxLat)));
  const to = Math.min(H - 1, Math.ceil(latToRow(minLat)));

  const crossings = [];
  for (let y = from; y <= to; y++) {
    const lat = rowToLat(y);
    crossings.length = 0;
    for (const ring of rings) {
      for (let i = 0, n = ring.length; i < n; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        if ((a[1] > lat) === (b[1] > lat)) continue;
        crossings.push(a[0] + ((lat - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      let xa = Math.ceil(lonToCol(crossings[i]));
      let xb = Math.floor(lonToCol(crossings[i + 1]));
      if (xb < xa) {
        // Thinner than a cell. Paint the one the span sits on rather than
        // nothing, or the map loses every island and every headland.
        xa = xb = Math.round(lonToCol((crossings[i] + crossings[i + 1]) / 2));
      }
      const lo = Math.max(0, xa);
      const hi = Math.min(W - 1, xb);
      for (let x = lo; x <= hi; x++) grid[y * W + x] = value;
    }
  }
}

function paintFeature(geometry, grid, value) {
  if (!geometry) return;
  if (geometry.type === 'Polygon') paintPolygon(geometry.coordinates, grid, value);
  else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) paintPolygon(poly, grid, value);
  }
}

// One run-length line per row. A quarter-degree planet is seven tenths ocean and
// a province is dozens of cells wide, so runs compress it by better than twenty
// to one — and the decoder is a split and a loop.
function encodeRows(grid) {
  const rows = [];
  for (let y = 0; y < H; y++) {
    const parts = [];
    let run = grid[y * W];
    let length = 1;
    for (let x = 1; x <= W; x++) {
      const value = x < W ? grid[y * W + x] : null;
      if (value === run) { length++; continue; }
      parts.push(`${run < 0 ? '-' : run.toString(36)}${length > 1 ? `*${length.toString(36)}` : ''}`);
      run = value;
      length = 1;
    }
    rows.push(parts.join(' '));
  }
  return rows;
}

function main() {
  const existing = readExisting();
  const known = new Set(existing.WORLD_COUNTRY_INFO.map((info) => info.id));

  console.log('reading polygons...');
  const geo = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));

  const names = [];
  const owners = [];
  const grid = new Int16Array(W * H).fill(-1);

  // Biggest first, so a small province drawn on top of a big one wins the cells
  // they share rather than the other way round.
  const features = geo.features
    .filter((f) => known.has(f.properties.iso_a2))
    .sort((a, b) => spread(b.geometry) - spread(a.geometry));

  console.log(`painting ${features.length} provinces at ${W}x${H}...`);
  for (const feature of features) {
    const p = feature.properties;
    const name = (p.name || p.name_en || p.gn_name || p.type_en || p.iso_a2 || '').trim();
    if (!name) continue;
    names.push(name);
    owners.push(p.iso_a2);
    paintFeature(feature.geometry, grid, names.length - 1);
  }

  // Whatever the polygons never heard of keeps the old coarse grid, as a single
  // province standing for the whole territory.
  const seen = new Set();
  for (let i = 0; i < grid.length; i++) if (grid[i] >= 0) seen.add(owners[grid[i]]);
  const uncovered = existing.WORLD_COUNTRY_INFO.filter((info) => !seen.has(info.id));
  console.log(`falling back to the old grid for ${uncovered.length}: ${uncovered.map((i) => i.id).join(' ')}`);
  const oldH = existing.SOURCE_COUNTRY_ROWS.length;
  const oldW = existing.SOURCE_COUNTRY_ROWS[0].length;
  for (const info of uncovered) {
    names.push(info.name);
    owners.push(info.id);
    const value = names.length - 1;
    for (let y = 0; y < H; y++) {
      const sy = Math.min(oldH - 1, Math.floor(y * oldH / H));
      for (let x = 0; x < W; x++) {
        const sx = Math.min(oldW - 1, Math.floor(x * oldW / W));
        if (existing.SOURCE_COUNTRY_ROWS[sy][sx] === info.id && grid[y * W + x] < 0) {
          grid[y * W + x] = value;
        }
      }
    }
  }

  // A province the raster never landed a cell on is a name on nothing. Drop it
  // and close the gap, so an index always has land behind it.
  const used = new Int32Array(names.length).fill(-1);
  for (let i = 0; i < grid.length; i++) if (grid[i] >= 0) used[grid[i]] = 1;
  const keepNames = [];
  const keepOwners = [];
  for (let i = 0; i < names.length; i++) {
    if (used[i] < 0) continue;
    used[i] = keepNames.length;
    keepNames.push(names[i]);
    keepOwners.push(owners[i]);
  }
  for (let i = 0; i < grid.length; i++) if (grid[i] >= 0) grid[i] = used[grid[i]];
  console.log(`${keepNames.length} provinces have land (${names.length - keepNames.length} dropped)`);

  const rows = encodeRows(grid);
  const out = `// GENERATED by tools/genworld.js from Natural Earth 10m admin-1 polygons.
// Public domain (naturalearthdata.com). Do not hand-edit: re-run the generator.
//
// One raster, ${W}x${H} cells at a quarter of a degree, holding the PROVINCE a
// cell belongs to. Who owns a cell is derived from that — the union of a
// country's provinces is the country — so ownership and subdivision can never
// disagree. Rows are run-length encoded: "<base36 index>[*<base36 run>]", and
// '-' is sea.
export const PROVINCE_W = ${W};
export const PROVINCE_H = ${H};
export const PROVINCE_NAMES = ${JSON.stringify(keepNames)};
export const PROVINCE_OWNER = ${JSON.stringify(keepOwners)};
export const PROVINCE_RLE = [
${rows.map((r) => `'${r}',`).join('\n')}
];
`;
  fs.writeFileSync(path.join(ROOT, 'src/data/worldProvinces.js'), out);
  console.log(`wrote src/data/worldProvinces.js (${(out.length / 1024).toFixed(0)} KB)`);

  const perCountry = {};
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] < 0) continue;
    const id = keepOwners[grid[i]];
    perCountry[id] = (perCountry[id] ?? 0) + 1;
  }
  const land = Object.values(perCountry).reduce((a, b) => a + b, 0);
  console.log(`${land} land cells (${(land / (W * H) * 100).toFixed(1)}% of the grid), ${Object.keys(perCountry).length} countries`);
  for (const id of ['IR', 'US', 'RU', 'DE', 'LU', 'SG']) {
    console.log(`  ${id}: ${perCountry[id] ?? 0} cells, ${keepOwners.filter((o) => o === id).length} provinces`);
  }
}

function spread(geometry) {
  if (!geometry) return 0;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates ?? [];
  let area = 0;
  for (const poly of polys) {
    const ring = poly[0] ?? [];
    let minX = 180;
    let maxX = -180;
    let minY = 90;
    let maxY = -90;
    for (const point of ring) {
      if (point[0] < minX) minX = point[0];
      if (point[0] > maxX) maxX = point[0];
      if (point[1] < minY) minY = point[1];
      if (point[1] > maxY) maxY = point[1];
    }
    area += Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
  }
  return area;
}

main();
