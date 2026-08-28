import { CONFIG } from '../core/config.js';
import { BUILDINGS } from '../data/buildings.js';
import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { CENTROIDS } from '../data/geography.js';
import { placeForCountry, provinceForTile } from '../data/places.js';
import { SOURCE_W, SOURCE_H } from '../data/world.js';
import { ownerColor, ownerName, isPlayer } from '../core/state.js';
import { canBuild } from '../actions.js';

// The map is drawn to a CANVAS, not to DOM nodes.
//
// At 180,000 tiles there is no DOM option: that many elements exhausts memory
// and stalls layout, and virtualising the viewport does not rescue it because
// zooming out legitimately puts every tile on screen at once. Canvas draws the
// whole world in a few milliseconds and needs no per-tile diffing at all, so the
// signature cache that guards the rest of the UI is not needed here — a render
// simply repaints what is visible.
//
// Scrolling is native: a spacer div sized to the whole world gives real
// scrollbars, and the canvas is sticky at the viewport, redrawn against the
// scroll offset.

const TERRAIN_COLOR = {
  water: '#16283a',
  plain: null,          // country tint shows through
  hills: '#4a3a22',
  coalfield: '#1c1c1c',
  oilfield: '#241634',
  gasfield: '#4a6f88',
  copperbelt: '#8f5232',
  bauxite: '#7d4f3d',
  quarry: '#7d8288',
  farmland: '#9d8c46',
  forest: '#24501f',
  desert: '#b08d4d',
  uraniumore: '#3f7a3a',
  lithiumflat: '#8f8a68',
  rareearth: '#6b3f80',
  offshoreOil: '#2b2350',
  offshoreGas: '#2f6f88',
  fishery: '#1f5a6b',
};

const TERRAIN_LABEL = {
  plain: 'plains', water: 'open sea', desert: 'desert',
  hills: 'hills (iron ore)', coalfield: 'coalfield', oilfield: 'oilfield',
  gasfield: 'gasfield', copperbelt: 'copperbelt', bauxite: 'bauxite',
  quarry: 'limestone quarry', farmland: 'farmland', forest: 'forest',
  uraniumore: 'uranium ore', lithiumflat: 'lithium salt flat', rareearth: 'rare earth deposit',
  offshoreOil: 'offshore oil', offshoreGas: 'offshore gas', fishery: 'fishing grounds',
};

const NEUTRAL_TINT = '#4a4f57';

// Cartography. The map is a Plate Carree wall map of the real world, so it is
// drawn like one: a graticule every fifteen degrees, a heavier line on the
// equator and the meridian, and a stroke along every national frontier.
//
// Borders are drawn from the tiles themselves rather than from any authored
// outline. A frontier is simply an edge where two neighbouring tiles belong to
// different countries — which means it can never disagree with who owns what,
// and it costs one extra comparison per tile rather than a second data set.
const BORDER_COLOR = '#0b0d12b3';
const COAST_COLOR = '#0a1620cc';
const PROVINCE_COLOR = '#fff1a066';
const GRATICULE = '#ffffff12';
const MERIDIAN = '#ffffff26';

// Degrees per source column and row, from world.js: column 0 is 180W at 3 deg
// per column, row 0 is 84N at 2.35 deg per row.
const LON_PER_COL = 3;
const LAT_PER_ROW = 2.35;
const GRID_DEGREES = 15;

export function mountMap(host, ctx) {
  const { state } = ctx;
  host.replaceChildren();

  const spacer = document.createElement('div');
  spacer.className = 'map__spacer';
  const canvas = document.createElement('canvas');
  canvas.className = 'map__canvas';
  host.append(spacer, canvas);

  const view = {
    canvas,
    spacer,
    ctx2d: canvas.getContext('2d'),
    tilePx: 0,
    hover: null,
  };

  const toTile = (event) => {
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left + host.scrollLeft;
    const py = event.clientY - rect.top + host.scrollTop;
    const x = Math.floor(px / view.tilePx);
    const y = Math.floor(py / view.tilePx);
    if (x < 0 || y < 0 || x >= state.grid.w || y >= state.grid.h) return null;
    return y * state.grid.w + x;
  };

  host.addEventListener('click', (event) => {
    // A drag that ended on a tile is a pan, not a click. Without this, moving
    // the map with the mouse would build a mine wherever you let go.
    if (view.dragged) { view.dragged = false; return; }
    const id = toTile(event);
    if (id != null) ctx.onTileClick(id);
  });
  host.addEventListener('contextmenu', (event) => {
    const id = toTile(event);
    if (id == null) return;
    event.preventDefault();
    ctx.onTileRightClick(id);
  });
  host.addEventListener('mousemove', (event) => {
    const id = toTile(event);
    if (id === view.hover) return;
    view.hover = id;
    canvas.title = id == null ? '' : tooltip(ctx.state, ctx.state.tiles[id]);
  });
  // Redrawing on scroll is the whole point of a viewport-sized canvas.
  host.addEventListener('scroll', () => draw(host, view, ctx), { passive: true });

  attachZoom(host, view, ctx);
  attachPan(host, view);

  // The map fills the window, so its size is not something a render can assume.
  // It is zero on the very first layout pass, and it changes whenever the window
  // does — and renders happen on a TICK, so a paused game would otherwise sit
  // there blank or stretched until something else moved. The observer fires on
  // both, and `dispose` matters because remounting builds a second canvas: an
  // observer left attached would keep painting the detached one.
  const resize = new ResizeObserver(() => draw(host, view, ctx));
  resize.observe(host);
  view.dispose = () => resize.disconnect();

  return view;
}

