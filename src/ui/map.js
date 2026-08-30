import { CONFIG } from '../core/config.js';
import { BUILDINGS } from '../data/buildings.js';
import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { CENTROIDS } from '../data/geography.js';
import { placeForCountry, provinceForTile, provinceIndexForTile, PROVINCE_BOUNDS } from '../data/places.js';
import { SOURCE_COUNTRY_W, SOURCE_COUNTRY_H } from '../data/world.js';
import { ownerColor, ownerName, isPlayer } from '../core/state.js';
import { canBuild } from '../actions.js';
import { depotsByOwner, servedBy } from '../systems/logistics.js';
import { UNIT_TYPES, deployableTile, terroristForce, unitAffordable, canMilitaryEnter,
  canGroup, rangeOf } from '../systems/military.js';

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
  // Offshore deposits sit in a country's own sea, and there is a lot of that on
  // screen. They are a shade off the water rather than a colour of their own,
  // or every coastline on the planet reads as confetti.
  offshoreOil: '#222040',
  offshoreGas: '#22485c',
  fishery: '#1a3c4a',
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
// A province line is an INTERNAL division: it has to be visible when you are
// looking at one country and invisible when you are looking at the planet, so
// it is a hairline a shade lighter than the land rather than a bright stroke.
const PROVINCE_COLOR = '#ffffff2b';
// The tile size from which provinces are drawn at all, and the one from which
// they are named. Below PROVINCE_ZOOM a province is a few pixels across and the
// lines mesh into a grid that hides the continents — the map is a WORLD map at
// that range, and it has to read like one.
const PROVINCE_ZOOM = 3;
const PROVINCE_LABEL_ZOOM = 8;
const GRATICULE = '#ffffff12';
const MERIDIAN = '#ffffff26';

// The projection is plain equirectangular over the whole globe: column 0 is
// 180W, row 0 is 90N, and a tile is a quarter of a degree each way.
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
    const rect = host.getBoundingClientRect();
    const px = event.clientX - rect.left + host.scrollLeft;
    const py = event.clientY - rect.top + host.scrollTop;
    const x = Math.floor(px / view.tilePx);
    const y = Math.floor(py / view.tilePx);
    if (x < 0 || y < 0 || x >= state.grid.w || y >= state.grid.h) return null;
    return y * state.grid.w + x;
  };

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
  attachPan(host, view, ctx, toTile);

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
    const rect = host.getBoundingClientRect();
    zoomTo(host, view, ctx, ctx.ui.zoom + step, event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
}

// ZOOM TO A LEVEL, HOLDING ONE SCREEN POINT STILL.
//
// The wheel holds the cursor and a pinch holds the midpoint between the two
// fingers, but that is the only difference between them — so the arithmetic
// lives here once rather than twice. Anchoring is what makes either gesture feel
// right: zooming toward something and then having to hunt for it again is what
// makes a naive level change feel broken.
function zoomTo(host, view, ctx, level, px, py) {
  const next = Math.min(CONFIG.zoomLevels.length - 1, Math.max(0, level));
  if (next === ctx.ui.zoom) return false;

  // Where that point is in WORLD coordinates, before and after.
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
  return true;
}

// The zoom level whose tile size is nearest a wanted number of pixels. A pinch
// is continuous and `CONFIG.zoomLevels` is a ladder, so the gesture has to be
// resolved against the ladder rather than multiplying a level index — which is
// also what makes "pinch to twice the distance" mean "tiles twice the size"
// rather than some arbitrary number of steps.
function levelNearest(px) {
  let best = 0;
  for (let i = 1; i < CONFIG.zoomLevels.length; i++) {
    if (Math.abs(CONFIG.zoomLevels[i] - px) < Math.abs(CONFIG.zoomLevels[best] - px)) best = i;
  }
  return best;
}

