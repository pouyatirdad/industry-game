import { CONFIG } from './config.js';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities.js';
import { BUILDINGS } from '../data/buildings.js';
import { COUNTRIES, COUNTRY_IDS, DEFAULT_HOME, TREASURY_PER_DEMAND, TREASURY_FLOOR } from '../data/countries.js';
import { WORLD_COUNTRY_ROWS, WORLD_W, WORLD_H, AREA_SCALE } from '../data/world.js';
import { WORLD_COUNTRY_INFO } from '../data/worldCountries.js';
import { STARTING_TECHS } from '../data/technology.js';

const SAVE_KEY = 'industry-game.save.v9';
const SAVE_VERSION = 10;

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
  'uraniumore', 'lithiumflat', 'rareearth',
  'oilfield', 'gasfield', 'copperbelt', 'bauxite', 'hills', 'coalfield',
  'forest', 'farmland', 'quarry', 'desert',
];

// Offshore deposits, laid into a country's territorial waters. Authored as a
// FRACTION of that country's sea rather than a tile count, so they need no
// scaling when the grid grows.
const WATER_DEPOSIT_ORDER = ['offshoreOil', 'offshoreGas', 'fishery'];

// How far a country's territorial waters reach from its coast, in TILES — so it
// scales with the grid rather than with the planet. Ten tiles at a quarter of a
// degree is about two and a half degrees of sea: a continental shelf rather
// than a twelve-mile limit, which is what makes an offshore rig a decision, and
// narrow enough that the sea still reads as sea.
const TERRITORIAL_RANGE = 10;

// Never let a country's whole sea become deposits — open water has to remain.
const MAX_WATER_SHARE = 0.7;

// Every terrain that is a resource rather than ground or open sea. Used by tests
// and the UI to tell a deposit from empty space without restating the list.
export const DEPOSIT_TERRAINS = [...DEPOSIT_ORDER, ...WATER_DEPOSIT_ORDER];
export const WATER_TERRAINS = WATER_DEPOSIT_ORDER;

// A country whose every tile is a mine can extract but never manufacture, which
// is a dead end rather than a hard choice. This reserves flat ground.
const MAX_DEPOSIT_SHARE = 0.68;
// A microstate the raster cannot see still has to be visible and buildable, and
// it has to stay the SIZE it was when the grid was coarser — this is nine cells
// of the old half-degree grid, which is the smallest blob that reads as a
// country and still has room for its own deposits.
const MIN_VISIBLE_LAND_CELLS = 36;

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
    const row = WORLD_COUNTRY_ROWS[y];
    for (let x = 0; x < WORLD_W; x++) {
      const countryId = row[x] && COUNTRIES[row[x]] ? row[x] : null;
      const index = y * WORLD_W + x;
      tiles.push({
        id: index,
        x,
        y,
        terrain: countryId ? 'plain' : 'water',
        countryId,
        buildingId: null,
      });
      if (countryId) owned[countryId].push(index);
    }
  }

  for (const info of WORLD_COUNTRY_INFO) {
    if (!COUNTRIES[info.id] || owned[info.id]?.length) continue;
    const x = Math.max(0, Math.min(WORLD_W - 1, Math.floor((info.centre.lon + 180) * WORLD_W / 360)));
    const y = Math.max(0, Math.min(WORLD_H - 1, Math.floor((90 - info.centre.lat) * WORLD_H / 180)));
    const index = nearestOpenCell(tiles, x, y);
    const old = tiles[index].countryId;
    if (old && owned[old]) owned[old] = owned[old].filter((id) => id !== index);
    tiles[index].countryId = info.id;
    tiles[index].terrain = 'plain';
    owned[info.id].push(index);
  }
  ensureVisibleCountries(tiles, owned);

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
    const wanted = {};
    for (const terrain of DEPOSIT_ORDER) {
      // Authored against a 360x180 grid, so scaled to whatever grid we run.
      wanted[terrain] = Math.round((COUNTRIES[id].deposits[terrain] ?? 0) * AREA_SCALE);
    }
    layDeposits(tiles, pool, budget, DEPOSIT_ORDER, wanted, id, rand);
  });

  layOffshoreDeposits(tiles, seed);
  return tiles;
}

