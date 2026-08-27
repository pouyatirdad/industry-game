import { CONFIG } from './config.js';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities.js';
import { BUILDINGS } from '../data/buildings.js';
import { COUNTRIES, COUNTRY_IDS, COUNTRY_BY_CHAR, DEFAULT_HOME, TREASURY_PER_DEMAND, TREASURY_FLOOR, STARTING_PACTS } from '../data/countries.js';
import { WORLD_ROWS, WORLD_W, WORLD_H, AREA_SCALE, OCEAN_CHAR } from '../data/world.js';
import { neighboursOf } from '../data/geography.js';

const SAVE_KEY = 'industry-game.save.v7';
const SAVE_VERSION = 7;

// You are a NATION, not a firm. There is no separate player object: the country
// you picked is an entry in `state.countries` exactly like the other forty-five,
// with the same treasury, the same payroll and the same industry. `state.home`
// is the only thing that says which one is yours, and every system that needs to
// know asks `isPlayer`.
//
// The consequence worth stating plainly: a building's owner is also the nation
// it stands in, because a government builds only on its own soil. `owner`
// therefore answers both "whose is it" and "whose wages, whose market".

// Deposits are laid down in this order, so a country with more deposits than
// room keeps what it is actually known for and loses the generic filler. Scarce
// and strategic first; ubiquitous (quarry, farmland) and barren (desert) last.
// Order is load-bearing for balance, and it makes generation reproducible.
const DEPOSIT_ORDER = [
  'oilfield', 'gasfield', 'copperbelt', 'bauxite', 'hills', 'coalfield',
  'forest', 'farmland', 'quarry', 'desert',
];

// Offshore deposits, laid into a country's territorial waters. Authored as a
// FRACTION of that country's sea rather than a tile count, so they need no
// scaling when the grid grows.
const WATER_DEPOSIT_ORDER = ['offshoreOil', 'offshoreGas', 'fishery'];

// How far a country's territorial waters reach from its coast, in tiles.
const TERRITORIAL_RANGE = 8;

// Never let a country's whole sea become deposits — open water has to remain.
const MAX_WATER_SHARE = 0.7;

// Every terrain that is a resource rather than ground or open sea. Used by tests
// and the UI to tell a deposit from empty space without restating the list.
export const DEPOSIT_TERRAINS = [...DEPOSIT_ORDER, ...WATER_DEPOSIT_ORDER];
export const WATER_TERRAINS = WATER_DEPOSIT_ORDER;

// A country whose every tile is a mine can extract but never manufacture, which
// is a dead end rather than a hard choice. This reserves flat ground.
const MAX_DEPOSIT_SHARE = 0.68;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rand) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Continents and borders come from world.js and never change. Only which of a
// country's own tiles carry its deposits is seeded, so Reset rerolls the
// geology of a fixed planet rather than inventing a new one.
export function generateWorld(seed) {
  const tiles = [];
  const owned = {};
  for (const id of COUNTRY_IDS) owned[id] = [];

  for (let y = 0; y < WORLD_H; y++) {
    const row = WORLD_ROWS[y];
    for (let x = 0; x < WORLD_W; x++) {
      const char = row[x];
      const countryId = COUNTRY_BY_CHAR[char] ?? null;
      const index = y * WORLD_W + x;
      tiles.push({
        id: index,
        x,
        y,
        terrain: char === OCEAN_CHAR ? 'water' : 'plain',
        countryId,
        buildingId: null,
      });
      if (countryId) owned[countryId].push(index);
    }
  }

  claimTerritorialWaters(tiles, owned);

  COUNTRY_IDS.forEach((id, countryIndex) => {
    const rand = mulberry32((seed ^ Math.imul(countryIndex + 1, 0x9e3779b1)) >>> 0);
    const pool = shuffle(owned[id].slice(), rand);
    // At least one tile stays plain even in a one-tile country, so `budget` is
    // floored to pool.length - 1 rather than to a share of it.
    const budget = Math.min(
      pool.length ? pool.length - 1 : 0,
      Math.floor(pool.length * MAX_DEPOSIT_SHARE),
    );
    let cursor = 0;
    for (const terrain of DEPOSIT_ORDER) {
      // Authored against the 120x60 source, so scaled to whatever grid we run.
      const wanted = Math.round((COUNTRIES[id].deposits[terrain] ?? 0) * AREA_SCALE);
      for (let n = 0; n < wanted && cursor < budget; n++, cursor++) {
        tiles[pool[cursor]].terrain = terrain;
      }
    }
  });

  layOffshoreDeposits(tiles, seed);
  return tiles;
}