export function updateMap(host, view, ctx) {
  draw(host, view, ctx);
}

// Zoom is the wheel and the trackpad, and nothing else. There are no buttons any
// more, so this has to cover every gesture a pointing device makes:
//
//   * a mouse wheel notch          -> one zoom level
//   * a trackpad pinch             -> arrives as `wheel` with ctrlKey set, which
//                                     is how every browser reports it
//   * a two-finger swipe           -> also `wheel`, and treated as zoom too,
//                                     because the map has no scrollbars left for
//                                     it to drive
//
// The tile under the cursor stays under the cursor: zooming toward a point and
// then having to hunt for it again is the whole reason wheel zoom feels wrong
// when it is implemented as a plain level change.
function attachZoom(host, view, ctx) {
  host.addEventListener('wheel', (event) => {
    event.preventDefault();
    const step = event.deltaY < 0 ? 1 : -1;
    const next = Math.min(CONFIG.zoomLevels.length - 1, Math.max(0, ctx.ui.zoom + step));
    if (next === ctx.ui.zoom) return;

    // Where the pointer is in WORLD coordinates, before and after.
    const rect = host.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const was = CONFIG.zoomLevels[ctx.ui.zoom];
    const to = CONFIG.zoomLevels[next];
    const worldX = (host.scrollLeft + px) / was;
    const worldY = (host.scrollTop + py) / was;

    ctx.ui.zoom = next;
    // The spacer has to grow before the scroll offset can be set against it.
    view.spacer.style.width = `${ctx.state.grid.w * to}px`;
    view.spacer.style.height = `${ctx.state.grid.h * to}px`;
    host.scrollLeft = Math.max(0, worldX * to - px);
    host.scrollTop = Math.max(0, worldY * to - py);
    ctx.onZoom(next);
  }, { passive: false });
}

// ...and panning is dragging, since the scrollbars are gone. `dragged` is what
// tells the click handler above that the pointer went down to move the map
// rather than to put a building on it.
function attachPan(host, view) {
  let from = null;
  host.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    from = { x: event.clientX, y: event.clientY, left: host.scrollLeft, top: host.scrollTop, moved: 0 };
  });
  const end = () => { from = null; };
  host.addEventListener('pointerup', end);
  host.addEventListener('pointerleave', end);
  host.addEventListener('pointercancel', end);
  host.addEventListener('pointermove', (event) => {
    if (!from) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    from.moved = Math.max(from.moved, Math.abs(dx) + Math.abs(dy));
    // A few pixels of wobble while clicking is not a drag. Past that it is, and
    // the click that follows is swallowed.
    if (from.moved < 4) return;
    view.dragged = true;
    host.scrollLeft = from.left - dx;
    host.scrollTop = from.top - dy;
  });
}

// Puts a tile in the middle of the viewport. Picking a site out of the factory
// list is a navigation, and finding one of 180,000 tiles by hand is not.
export function centerMapOn(host, view, ctx, x, y) {
  const tilePx = CONFIG.zoomLevels[ctx.ui.zoom] ?? CONFIG.zoomLevels[CONFIG.defaultZoom];
  host.scrollLeft = Math.max(0, (x + 0.5) * tilePx - host.clientWidth / 2);
  host.scrollTop = Math.max(0, (y + 0.5) * tilePx - host.clientHeight / 2);
  draw(host, view, ctx);
}