function ensureVisibleCountries(tiles, owned) {
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const info of WORLD_COUNTRY_INFO) {
      if (!COUNTRIES[info.id] || (owned[info.id]?.length ?? 0) >= MIN_VISIBLE_LAND_CELLS) continue;
      const cx = Math.max(0, Math.min(WORLD_W - 1, Math.floor((info.centre.lon + 180) * WORLD_W / 360)));
      const cy = Math.max(0, Math.min(WORLD_H - 1, Math.floor((90 - info.centre.lat) * WORLD_H / 180)));
      const candidates = nearestCells(cx, cy);
      for (const index of candidates) {
        if (owned[info.id].length >= MIN_VISIBLE_LAND_CELLS) break;
        if (claimLandCell(tiles, owned, index, info.id)) changed = true;
      }
    }
    if (!changed) return;
  }
}

function nearestCells(x, y) {
  const cells = [];
  for (let radius = 0; radius < 24; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= WORLD_W || ny >= WORLD_H) continue;
        cells.push(ny * WORLD_W + nx);
      }
    }
  }
  return cells;
}

function claimLandCell(tiles, owned, index, countryId) {
  const tile = tiles[index];
  if (tile.countryId === countryId) return false;
  const old = tile.countryId;
  if (old && owned[old] && owned[old].length <= MIN_VISIBLE_LAND_CELLS) return false;
  if (old && owned[old]) owned[old] = owned[old].filter((id) => id !== index);
  tile.countryId = countryId;
  tile.terrain = 'plain';
  tile.buildingId = null;
  owned[countryId].push(index);
  return true;
}

function nearestOpenCell(tiles, x, y) {
  const first = y * WORLD_W + x;
  if (!tiles[first].countryId) return first;
  for (let radius = 1; radius < 16; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= WORLD_W || ny >= WORLD_H) continue;
        const index = ny * WORLD_W + nx;
        if (!tiles[index].countryId) return index;
      }
    }
  }
  return first;
}

// Ocean within TERRITORIAL_RANGE of a coast belongs to the nearest country. A
// single multi-source breadth-first sweep out from every land tile at once gives
// each water tile its nearest owner in one O(tiles) pass — measuring distances
// per country would be two hundred and fifty-eight passes over a million tiles.
//
// Each claimed tile REMEMBERS the coast it was claimed from, and the range is
// measured against that rather than counted in steps. Counting steps measures
// Manhattan distance, which drew a perfect diamond of sea around every island in
// the Pacific — an artifact you cannot un-see once you have seen it.
function claimTerritorialWaters(tiles, owned) {
  const seas = {};
  for (const id of COUNTRY_IDS) seas[id] = [];

  const fromX = new Int16Array(tiles.length);
  const fromY = new Int16Array(tiles.length);
  let frontier = [];
  for (const id of COUNTRY_IDS) {
    for (const index of owned[id]) {
      frontier.push(index);
      fromX[index] = tiles[index].x;
      fromY[index] = tiles[index].y;
    }
  }

  const reach = TERRITORIAL_RANGE * TERRITORIAL_RANGE;
  while (frontier.length) {
    const next = [];
    for (const index of frontier) {
      const tile = tiles[index];
      const claimant = tile.countryId;
      if (!claimant) continue;
      const { x, y } = tile;
      const ox = fromX[index];
      const oy = fromY[index];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= WORLD_W || ny >= WORLD_H) continue;
        if ((nx - ox) ** 2 + (ny - oy) ** 2 > reach) continue;
        const neighbour = tiles[ny * WORLD_W + nx];
        if (neighbour.terrain !== 'water' || neighbour.countryId) continue;
        neighbour.countryId = claimant;
        fromX[neighbour.id] = ox;
        fromY[neighbour.id] = oy;
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
    const wanted = {};
    for (const terrain of WATER_DEPOSIT_ORDER) {
      wanted[terrain] = Math.round((waters[terrain] ?? 0) * pool.length);
    }
    layDeposits(tiles, pool, budget, WATER_DEPOSIT_ORDER, wanted, id, rand);
  });
}

