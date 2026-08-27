import { CONFIG } from '../core/config.js';
import { BUILDINGS } from '../data/buildings.js';
import { COUNTRIES } from '../data/countries.js';
import { hasPact, ownerColor, ownerName, isPlayer } from '../core/state.js';
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
  offshoreOil: '#2b2350',
  offshoreGas: '#2f6f88',
  fishery: '#1f5a6b',
};

const TERRAIN_LABEL = {
  plain: 'plains', water: 'open sea', desert: 'desert',
  hills: 'hills (iron ore)', coalfield: 'coalfield', oilfield: 'oilfield',
  gasfield: 'gasfield', copperbelt: 'copperbelt', bauxite: 'bauxite',
  quarry: 'limestone quarry', farmland: 'farmland', forest: 'forest',
  offshoreOil: 'offshore oil', offshoreGas: 'offshore gas', fishery: 'fishing grounds',
};

const NEUTRAL_TINT = '#4a4f57';

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
    }
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
  // Three tiers, because there are exactly three relationships you can have with
  // a nation: your own soil at full strength, a trade partner clearly readable,
  // and everyone else pushed back — so the map answers "where can I sell" at a
  // glance, at any zoom.
  const colour = COUNTRIES[tile.countryId].color;
  if (isPlayer(state, tile.countryId)) return colour;
  return dim(colour, hasPact(state, tile.countryId) ? 0.6 : 0.28);
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
    ? COUNTRIES[tile.countryId].name
    : tile.terrain === 'water' ? 'International waters' : 'Unclaimed territory';
  if (building) {
    const def = BUILDINGS[building.type];
    const whose = isPlayer(state, building.owner) ? 'yours' : ownerName(building.owner);
    return `${def.name} (${whose}) — ${describe(building, def)} · ${where}`;
  }
  const label = TERRAIN_LABEL[tile.terrain] ?? tile.terrain;
  const sea = tile.countryId && tile.terrain === 'water' ? ' · territorial waters' : '';
  const standing = !tile.countryId || isPlayer(state, tile.countryId)
    ? ''
    : hasPact(state, tile.countryId) ? ' · trade pact' : ' · no pact';
  return `${where} · ${label}${sea}${standing}`;
}

function describe(building, def) {
  if (building.status === 'starved') return `waiting on ${building.shortage.join(' + ')}`;
  if (building.status === 'blocked') return 'output full — no warehouse in range?';
  if (building.status === 'unstaffed') return 'unstaffed (payroll missed)';
  if (building.status === 'store') return 'warehouse';
  return def.recipe ? 'running' : 'idle';
}