function draw(host, view, ctx) {
  const { state, ui } = ctx;
  const tilePx = CONFIG.zoomLevels[ui.zoom] ?? CONFIG.zoomLevels[CONFIG.defaultZoom];
  const { w, h } = state.grid;

  if (view.tilePx !== tilePx) {
    view.tilePx = tilePx;
    view.spacer.style.width = `${w * tilePx}px`;
    view.spacer.style.height = `${h * tilePx}px`;
  }

  // The canvas covers only what is on screen, at device resolution.
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const cssW = Math.min(host.clientWidth, w * tilePx);
  const cssH = Math.min(host.clientHeight, h * tilePx);
  if (view.canvas.width !== Math.round(cssW * dpr) || view.canvas.height !== Math.round(cssH * dpr)) {
    view.canvas.width = Math.round(cssW * dpr);
    view.canvas.height = Math.round(cssH * dpr);
    view.canvas.style.width = `${cssW}px`;
    view.canvas.style.height = `${cssH}px`;
  }

  const g = view.ctx2d;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cssW, cssH);

  const left = host.scrollLeft;
  const top = host.scrollTop;
  // The canvas sits at the content origin, so it is moved to follow the scroll.
  view.canvas.style.transform = `translate(${left}px, ${top}px)`;
  const x0 = Math.max(0, Math.floor(left / tilePx));
  const y0 = Math.max(0, Math.floor(top / tilePx));
  const x1 = Math.min(w, Math.ceil((left + cssW) / tilePx));
  const y1 = Math.min(h, Math.ceil((top + cssH) / tilePx));

  // Owners are indexed once per draw rather than searched per tile.
  const byTile = new Map();
  for (const b of state.buildings) byTile.set(b.tileId, b);

  const tool = ui.tool;
  const glyphs = tilePx >= 10;
  // Frontier segments, gathered as the tiles are painted and stroked once at
  // the end. Flat arrays of x1,y1,x2,y2 rather than objects: at one pixel a tile
  // this can run to thousands of edges on one draw.
  const borders = ui.borders !== false;
  const frontiers = [];
  const coasts = [];
  const provinces = [];
  if (glyphs) {
    g.font = `${Math.floor(tilePx * 0.74)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
  }

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const tile = state.tiles[y * w + x];
      const px = Math.floor(x * tilePx - left);
      const py = Math.floor(y * tilePx - top);
      const building = byTile.get(tile.id);

      g.fillStyle = fillFor(state, tile, building);
      g.fillRect(px, py, tilePx, tilePx);

      if (building) {
        const ring = statusColor(building);
        if (ring && tilePx >= 3) {
          g.strokeStyle = ring;
          g.lineWidth = 1;
          g.strokeRect(px + 0.5, py + 0.5, tilePx - 1, tilePx - 1);
        }
        if (glyphs) {
          g.fillStyle = '#000';
          g.fillText(BUILDINGS[building.type].glyph, px + tilePx / 2 + 1, py + tilePx / 2 + 1);
          g.fillStyle = '#fff';
          g.fillText(BUILDINGS[building.type].glyph, px + tilePx / 2, py + tilePx / 2);
        }
      } else if (tool && tile.countryId && canBuild(state, tool, tile).ok) {
        g.strokeStyle = '#5fbf7f';
        g.lineWidth = 1;
        g.strokeRect(px + 0.5, py + 0.5, tilePx - 1, tilePx - 1);
      }

      if (ui.selectedTileId === tile.id) {
        g.strokeStyle = '#f0b34b';
        g.lineWidth = 2;
        g.strokeRect(px + 1, py + 1, tilePx - 2, tilePx - 2);
      }

      if (!borders) continue;
      // Only the right and bottom edges of each tile are considered, so a
      // frontier is recorded once rather than twice from either side.
      const right = x + 1 < w ? state.tiles[y * w + x + 1] : null;
      const below = y + 1 < h ? state.tiles[(y + 1) * w + x] : null;
      edge(frontiers, coasts, provinces, tile, right, px + tilePx, py, px + tilePx, py + tilePx);
      edge(frontiers, coasts, provinces, tile, below, px, py + tilePx, px + tilePx, py + tilePx);
    }
  }

  // Frontiers and the graticule go on TOP of the terrain, so a border is never
  // painted over by the next tile along. The edges were COLLECTED in the tile
  // loop above rather than found in a second sweep of their own: at one pixel a
  // tile the visible window is the whole planet, and a second pass over 180,000
  // tiles would double the worst-case draw.
  if (borders) {
    strokeEdges(g, provinces, PROVINCE_COLOR, tilePx >= 5 ? 1.25 : 1);
    strokeEdges(g, frontiers, BORDER_COLOR, tilePx >= 5 ? 1.5 : 1);
    strokeEdges(g, coasts, COAST_COLOR, tilePx >= 5 ? 1.5 : 1);
    drawGraticule(g, state, tilePx, left, top, cssW, cssH);
    drawProvinceLabels(g, state, tilePx, left, top, cssW, cssH, x0, y0, x1, y1);
    drawLabels(g, state, tilePx, left, top, cssW, cssH);
  }
}

function drawProvinceLabels(g, state, tilePx, left, top, cssW, cssH, x0, y0, x1, y1) {
  if (tilePx < 5) return;
  const centres = new Map();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const tile = state.tiles[y * state.grid.w + x];
      if (!tile.countryId || isSea(tile)) continue;
      const province = provinceForTile(tile);
      const key = `${tile.countryId}|${province}`;
      const row = centres.get(key) ?? { province, x: 0, y: 0, n: 0 };
      row.x += x;
      row.y += y;
      row.n++;
      centres.set(key, row);
    }
  }

  g.font = `500 ${Math.min(11, Math.max(8, Math.round(tilePx * 0.9)))}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 2.5;
  g.strokeStyle = '#0b0d12cc';
  g.fillStyle = '#fff1a0cc';
  for (const row of centres.values()) {
    if (row.n < 10) continue;
    const px = (row.x / row.n + 0.5) * tilePx - left;
    const py = (row.y / row.n + 0.5) * tilePx - top;
    if (px < -60 || py < -20 || px > cssW + 60 || py > cssH + 20) continue;
    g.strokeText(row.province.replace(' Province', ''), px, py);
    g.fillText(row.province.replace(' Province', ''), px, py);
  }
}