// Ocean within TERRITORIAL_RANGE of a coast belongs to the nearest country. A
// single multi-source breadth-first sweep out from every land tile at once gives
// each water tile its nearest owner in one O(tiles) pass — measuring distances
// per country would be forty-six passes over 180,000 tiles.
function claimTerritorialWaters(tiles, owned) {
  const seas = {};
  for (const id of COUNTRY_IDS) seas[id] = [];

  let frontier = [];
  for (const id of COUNTRY_IDS) {
    for (const index of owned[id]) frontier.push(index);
  }

  for (let step = 0; step < TERRITORIAL_RANGE && frontier.length; step++) {
    const next = [];
    for (const index of frontier) {
      const tile = tiles[index];
      const claimant = tile.countryId;
      if (!claimant) continue;
      const { x, y } = tile;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= WORLD_W || ny >= WORLD_H) continue;
        const neighbour = tiles[ny * WORLD_W + nx];
        if (neighbour.terrain !== 'water' || neighbour.countryId) continue;
        neighbour.countryId = claimant;
        seas[claimant].push(neighbour.id);
        next.push(neighbour.id);
      }
    }
    frontier = next;
  }

  return seas;
}

function layOffshoreDeposits(tiles, seed) {
  const seas = {};
  for (const id of COUNTRY_IDS) seas[id] = [];
  for (const tile of tiles) {
    if (tile.terrain === 'water' && tile.countryId) seas[tile.countryId].push(tile.id);
  }

  COUNTRY_IDS.forEach((id, countryIndex) => {
    const sea = seas[id];
    if (!sea.length) return;
    const rand = mulberry32((seed ^ Math.imul(countryIndex + 1, 0x85ebca6b)) >>> 0);
    const pool = shuffle(sea.slice(), rand);
    const budget = Math.floor(pool.length * MAX_WATER_SHARE);
    const waters = COUNTRIES[id].waters ?? {};
    let cursor = 0;
    for (const terrain of WATER_DEPOSIT_ORDER) {
      const wanted = Math.round((waters[terrain] ?? 0) * pool.length);
      for (let n = 0; n < wanted && cursor < budget; n++, cursor++) {
        tiles[pool[cursor]].terrain = terrain;
      }
    }
  });
}

// Every figure a nation reports for the tick just run. `domestic` is what its
// own people paid it, `exports` what foreigners paid it, `imports` what it paid
// abroad. `net` is the bottom line the treasury actually moved by.
function emptyReport() {
  return { wages: 0, tax: 0, domestic: 0, exports: 0, imports: 0, net: 0 };
}

// Forty-six nations, one of which is you. The only field that distinguishes
// yours is `pact`, which records the trade agreements YOU have opened — the
// other forty-five already trade with each other and do not need one.
export function createCountryState(home) {
  const countries = {};
  const open = new Set([home, ...neighboursOf(home).slice(0, STARTING_PACTS)]);
  for (const id of COUNTRY_IDS) {
    countries[id] = {
      id,
      cash: Math.max(TREASURY_FLOOR, Math.round(COUNTRIES[id].demand * TREASURY_PER_DEMAND)),
      solvent: true,
      pact: open.has(id),
      demand: COUNTRIES[id].demand,
      supply: CONFIG.selfSufficiency,
      report: emptyReport(),
    };
  }
  return countries;
}

// Every nation runs its own prices. A commodity is cheap where it is abundant
// and dear where it is wanted, which is what makes *where* you sell a decision
// rather than a formality — and what makes importing worth the freight.
export function createMarkets() {
  const markets = {};
  for (const country of COUNTRY_IDS) {
    const lines = {};
    for (const id of COMMODITY_IDS) {
      lines[id] = { price: COMMODITIES[id].basePrice, soldLastTick: 0, importedLastTick: 0, soldTotal: 0 };
    }
    markets[country] = lines;
  }
  return markets;
}