// Deposits are laid in PATCHES, not scattered a tile at a time.
//
// This is a map, and on a map a coalfield is a coalfield: one field of a dozen
// tiles reads as a place, and a dozen single tiles sprinkled across a country
// reads as television static. Scattering was invisible when a tile was half a
// degree and there were four of them; at a quarter of a degree there are
// sixteen, and the whole planet turned to dither.
//
// The COUNT is unchanged — the same number of tiles becomes the same terrain,
// drawn from the same shuffled pool in the same order — so nothing about
// balance, the deposit budget or the tests moves. Only where they sit does.
const PATCH_TILES = 22;

function layDeposits(tiles, pool, budget, order, wanted, countryId, rand) {
  const taken = new Uint8Array(pool.length);
  const byIndex = new Map();
  pool.forEach((index, at) => byIndex.set(index, at));

  let spent = 0;
  let cursor = 0;
  for (const terrain of order) {
    let left = wanted[terrain] ?? 0;
    while (left > 0 && spent < budget) {
      // The seed is the next unused tile in the shuffled pool, so which tiles a
      // terrain gets is exactly what it was before — they are simply grown into
      // rather than taken one by one.
      while (cursor < pool.length && taken[cursor]) cursor++;
      if (cursor >= pool.length) return;
      const spread = Math.max(4, Math.round(PATCH_TILES * (0.5 + rand())));
      const size = Math.min(left, budget - spent, spread);
      const grown = growPatch(tiles, pool[cursor], size, terrain, byIndex, taken, rand);
      if (!grown) { taken[cursor] = 1; continue; }
      spent += grown;
      left -= grown;
    }
  }
}

// One patch, grown outward from a seed over its own country's tiles.
//
// The frontier is drawn from at RANDOM rather than in order: strict breadth
// first grows a perfect diamond, and a planet covered in identical diamonds
// looks no more like a map than the static did. Picking any waiting tile gives
// the ragged blob a real orefield has.
function growPatch(tiles, seed, size, terrain, byIndex, taken, rand) {
  const seedAt = byIndex.get(seed);
  if (seedAt === undefined || taken[seedAt]) return 0;
  const queue = [seed];
  let placed = 0;
  const queued = new Set([seed]);

  while (queue.length && placed < size) {
    const pick = Math.floor(rand() * queue.length);
    const index = queue[pick];
    queue[pick] = queue[queue.length - 1];
    queue.pop();
    const at = byIndex.get(index);
    if (at === undefined || taken[at]) continue;
    const tile = tiles[index];
    taken[at] = 1;
    tile.terrain = terrain;
    placed++;
    const { x, y } = tile;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= WORLD_W || ny >= WORLD_H) continue;
      const next = ny * WORLD_W + nx;
      if (queued.has(next)) continue;
      const spot = byIndex.get(next);
      if (spot === undefined || taken[spot]) continue;
      queued.add(next);
      queue.push(next);
    }
  }
  return placed;
}

// Every figure a nation reports for the tick just run. `domestic` is what its
// own people paid it, `exports` what foreigners paid it, `imports` what it paid
// abroad. `net` is the bottom line the treasury actually moved by.
function emptyReport() {
  return {
    wages: 0, tax: 0, domestic: 0, exports: 0, imports: 0, net: 0,
    // What the treasury spent on laboratories, and the net of any contract
    // penalties either side paid. `exports` and `imports` above are contract
    // settlements — there is no other way for goods to cross a border.
    research: 0, penalties: 0,
    // What the clearing house took on the tick's settlements, what a loan cost
    // in interest, and what was paid back against the balance.
    fees: 0, interest: 0, repaid: 0,
  };
}