// Country names, once there is room to read one. Placed at the centroid the
// freight matrix already uses (data/geography.js), so a label sits exactly where
// the game thinks the country IS — a name drawn anywhere else would quietly
// disagree with what every haul costs.
function drawLabels(g, state, tilePx, left, top, cssW, cssH) {
  if (tilePx < 3) return;
  const scaleX = state.grid.w / SOURCE_W;
  const scaleY = state.grid.h / SOURCE_H;
  g.font = `600 ${Math.min(15, Math.max(9, Math.round(tilePx * 1.3)))}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 3;
  g.strokeStyle = '#0b0d12cc';
  for (const id of COUNTRY_IDS) {
    const centre = CENTROIDS[id];
    const px = (centre.x + 0.5) * scaleX * tilePx - left;
    const py = (centre.y + 0.5) * scaleY * tilePx - top;
    if (px < -60 || py < -20 || px > cssW + 60 || py > cssH + 20) continue;
    const name = tilePx >= 8 ? `${placeForCountry(id).city}\n${COUNTRIES[id].name}` : COUNTRIES[id].name;
    // A halo rather than a box: a filled label would hide the terrain it names.
    g.fillStyle = isPlayer(state, id) ? '#ffd9a8' : '#e6e9efbb';
    drawMultilineLabel(g, name, px, py, Math.round(tilePx * 1.45));
  }
}

function drawMultilineLabel(g, text, x, y, lineHeight) {
  const lines = text.split('\n');
  const top = y - ((lines.length - 1) * lineHeight) / 2;
  for (let i = 0; i < lines.length; i++) {
    const yy = top + i * lineHeight;
    g.strokeText(lines[i], x, yy);
    g.fillText(lines[i], x, yy);
  }
}

// One edge between two tiles, or nothing. A shore is queued separately from an
// inland frontier because the two want different colours, and switching
// strokeStyle per segment would mean a path per edge instead of two paths.
function edge(frontiers, coasts, provinces, tile, other, x1, y1, x2, y2) {
  if (!other) return;
  if (tile.countryId && tile.countryId === other?.countryId && !isSea(tile) && !isSea(other)
    && provinceForTile(tile) !== provinceForTile(other)) {
    provinces.push(x1, y1, x2, y2);
    return;
  }
  if (tile.countryId === other.countryId) return;
  const wet = isSea(tile) || isSea(other);
  // Open ocean is nobody's, so the line between two stretches of it is not a
  // frontier — only a shore or a border between two claims is.
  if (wet && (!tile.countryId || !other.countryId)) return;
  const into = wet ? coasts : frontiers;
  into.push(x1, y1, x2, y2);
}

function strokeEdges(g, segments, colour, width) {
  if (!segments.length) return;
  g.beginPath();
  for (let i = 0; i < segments.length; i += 4) {
    g.moveTo(segments[i], segments[i + 1]);
    g.lineTo(segments[i + 2], segments[i + 3]);
  }
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.stroke();
}

function isSea(tile) {
  return tile.terrain === 'water' || tile.terrain === 'offshoreOil'
    || tile.terrain === 'offshoreGas' || tile.terrain === 'fishery';
}

// Parallels and meridians every fifteen degrees, with the equator and the prime
// meridian picked out. The projection is plain equirectangular, so both are
// straight lines and the grid says so honestly — Greenland really is that size
// here, exactly as on the wall map this was traced from.
function drawGraticule(g, state, tilePx, left, top, cssW, cssH) {
  if (tilePx < 2) return;
  const { w, h } = state.grid;
  const colsPerDegree = w / (LON_PER_COL * 120);
  const rowsPerDegree = h / (LAT_PER_ROW * 60);

  g.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += GRID_DEGREES) {
    const x = Math.floor((lon + 180) * colsPerDegree * tilePx - left) + 0.5;
    if (x < 0 || x > cssW) continue;
    g.strokeStyle = lon === 0 ? MERIDIAN : GRATICULE;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, cssH);
    g.stroke();
  }
  for (let lat = 75; lat >= -60; lat -= GRID_DEGREES) {
    const y = Math.floor((84 - lat) * rowsPerDegree * tilePx - top) + 0.5;
    if (y < 0 || y > cssH) continue;
    g.strokeStyle = lat === 0 ? MERIDIAN : GRATICULE;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(cssW, y);
    g.stroke();
  }
}

function fillFor(state, tile, building) {
  // An occupied tile is painted by WHO owns it, so industry reads at a glance
  // even at one pixel per tile.
  if (building) return ownerColor(building.owner);
  const terrain = TERRAIN_COLOR[tile.terrain];
  if (terrain) {
    // Territorial waters keep a hint of their owner so coastlines read as owned.
    return tile.terrain === 'water' && tile.countryId ? '#1b3348' : terrain;
  }
  if (!tile.countryId) return NEUTRAL_TINT;
  // Two tiers now, because there are exactly two relationships left: your own
  // soil, and everybody else's. Every market on earth is open, so the map no
  // longer has to answer "where may I sell" — only "what is mine".
  const colour = COUNTRIES[tile.countryId].color;
  if (isPlayer(state, tile.countryId)) return colour;
  return dim(colour, 0.5);
}

const dimCache = new Map();
function dim(hex, factor) {
  const key = `${hex}|${factor}`;
  let out = dimCache.get(key);
  if (out) return out;
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round((((n >> 16) & 255) * factor) + 12);
  const gg = Math.round((((n >> 8) & 255) * factor) + 12);
  const b = Math.round(((n & 255) * factor) + 12);
  out = `rgb(${r},${gg},${b})`;
  dimCache.set(key, out);
  return out;
}

function statusColor(building) {
  switch (building.status) {
    case 'starved':
    case 'unstaffed': return '#e2685f';
    case 'blocked': return '#f0a04b';
    case 'running': return '#5fbf7f';
    case 'store': return '#dfe6ef';
    default: return null;
  }
}

function tooltip(state, tile) {
  const building = state.buildings.find((b) => b.tileId === tile.id);
  const where = tile.countryId
    ? placeName(tile.countryId)
    : tile.terrain === 'water' ? 'International waters' : 'Unclaimed territory';
  if (building) {
    const def = BUILDINGS[building.type];
    const whose = isPlayer(state, building.owner) ? 'yours' : ownerName(building.owner);
    return `${def.name} (${whose}) — ${describe(building, def)} · ${where}`;
  }
  const label = TERRAIN_LABEL[tile.terrain] ?? tile.terrain;
  const sea = tile.countryId && tile.terrain === 'water' ? ' · territorial waters' : '';
  return `${where} · ${label}${sea}`;
}

function placeName(countryId) {
  const place = placeForCountry(countryId);
  return `${COUNTRIES[countryId].name} · ${place.province} · ${place.city}`;
}

function describe(building, def) {
  if (building.status === 'starved') return `waiting on ${building.shortage.join(' + ')}`;
  if (building.status === 'blocked') return 'output full — no warehouse in range?';
  if (building.status === 'unstaffed') return 'unstaffed (payroll missed)';
  if (building.status === 'store') return 'warehouse';
  return def.recipe ? 'running' : 'idle';
}