// What your nation did with each commodity over one tick: how much industry
// made, how much industry burned, how much your people bought, and how much
// crossed a border in either direction. Nothing else in the game answers "where
// is my coal actually going", because the treasury only ever sees money.
//
// `tick` is the tick just run and `total` is the game so far; `openLedger` folds
// one into the other at the top of every tick. Only YOUR nation is tracked —
// forty-six of these would be six hundred numbers a tick in the save file, and
// the other governments are read as rankings, not as accounts.
function emptyLine() {
  return {
    made: 0, used: 0, sold: 0, exported: 0, imported: 0, feedstock: 0,
    revenue: 0, earned: 0, paid: 0,
  };
}

export function createLedger() {
  const tick = {};
  const total = {};
  for (const id of COMMODITY_IDS) { tick[id] = emptyLine(); total[id] = emptyLine(); }
  return { tick, total };
}

// Written from four different systems, so it tolerates a state built without a
// ledger rather than making every caller check.
export function noteLedger(state, commodityId, field, qty) {
  const line = state.ledger?.tick?.[commodityId];
  if (line && qty) line[field] += qty;
}

export function createInitialState(seed = CONFIG.seed, home = DEFAULT_HOME) {
  const exports_ = {};
  const imports_ = {};
  const history = { cash: [], demand: [], supply: [], prices: {} };
  for (const id of COMMODITY_IDS) {
    exports_[id] = true;
    imports_[id] = true;
    history.prices[id] = [];
  }
  return {
    version: SAVE_VERSION,
    seed,
    tick: 0,
    paused: true,
    speed: 1,
    grid: { w: WORLD_W, h: WORLD_H },
    tiles: generateWorld(seed),
    home,
    countries: createCountryState(home),
    buildings: [],
    nextBuildingId: 1,
    markets: createMarkets(),
    exports: exports_,
    imports: imports_,
    flows: [],
    // Your own deals, kept apart from the world list so forty-five governments
    // trading among themselves cannot push yours off the end of it.
    ownFlows: [],
    // Pacts the other nations have offered YOU. They pay for these; you only
    // pay for the ones you go and ask for.
    offers: [],
    ledger: createLedger(),
    warnedHungry: false,
    history,
    alerts: [],
  };
}

// --- nations --------------------------------------------------------------

export function isPlayer(state, countryId) {
  return countryId === state.home;
}

export function ownerById(state, id) {
  return state.countries[id] ?? null;
}

// Every nation, yours first. Systems iterate this so nothing has to know which
// one is being played.
export function allOwners(state) {
  return [state.countries[state.home], ...COUNTRY_IDS.filter((id) => id !== state.home).map((id) => state.countries[id])];
}

export function ownerName(id) {
  return COUNTRIES[id]?.name ?? id;
}

export function ownerColor(id) {
  return COUNTRIES[id]?.color ?? '#888';
}

export function buildingsOf(state, ownerId) {
  return state.buildings.filter((b) => b.owner === ownerId);
}

// What a nation's population wants of a commodity each tick. Price moves
// against this, and unlike every other country figure it CHANGES during a game:
// a well-supplied economy grows and wants more next tick.
export function appetite(state, countryId, commodityId) {
  const country = state.countries[countryId];
  if (!country) return 0;
  return country.demand * COMMODITIES[commodityId].demandShare * CONFIG.demandScale;
}

// You may only trade with a nation you have a pact with. The other forty-five
// are assumed to trade freely among themselves — they have had embassies for a
// century; you are the newcomer buying your way in.
export function canTrade(state, a, b) {
  if (a === b) return false;
  if (isPlayer(state, a)) return Boolean(state.countries[b]?.pact);
  if (isPlayer(state, b)) return Boolean(state.countries[a]?.pact);
  return true;
}

export function hasPact(state, countryId) {
  return Boolean(state.countries[countryId]?.pact);
}

// Whether a commodity leaves or enters the country, per owner. Only you choose;
// every other nation exports its surplus and buys what its people are short of.
export function exportsFrom(state, ownerId, commodityId) {
  return isPlayer(state, ownerId) ? Boolean(state.exports[commodityId]) : true;
}