// Forty-six nations, one of which is you. Nothing on this object says which:
// `state.home` is the only thing that does, and every system asks `isPlayer`.
//
// There is no trade permission here any more. Every nation may deal with every
// other, and the thing that decides whether a deal HAPPENS is whether anybody
// posted terms the other side would take — see systems/exchange.js.
export function createCountryState(home) {
  const countries = {};
  for (const id of COUNTRY_IDS) {
    countries[id] = {
      id,
      cash: Math.max(TREASURY_FLOOR, Math.round(COUNTRIES[id].demand * TREASURY_PER_DEMAND)),
      solvent: true,
      demand: COUNTRIES[id].demand,
      // People, and they MOVE during a game like demand does. A nation that is
      // well supplied and comfortably solvent grows, and a bigger population is
      // a bigger market — which is the whole reason prosperity compounds.
      pop: COUNTRIES[id].pop,
      supply: CONFIG.selfSufficiency,
      // What it owes the clearing fund. A government that cannot make payroll
      // borrows rather than closing its industry, and repays out of its taxes.
      debt: 0,
      // What this nation knows how to build. A plain object rather than a Set,
      // because everything on `state` has to survive a JSON round trip.
      //
      // Every nation opens holding EXACTLY the same set (`STARTING_TECHS`), so
      // nobody begins a step ahead of anybody else. Everything past era 1 has to
      // be researched or bought.
      techs: Object.fromEntries(STARTING_TECHS.map((tech) => [tech, true])),
      // Points banked toward `researching`, and the share of the tax base being
      // spent to earn them. The share is a policy, so it is on the country and
      // not on `ui`: the other forty-five have one too.
      research: 0,
      researching: null,
      researchShare: CONFIG.research.share,
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
    // Standing supply contracts, everybody's. A contract is a promise to move a
    // fixed quantity at a fixed price for a fixed term, and it is settled before
    // either side goes to the spot market — see systems/contracts.js.
    contracts: [],
    nextContractId: 1,
    // Contracts and technology licences other governments are offering YOU.
    // Both lapse if you never answer.
    contractOffers: [],
    techOffers: [],
    // Technologies you have turned down, and the tick you did it on, so the
    // same government does not come straight back with the same question.
    techDeclined: {},
    // The global exchange: an open book of asks and bids that anybody may take,
    // and the clearing fund its fee builds up. See systems/exchange.js.
    exchange: { listings: [], nextListingId: 1, fund: 0, lent: 0, fees: 0 },
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

// Every nation may deal with every other. There is no permission to buy and no
// market that is closed to you: what limits a deal is whether anybody has terms
// on the book you would take, and what the freight costs to get it there.
//
// This is still asked through a function rather than inlined, because "may these
// two deal" is a real question the systems ask and the answer could change again.
export function canTrade(state, a, b) {
  return a !== b && Boolean(state.countries[a]) && Boolean(state.countries[b]);
}

// --- technology -----------------------------------------------------------
//
// What a nation knows is a plain object of tech id -> true, so it round-trips
// through the save like everything else on `state`. `techId` may be null, which
// is the answer for the industries every government starts with — asking about
// nothing is always yes, so no caller has to special-case the basics.

export function knowsTech(state, countryId, techId) {
  if (!techId) return true;
  return Boolean(state.countries[countryId]?.techs?.[techId]);
}

// Records a tech as learned however it was come by — researched, licensed, or
// handed over as part of a chain. Clears the research bench when it lands, so a
// nation that buys what it was studying does not pay for it twice.
export function learnTech(state, countryId, techId) {
  const gov = state.countries[countryId];
  if (!gov || !techId) return false;
  if (!gov.techs) gov.techs = {};
  if (gov.techs[techId]) return false;
  gov.techs[techId] = true;
  if (gov.researching === techId) { gov.researching = null; gov.research = 0; }
  return true;
}

export function techsKnown(state, countryId) {
  return state.countries[countryId]?.techs ?? {};
}

export function techCount(state, countryId) {
  return Object.keys(techsKnown(state, countryId)).length;
}

// --- contracts ------------------------------------------------------------

// Every standing contract one nation is a party to, whichever side it is on.
export function contractsOf(state, countryId) {
  return (state.contracts ?? []).filter((c) => c.seller === countryId || c.buyer === countryId);
}

export function contractById(state, id) {
  return (state.contracts ?? []).find((c) => c.id === id) ?? null;
}

// How many ticks a contract still has to run. Zero means it settles for the
// last time this tick.
export function contractLeft(state, contract) {
  return Math.max(0, contract.started + contract.term - state.tick);
}

// --- the exchange ---------------------------------------------------------

// The book, the clearing fund and what is out on loan. Tolerates a state built
// before the exchange existed rather than making every caller check.
export function exchangeOf(state) {
  if (!state.exchange) state.exchange = { listings: [], nextListingId: 1, fund: 0, lent: 0, fees: 0 };
  return state.exchange;
}

export function listingsOf(state, countryId) {
  return exchangeOf(state).listings.filter((l) => l.from === countryId);
}

// How much a nation still owes the fund, and whether it is carrying anything.
export function debtOf(state, countryId) {
  return state.countries[countryId]?.debt ?? 0;
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
    panelOpen: false,
    leftOpen: false,
    openFactoryId: null,
    // Whether the commodity book reads the tick just run or the whole game, and
    // which column the nation table is ranked by. View preferences both.
    goodsView: 'tick',
    rankSort: 'score',
    // The ask or bid you are writing for the open book, before you post it,
    // and whether the book below it is showing everybody's terms or only yours.
    listing: { side: 'sell', commodity: 'coal', qty: 5, price: 0, every: 1, term: 90 },
    bookFilter: 'all',
    // The contract you are drafting. It is view state, not a promise anybody has
    // made yet, so it lives here and never reaches the save file.
    draft: { partner: null, commodity: 'coal', dir: 'buy', qty: 10, every: 1, term: 60 },
    // Which era of the tech tree is unfolded, and whether the map paints
    // national borders. Both view preferences.
    techEra: null,
    borders: true,
    // True while the pointer is over the inbox, which holds the countdown on
    // every offer in it. View state, so it never reaches the save.
    inboxHeld: false,
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

// An offer nobody answered is an offer declined.
//
// Both kinds carry a wall-clock `at` exactly as an alert does, and are swept on
// the same 500ms timer rather than on a tick — so a proposal you have read and
// ignored clears itself whether the game is running at 4x or sitting paused.
// Saying nothing is an answer, and the answer is no.
//
// `hold` is true while the pointer is over the inbox: an offer that vanishes as
// you reach for it is worse than one that lingers, so the countdown stops while
// you are actually looking at it.
export function pruneOffers(state, now = Date.now(), hold = false) {
  if (hold) return false;
  const stamp = (offer) => {
    if (offer.activeAt == null) offer.activeAt = now;
    return offer.activeAt;
  };
  const alive = (offer) => now - stamp(offer) < CONFIG.offerTtlMs;
  const contracts = state.contractOffers ?? [];
  const techs = state.techOffers ?? [];
  const keptContracts = contracts.filter(alive);
  const keptTechs = techs.filter(alive);
  if (keptContracts.length === contracts.length && keptTechs.length === techs.length) return false;

  // A technology you let lapse counts as one you turned down, so the same
  // government does not come straight back with it.
  for (const offer of techs) {
    if (!keptTechs.includes(offer)) declineTech(state, offer.tech);
  }
  state.contractOffers = keptContracts;
  state.techOffers = keptTechs;
  return true;
}

// What you have said no to, and when. Kept on `state` so it rides along in the
// save with everything else, and read by `research.js` before it offers.
export function declineTech(state, techId) {
  if (!state.techDeclined) state.techDeclined = {};
  state.techDeclined[techId] = state.tick;
}

export function techDeclinedRecently(state, techId) {
  const at = state.techDeclined?.[techId];
  return at != null && state.tick - at < CONFIG.offerCooldown;
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
// thirty-four entries, most of them zero, several of them seventeen significant
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