// ...and panning is dragging, since the scrollbars are gone. `dragged` is what
// tells the click handler above that the pointer went down to move the map
// rather than to put a building on it.
function attachPan(host, view, ctx, toTile) {
  let from = null;
  // EVERY pointer currently down, because a second one means a PINCH.
  //
  // A phone has no wheel, so without this the map cannot be zoomed at all — it
  // opens at 2px a tile and stays there, which is the whole planet and nothing
  // you can build on. There are still no zoom buttons: a pinch is the gesture a
  // touch screen already has, exactly as the wheel is the one a mouse has.
  const down = new Map();
  let pinch = null;

  const spread = () => {
    const [a, b] = [...down.values()];
    return { gap: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };

  host.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    host.setPointerCapture?.(event.pointerId);
    down.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (down.size === 2) {
      // A pinch beginning cancels the drag the first finger started, or the map
      // lurches by however far the fingers have already moved apart. Leaving
      // `from` null is also what suppresses the tile click on the way back up:
      // `pointerup` returns early without one, so a two-finger zoom over your
      // own soil cannot quietly put a factory there.
      from = null;
      view.dragged = false;
      pinch = { gap: spread().gap, level: ctx.ui.zoom };
      return;
    }
    from = { x: event.clientX, y: event.clientY, left: host.scrollLeft, top: host.scrollTop, moved: 0 };
  });

  host.addEventListener('pointerup', (event) => {
    down.delete(event.pointerId);
    if (down.size < 2) pinch = null;
    if (!from || event.button !== 0) { host.releasePointerCapture?.(event.pointerId); return; }
    event.preventDefault();
    host.releasePointerCapture?.(event.pointerId);
    const wasDrag = from.moved >= 4;
    from = null;
    view.dragged = false;
    if (wasDrag) return;
    const id = toTile(event);
    if (id != null) ctx.onTileClick(id);
  });

  const end = (event) => {
    down.delete(event.pointerId);
    if (down.size < 2) pinch = null;
    if (from) host.releasePointerCapture?.(event.pointerId);
    from = null;
    view.dragged = false;
  };
  host.addEventListener('pointerleave', end);
  host.addEventListener('pointercancel', end);

  host.addEventListener('pointermove', (event) => {
    if (down.has(event.pointerId)) down.set(event.pointerId, { x: event.clientX, y: event.clientY });

    // Two fingers: the map zooms and does not pan. The tile between the fingers
    // is what stays put, which is the same promise the wheel makes about the
    // tile under the cursor.
    if (pinch && down.size === 2) {
      event.preventDefault();
      const { gap, mx, my } = spread();
      if (pinch.gap < 1 || gap < 1) return;
      const rect = host.getBoundingClientRect();
      const want = CONFIG.zoomLevels[pinch.level] * (gap / pinch.gap);
      zoomTo(host, view, ctx, levelNearest(want), mx - rect.left, my - rect.top);
      return;
    }

    if (!from) return;
    event.preventDefault();
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

export function centerMapOnCountry(host, view, ctx, countryId) {
  const centre = CENTROIDS[countryId];
  if (!centre) return;
  const tilePx = CONFIG.zoomLevels[ctx.ui.zoom] ?? CONFIG.zoomLevels[CONFIG.defaultZoom];
  const scaleX = ctx.state.grid.w / SOURCE_COUNTRY_W;
  const scaleY = ctx.state.grid.h / SOURCE_COUNTRY_H;
  host.scrollLeft = Math.max(0, (centre.x + 0.5) * scaleX * tilePx - host.clientWidth / 2);
  host.scrollTop = Math.max(0, (centre.y + 0.5) * scaleY * tilePx - host.clientHeight / 2);
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

  // Open on YOUR OWN country. Scroll starts at 0,0, which on a whole planet is
  // the empty North Pacific — every new game began by asking the player to go
  // and find themselves. It happens on the first draw rather than at mount
  // because the spacer has no size until here, and scrolling against a
  // zero-width scroller does nothing at all.
  if (!view.centred && host.clientWidth > 0) {
    view.centred = true;
    const home = CENTROIDS[state.home];
    if (home) {
      host.scrollLeft = Math.max(0, (home.x + 0.5) * (w / SOURCE_COUNTRY_W) * tilePx - host.clientWidth / 2);
      host.scrollTop = Math.max(0, (home.y + 0.5) * (h / SOURCE_COUNTRY_H) * tilePx - host.clientHeight / 2);
    }
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
  const depots = depotsByOwner(state);
  // ...and so are the standing formations, for exactly the same reason. There
  // are far fewer of them than buildings, but the tile loop is the whole
  // viewport and it must not search a list per square.
  //
  // Formations STACK now — a group converges on one tile and stays there — so
  // this is a tile to a LIST rather than a tile to a unit. The map draws the
  // top of the stack and says how deep it is.
  const unitsByTile = new Map();
  // ...and where your own marching columns are headed, so a destination can be
  // marked on the ground rather than only described in the panel. Only yours:
  // the world's orders are not your news.
  const ordersByTile = new Map();
  for (const u of state.military?.units ?? []) {
    const stack = unitsByTile.get(u.tileId);
    if (stack) stack.push(u); else unitsByTile.set(u.tileId, [u]);
    if (u.orderTileId == null || !isPlayer(state, u.owner)) continue;
    ordersByTile.set(u.orderTileId, (ordersByTile.get(u.orderTileId) ?? 0) + 1);
  }
  const terror = state.terrorism?.active ?? null;
  // ...and the ground a cell has been ANNOUNCED for, which is marked before
  // anything is standing on it. That is the whole use of the warning: you can
  // see where to be.
  const warned = !terror ? (state.terrorism?.warning ?? null) : null;

  const tool = ui.tool;
  // Whether a formation is in hand, and whether the warehouses could actually
  // pay for one. The affordability half costs a depot scan, so it is asked ONCE
  // here rather than per tile — `deployableTile` below is the cheap half.
  const unitTool = ui.unit;
  const canRaise = unitTool ? unitAffordable(state, state.home, unitTool, depots.get(state.home) ?? []) : false;
  // A formation already standing, waiting for its next order — set from the
  // Move button in the Selected pane. Valid destinations light up the same way
  // a deployable tile does, since both answer the same question: where may
  // this unit be.
  const moveUnit = ui.moveUnit != null ? (state.military?.units ?? []).find((u) => u.id === ui.moveUnit) : null;
  // ...and the formation whose group is being assembled. While one is in hand,
  // the OTHER formations it could legally march with light up, so "aircraft
  // group only with aircraft" is something you can see rather than a refusal
  // you find out about by clicking.
  const groupUnit = ui.groupUnit != null ? (state.military?.units ?? []).find((u) => u.id === ui.groupUnit) : null;
  const glyphs = tilePx >= 10;
  // Frontier segments, gathered as the tiles are painted and stroked once at
  // the end. Flat arrays of x1,y1,x2,y2 rather than objects: at one pixel a tile
  // this can run to thousands of edges on one draw.
  const borders = ui.borders !== false;
  // Province lines are gathered only when they could be seen. At two pixels a
  // tile they are invisible, and asking every tile which province it is in — for
  // both of its edges, over a viewport that is the whole planet — is the one
  // question in this loop that is worth not asking.
  const provinceLines = borders && tilePx >= PROVINCE_ZOOM;
  const frontiers = [];
  const coasts = [];
  const provinces = [];
  if (glyphs) {
    g.font = `${Math.floor(tilePx * 0.74)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
  }

  // The base fill is drawn in RUNS of one colour rather than a rect per tile.
  // Most of a row is ocean, or one country, so this turns tens of thousands of
  // fillRect calls — and, worse, tens of thousands of `fillStyle` assignments,
  // which are the expensive half — into a few dozen a row. It is what makes the
  // whole planet affordable to draw at one pixel a tile.
  //
  // A run is flushed BEFORE anything is drawn on top of a tile inside it, or the
  // fill would paint over the ring it was meant to sit under.
  let runColour = null;
  let runFrom = 0;
  const flush = (until, py) => {
    if (runColour === null) return;
    const from = Math.floor(runFrom * tilePx - left);
    g.fillStyle = runColour;
    g.fillRect(from, py, Math.max(1, Math.floor(until * tilePx - left) - from), tilePx);
    runColour = null;
  };

  for (let y = y0; y < y1; y++) {
    const py = Math.floor(y * tilePx - top);
    runColour = null;

    for (let x = x0; x < x1; x++) {
      const tile = state.tiles[y * w + x];
      const px = Math.floor(x * tilePx - left);
      const building = byTile.get(tile.id);

      const colour = fillFor(state, tile, building);
      if (colour !== runColour) {
        flush(x, py);
        runColour = colour;
        runFrom = x;
      }

      const stack = unitsByTile.get(tile.id);
      const unit = stack ? stack[stack.length - 1] : null;
      const camp = terror && terror.tileId === tile.id;
      const omen = warned && warned.tileId === tile.id;
      const bound = ordersByTile.get(tile.id);
      const buildable = !building && tool && tile.countryId && canBuild(state, tool, tile).ok;
      const raisable = !building && !unit && canRaise && deployableTile(state, state.home, unitTool, tile);
      // A destination for an order may be occupied — formations stack, and a
      // column arriving on the tile a scout already holds is the normal case —
      // so a movable tile is no longer gated on being empty of units.
      const movable = !building && moveUnit && tile.id !== moveUnit.tileId
        && canMilitaryEnter(state, moveUnit, tile);
      const groupable = groupUnit && unit && unit.id !== groupUnit.id && canGroup(groupUnit, unit);
      const selected = ui.selectedTileId === tile.id;
      if (building || unit || camp || omen || bound || buildable || raisable || movable || selected) flush(x + 1, py);

      if (building) {
        const stranded = building.output && !servedBy(depots.get(building.owner) ?? [], building.x, building.y);
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
        if (stranded) drawStrandedBadge(g, px, py, tilePx);
      } else if (buildable || raisable || movable) {
        g.strokeStyle = raisable || movable ? '#7fa8ff' : '#5fbf7f';
        g.lineWidth = 1;
        g.strokeRect(px + 0.5, py + 0.5, tilePx - 1, tilePx - 1);
      }
      // A formation you could add to the group in hand. Green rather than the
      // blue "you may stand here", because it is a different question.
      if (groupable) {
        g.strokeStyle = '#7fdca0';
        g.lineWidth = 2;
        g.strokeRect(px + 1, py + 1, tilePx - 2, tilePx - 2);
      }

      // A formation is drawn ON TOP of whatever ground it holds rather than
      // recolouring it: an army occupies land, it does not replace it. A stack
      // draws its topmost unit and carries a count.
      if (unit) drawUnit(g, unit, px, py, tilePx, glyphs, isPlayer(state, unit.owner), stack.length);
      if (bound) drawWaypoint(g, px, py, tilePx);
      if (camp) drawCamp(g, px, py, tilePx, glyphs);
      if (omen) drawOmen(g, px, py, tilePx);

      if (selected) {
        g.strokeStyle = '#f0b34b';
        g.lineWidth = 2;
        g.strokeRect(px + 1, py + 1, tilePx - 2, tilePx - 2);
      }

      if (!borders) continue;
      // Only the right and bottom edges of each tile are considered, so a
      // frontier is recorded once rather than twice from either side.
      const right = x + 1 < w ? state.tiles[y * w + x + 1] : null;
      const below = y + 1 < h ? state.tiles[(y + 1) * w + x] : null;
      edge(frontiers, coasts, provinceLines ? provinces : null, tile, right, px + tilePx, py, px + tilePx, py + tilePx);
      edge(frontiers, coasts, provinceLines ? provinces : null, tile, below, px, py + tilePx, px + tilePx, py + tilePx);
    }
    flush(x1, py);
  }

  // How far the selected formation can reach to fight, drawn as ONE rectangle
  // after the tile loop rather than as a highlight per tile inside it. Only
  // artillery's is bigger than the ground it stands on, so this is the whole
  // visible difference between a gun and a rifle and it is worth showing — but
  // it must not cost a per-tile question to show it.
  const chosen = ui.selectedTileId != null ? unitsByTile.get(ui.selectedTileId) : null;
  if (chosen && tilePx >= 3) {
    const lead = chosen[chosen.length - 1];
    const reach = rangeOf(lead);
    const from = Math.floor((lead.x - reach) * tilePx - left);
    const above = Math.floor((lead.y - reach) * tilePx - top);
    g.save();
    g.strokeStyle = '#e0a34b99';
    g.lineWidth = 1.5;
    g.setLineDash([4, 3]);
    g.strokeRect(from + 0.5, above + 0.5, (reach * 2 + 1) * tilePx - 1, (reach * 2 + 1) * tilePx - 1);
    g.restore();
  }

  // Frontiers and the graticule go on TOP of the terrain, so a border is never
  // painted over by the next tile along. The edges were COLLECTED in the tile
  // loop above rather than found in a second sweep of their own: at one pixel a
  // tile the visible window is the whole planet, and a second pass over 180,000
  // tiles would double the worst-case draw.
  if (borders) {
    strokeEdges(g, provinces, PROVINCE_COLOR, 1);
    strokeEdges(g, frontiers, BORDER_COLOR, tilePx >= 5 ? 1.5 : 1);
    strokeEdges(g, coasts, COAST_COLOR, tilePx >= 5 ? 1.5 : 1);
    drawGraticule(g, state, tilePx, left, top, cssW, cssH);
    drawProvinceLabels(g, state, tilePx, left, top, cssW, cssH, x0, y0, x1, y1);
    drawLabels(g, state, tilePx, left, top, cssW, cssH);
  }
}

function drawProvinceLabels(g, state, tilePx, left, top, cssW, cssH, x0, y0, x1, y1) {
  // A province is NAMED later than it is drawn. Its line only has to be seen;
  // its name has to be read, and a planet's worth of them at once is not a map
  // any more.
  if (tilePx < PROVINCE_LABEL_ZOOM) return;
  // ...and how much of one has to be on screen before it is worth naming: the
  // closer in you are, the less of it you need to see.
  const minTiles = tilePx >= 20 ? 4 : tilePx >= 14 ? 8 : 20;
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

  g.font = `500 ${Math.min(13, Math.max(8, Math.round(tilePx * 0.9)))}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 2.5;
  g.strokeStyle = '#0b0d12cc';
  g.fillStyle = '#fff1a0cc';
  for (const row of centres.values()) {
    if (row.n < minTiles) continue;
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
  if (tilePx < 2) return;
  // CENTROIDS are in OWNERSHIP-grid cells (geography.js), which is the grid the
  // tiles are on. Scaling them by the old hand-painted art grid put every
  // country's name several screens away from the country.
  const scaleX = state.grid.w / SOURCE_COUNTRY_W;
  const scaleY = state.grid.h / SOURCE_COUNTRY_H;
  const fontPx = Math.min(15, Math.max(9, Math.round(tilePx * 1.3)));
  g.font = `600 ${fontPx}px system-ui, sans-serif`;
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
    // A name has to FIT the land it names. Without this the Caribbean is a wall
    // of overlapping text at every zoom — fifteen territories whose whole
    // coastline is narrower than the word for it. Zoom in and each one gets its
    // label the moment there is room for it.
    //
    // The width is ESTIMATED from the character count rather than measured:
    // `measureText` on a hundred and fifty countries a draw costs more than
    // every fill in the viewport put together, and this only has to decide
    // whether a name is roughly too big for its country.
    const box = PROVINCE_BOUNDS[id];
    if (box && Number.isFinite(box.minX)) {
      const wide = (box.maxX - box.minX + 1) * scaleX * tilePx;
      const longest = Math.max(...name.split('\n').map((line) => line.length)) * fontPx * 0.55;
      if (wide < longest * 0.7) continue;
    }
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
  if (tile.countryId && tile.countryId === other.countryId) {
    // Same country: the only line that can run here is a provincial one, and
    // only when they are close enough to see. Indices, not names — this runs
    // twice per tile.
    if (provinces && !isSea(tile) && !isSea(other)
      && provinceIndexForTile(tile) !== provinceIndexForTile(other)) {
      provinces.push(x1, y1, x2, y2);
    }
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
  // Pole to pole, 180 degrees of latitude over the whole grid. This used to be
  // measured against the old hand-painted art, which ran 84N to 57S — every
  // parallel was drawn a couple of thousand kilometres off.
  const colsPerDegree = w / 360;
  const rowsPerDegree = h / 180;

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
  for (let lat = 75; lat >= -75; lat -= GRID_DEGREES) {
    const y = Math.floor((90 - lat) * rowsPerDegree * tilePx - top) + 0.5;
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
  if (isPlayer(state, tile.countryId)) return COUNTRIES[tile.countryId].color;
  return DIM[tile.countryId];
}

// Every country's foreign tint, worked out ONCE. This used to be a cache keyed
// by a template string, which meant building a string and hashing it for every
// land tile on screen — a couple of hundred thousand of them a draw, and the
// single biggest cost in the fill loop after `fillStyle` itself.
const DIM = Object.fromEntries(COUNTRY_IDS.map((id) => [id, dim(COUNTRIES[id].color, 0.5)]));

function dim(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round((((n >> 16) & 255) * factor) + 12);
  const g = Math.round((((n >> 8) & 255) * factor) + 12);
  const b = Math.round(((n & 255) * factor) + 12);
  return `rgb(${r},${g},${b})`;
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

// A standing formation: a disc in its owner's colour, with the unit's glyph on
// it once there is room to read one. A unit that was IN CONTACT last tick wears
// a red rim, because "why is my army melting" has to be answerable from the map.
function drawUnit(g, unit, px, py, tilePx, glyphs, mine, stacked = 1) {
  const def = UNIT_TYPES[unit.type];
  if (!def) return;
  g.save();
  const radius = Math.max(2, Math.min(tilePx * 0.42, 11));
  const cx = px + tilePx / 2;
  const cy = py + tilePx / 2;
  // A formation that marches with a group wears a second ring. Grouping is
  // invisible otherwise — it changes nothing you can see except where the
  // column goes next — and an order given to one that quietly moved four is
  // exactly the surprise a marker prevents.
  if (unit.groupId != null && tilePx >= 6) {
    g.beginPath();
    g.arc(cx, cy, radius + 2, 0, Math.PI * 2);
    g.lineWidth = 1;
    g.strokeStyle = '#7fdca0';
    g.stroke();
  }
  g.beginPath();
  g.arc(cx, cy, radius, 0, Math.PI * 2);
  g.fillStyle = mine ? '#e9f0ff' : '#8d95a4';
  g.fill();
  g.lineWidth = tilePx >= 8 ? 2 : 1;
  g.strokeStyle = unit.engaged ? '#e22929' : '#0b0d12cc';
  g.stroke();
  if (glyphs) {
    g.fillStyle = '#12151c';
    g.font = `${Math.floor(tilePx * 0.6)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(def.glyph, cx, cy);
    // How many formations are standing on this square. Only the top one is
    // drawn, so without this a column of five reads as a lone scout.
    if (stacked > 1) {
      g.font = `700 ${Math.max(8, Math.floor(tilePx * 0.34))}px system-ui, sans-serif`;
      g.fillStyle = '#0b0d12';
      g.fillText(`×${stacked}`, cx + radius * 0.9, cy - radius * 0.85);
      g.fillStyle = '#f0e9c8';
      g.fillText(`×${stacked}`, cx + radius * 0.9 - 0.5, cy - radius * 0.85 - 0.5);
    }
  }
  g.restore();
}

// Where one of your own marching columns is headed. A standing order takes many
// ticks now, so the destination has to be somewhere you can see it — otherwise
// an army crossing a continent looks like an army that has stopped.
function drawWaypoint(g, px, py, tilePx) {
  const cx = px + tilePx / 2;
  const cy = py + tilePx / 2;
  const arm = Math.max(2, tilePx * 0.34);
  g.save();
  g.strokeStyle = '#7fa8ff';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(cx - arm, cy);
  g.lineTo(cx + arm, cy);
  g.moveTo(cx, cy - arm);
  g.lineTo(cx, cy + arm);
  g.stroke();
  g.restore();
}

// The ground a cell has been announced for, before anything is standing on it.
// A dashed amber ring rather than the camp's solid red: nothing is there YET,
// and the difference between "a cell is here" and "a cell will be here" is the
// whole value of the warning.
function drawOmen(g, px, py, tilePx) {
  const cx = px + tilePx / 2;
  const cy = py + tilePx / 2;
  const radius = Math.max(3, Math.min(tilePx * 0.5, 13));
  g.save();
  g.strokeStyle = '#f0a04b';
  g.lineWidth = tilePx >= 8 ? 2 : 1;
  g.setLineDash([3, 3]);
  g.beginPath();
  g.arc(cx, cy, radius, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

// The terrorist camp. Deliberately the loudest thing on the map: there is only
// ever one, and the whole mechanic is that you go and deal with it.
function drawCamp(g, px, py, tilePx, glyphs) {
  g.save();
  const radius = Math.max(3, Math.min(tilePx * 0.5, 13));
  const cx = px + tilePx / 2;
  const cy = py + tilePx / 2;
  g.beginPath();
  g.arc(cx, cy, radius, 0, Math.PI * 2);
  g.fillStyle = '#e2292988';
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = '#ff5a4d';
  g.stroke();
  if (glyphs) {
    g.fillStyle = '#fff';
    g.font = `700 ${Math.floor(tilePx * 0.62)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('☠', cx, cy);
  }
  g.restore();
}

function drawStrandedBadge(g, px, py, tilePx) {
  g.save();
  const radius = Math.max(3, Math.min(8, tilePx * 0.34));
  const cx = px + tilePx - radius - 1;
  const cy = py + radius + 1;
  g.fillStyle = '#e22929';
  g.beginPath();
  g.arc(cx, cy, radius, 0, Math.PI * 2);
  g.fill();
  if (tilePx >= 8) {
    g.fillStyle = '#fff';
    g.font = `700 ${Math.max(7, Math.floor(radius * 1.7))}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('!', cx, cy + 0.2);
  }
  g.restore();
}

function tooltip(state, tile) {
  const building = state.buildings.find((b) => b.tileId === tile.id);
  const where = tile.countryId
    ? placeName(tile)
    : tile.terrain === 'water' ? 'International waters' : 'Unclaimed territory';
  const active = state.terrorism?.active;
  if (active && active.tileId === tile.id) {
    const force = terroristForce(active);
    return `${active.name} — ${force.infantry} infantry, ${force.armoredCar} armoured car${force.armoredCar === 1 ? '' : 's'}`
      + ` · ${active.destroyed ?? 0} site${(active.destroyed ?? 0) === 1 ? '' : 's'} destroyed · ${where}`;
  }
  // Formations stack, so the hover names what is actually standing here rather
  // than only the first of them.
  const here = (state.military?.units ?? []).filter((u) => u.tileId === tile.id);
  if (here.length && !building) {
    const unit = here[here.length - 1];
    const def = UNIT_TYPES[unit.type];
    const whose = isPlayer(state, unit.owner) ? 'yours' : ownerName(unit.owner);
    return `${def.name} (${whose}) — strength ${unit.strength.toFixed(1)}/${def.strength}`
      + ` · ${def.speed} tile${def.speed === 1 ? '' : 's'}/tick, strikes ${def.range}`
      + `${here.length > 1 ? ` · ${here.length} formations here` : ''}`
      + `${unit.groupId != null ? ' · grouped' : ''}`
      + `${unit.orderTileId != null ? ' · marching' : ''}`
      + `${unit.engaged ? ' · IN CONTACT' : ''} · ${where}`;
  }
  if (building) {
    const def = BUILDINGS[building.type];
    const whose = isPlayer(state, building.owner) ? 'yours' : ownerName(building.owner);
    return `${def.name} (${whose}) — ${describe(building, def)} · ${where}`;
  }
  const label = TERRAIN_LABEL[tile.terrain] ?? tile.terrain;
  const sea = tile.countryId && tile.terrain === 'water' ? ' · territorial waters' : '';
  return `${where} · ${label}${sea}`;
}

// The province under the POINTER, not the country's first one. Hovering Texas
// and being told "California" was the old answer, and it made the whole
// subdivision layer read as decoration.
function placeName(tile) {
  const place = placeForCountry(tile.countryId);
  const province = provinceForTile(tile) ?? place.province;
  return `${COUNTRIES[tile.countryId].name} · ${province} · ${place.city}`;
}

function describe(building, def) {
  if (building.status === 'starved') return `waiting on ${building.shortage.join(' + ')}`;
  if (building.status === 'blocked') return 'output full — no warehouse in range?';
  if (building.status === 'unstaffed') return 'unstaffed (payroll missed)';
  if (building.status === 'store') return 'warehouse';
  return def.recipe ? 'running' : 'idle';
}