export function importsTo(state, ownerId, commodityId) {
  return isPlayer(state, ownerId) ? Boolean(state.imports[commodityId]) : true;
}

export function createUiState(home = DEFAULT_HOME) {
  // Zoom and the chosen market live here, not on `state`, because they are view
  // preferences and must not ride along in the save file.
  return {
    tool: null,
    selectedTileId: null,
    hoveredTileId: null,
    zoom: CONFIG.defaultZoom,
    marketCountry: home,
    // Which panel tab is on screen, whether that panel is open at all, and
    // which factory has its details unfolded. All view state, so none of it
    // rides along in the save file.
    tab: 'summary',
    panelOpen: true,
    leftOpen: true,
    openFactoryId: null,
    // Whether the commodity book reads the tick just run or the whole game, and
    // which column the nation table is ranked by. View preferences both.
    goodsView: 'tick',
    rankSort: 'score',
  };
}

export function tileAt(state, x, y) {
  if (x < 0 || y < 0 || x >= state.grid.w || y >= state.grid.h) return null;
  return state.tiles[y * state.grid.w + x];
}

export function buildingById(state, id) {
  return state.buildings.find((b) => b.id === id) ?? null;
}

export function buildingOnTile(state, tile) {
  return tile.buildingId == null ? null : buildingById(state, tile.buildingId);
}

// A government licenses industry on its own soil and nowhere else. That single
// rule is what turns the rest of the world from real estate into a market.
export function isOwnSoil(countryId, ownerId) {
  return Boolean(countryId) && countryId === ownerId;
}

export function countryTiles(state, countryId) {
  return state.tiles.filter((t) => t.countryId === countryId);
}

// A country's deposits are rolled per game, so the panel reports what is
// actually on the map rather than what countries.js asked for.
export function countryDeposits(state, countryId) {
  const counts = {};
  for (const tile of state.tiles) {
    if (tile.countryId !== countryId) continue;
    counts[tile.terrain] = (counts[tile.terrain] ?? 0) + 1;
  }
  return counts;
}

// Stock questions are always asked about one nation: your warehouse total is not
// the world's.
export function totalStock(state, commodityId, ownerId = state.home) {
  let sum = 0;
  for (const b of state.buildings) {
    if (b.owner !== ownerId) continue;
    sum += b.input?.[commodityId] ?? 0;
    sum += b.output?.[commodityId] ?? 0;
    sum += b.store?.[commodityId] ?? 0;
  }
  return sum;
}

export function warehouseStock(state, commodityId, ownerId = state.home) {
  let sum = 0;
  for (const b of state.buildings) {
    if (b.owner === ownerId && b.store) sum += b.store[commodityId] ?? 0;
  }
  return sum;
}

export function warehouseUsed(building) {
  let sum = 0;
  for (const id of COMMODITY_IDS) sum += building.store[id] ?? 0;
  return sum;
}

export function bufferUsed(bag) {
  let sum = 0;
  for (const id of COMMODITY_IDS) sum += bag[id] ?? 0;
  return sum;
}

// Wages are a local cost, and a site's owner is the nation it stands in.
export function siteWages(building) {
  const mul = COUNTRIES[building.owner]?.wageMul ?? 1;
  return Math.round(BUILDINGS[building.type].wages * mul);
}

export function projectedWages(state, ownerId = state.home) {
  return state.buildings.reduce((sum, b) => sum + (b.owner === ownerId ? siteWages(b) : 0), 0);
}

// Alerts carry a wall-clock `at` as well as the tick they happened on, because they
// expire in real time: a message you have already read should clear itself
// whether the game is running at 4x or sitting paused.
export function pushAlert(state, text, kind = 'warn') {
  const last = state.alerts[0];
  const at = Date.now();
  if (last && last.text === text) { last.count++; last.tick = state.tick; last.at = at; return; }
  state.alerts.unshift({ text, kind, tick: state.tick, at, count: 1 });
  state.alerts.length = Math.min(state.alerts.length, CONFIG.maxAlerts);
}

// Drops the alerts that have outlived CONFIG.alertTtlMs and reports whether it
// changed anything, so a caller can skip a render when nothing expired. A repeat
// of an alert refreshes `at`, so a warning that keeps firing keeps its place.
export function pruneAlerts(state, now = Date.now()) {
  const before = state.alerts.length;
  state.alerts = state.alerts.filter((a) => now - (a.at ?? now) < CONFIG.alertTtlMs);
  return state.alerts.length !== before;
}

export function dismissAlert(state, index) {
  if (index < 0 || index >= state.alerts.length) return false;
  state.alerts.splice(index, 1);
  return true;
}

// Every deal on the planet lands in `flows`, which a busy world fills in a tick
// or two. Yours are ALSO kept in a list of their own, because the Trade tab is
// meant to show what you traded — and a shared list showed a handful of your
// deals surrounded by forty-five governments trading with each other.
export function recordFlow(state, flow) {
  state.flows.push(flow);
  if (state.flows.length > CONFIG.maxFlows) state.flows.shift();
  if (flow.from !== state.home && flow.to !== state.home) return;
  state.ownFlows.push(flow);
  if (state.ownFlows.length > CONFIG.maxOwnFlows) state.ownFlows.shift();
}

// Your deals, newest first — what every trade panel in the UI reads.
export function ownFlows(state) {
  return state.ownFlows ?? [];
}

// Tiles are deliberately NOT saved. At 180,000 of them the JSON runs to tens of
// megabytes and blows the localStorage quota, and they are entirely redundant:
// geography is fixed data and geology is a pure function of `seed`. The only
// dynamic thing on a tile is `buildingId`, and every building already records
// its own `tileId`, so the link is rebuilt on load.
// Every commodity bag carries a key per commodity, and quantities are fractional
// once spoilage and part-filled orders touch them — so a bag serialises as
// twenty-one entries, most of them zero, several of them seventeen significant
// digits long. Compacting them is worth roughly ten times the save size at a
// thousand sites.
//
// `packBag` is only ever applied on the way out; `rehydrate` restores the full
// bag, because the systems subtract from these keys in place and a missing one
// would quietly produce NaN rather than an error.
function packBag(bag) {
  if (!bag) return bag;
  const out = {};
  for (const id of COMMODITY_IDS) {
    const qty = bag[id] ?? 0;
    if (qty > 0) out[id] = Math.round(qty * 100) / 100;
  }
  return out;
}

function unpackBag(bag) {
  if (!bag) return bag;
  const out = {};
  for (const id of COMMODITY_IDS) out[id] = bag[id] ?? 0;
  return out;
}

// The ledger accumulates fractional quantities and prices for the whole game,
// so every one of its figures is a full-precision float. Two decimals is finer
// than any panel shows and keeps a long game's save from doubling.
function packLedger(ledger) {
  if (!ledger) return ledger;
  const round = (book) => Object.fromEntries(Object.entries(book).map(([id, line]) => [
    id,
    Object.fromEntries(Object.entries(line).map(([key, value]) => [key, Math.round(value * 100) / 100])),
  ]));
  return { tick: round(ledger.tick), total: round(ledger.total) };
}

export function packState(state) {
  const { tiles, ...rest } = state;
  return {
    ...rest,
    ledger: packLedger(state.ledger),
    buildings: state.buildings.map((b) => ({
      ...b,
      // Uptime is an exponential average, so it is a full-precision float on
      // every site. Three decimals is finer than the panel can show.
      uptime: Math.round((b.uptime ?? 0) * 1000) / 1000,
      input: packBag(b.input),
      output: packBag(b.output),
      store: packBag(b.store),
    })),
  };
}

export function saveState(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(packState(state)));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

export function rehydrate(saved) {
  const state = { ...saved, tiles: generateWorld(saved.seed) };
  state.buildings = state.buildings.map((b) => ({
    ...b,
    input: unpackBag(b.input),
    output: unpackBag(b.output),
    store: unpackBag(b.store),
  }));
  for (const building of state.buildings) {
    const tile = state.tiles[building.tileId];
    if (tile) tile.buildingId = building.id;
  }
  return state;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== SAVE_VERSION) return null;
    return rehydrate(parsed);
  } catch {
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
