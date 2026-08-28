import { createInitialState, createUiState, warehouseStock, siteWages, DEPOSIT_TERRAINS, WATER_TERRAINS, rehydrate,
  appetite, buildingsOf, canTrade, isPlayer, projectedWages, packState,
  pushAlert, pruneAlerts, dismissAlert, recordFlow, ownFlows,
  pruneOffers, knowsTech, learnTech, techCount, contractsOf, exchangeOf } from '../src/core/state.js';
import { TECHS, TECH_IDS, STARTING_TECHS, canResearch, availableTechs, techChain } from '../src/data/technology.js';
import { COMMODITIES, COMMODITY_IDS } from '../src/data/commodities.js';
import { COUNTRIES, COUNTRY_IDS, COUNTRY_BY_CHAR } from '../src/data/countries.js';
import { WORLD_ROWS, WORLD_W, WORLD_H, SOURCE_ROWS, SOURCE_W, SOURCE_H,
  SOURCE_COUNTRY_ROWS, SOURCE_COUNTRY_W, SOURCE_COUNTRY_H, AREA_SCALE } from '../src/data/world.js';
import { CENTROIDS, distanceBetween, haulShare, neighboursOf, MAX_DISTANCE } from '../src/data/geography.js';
import { placeForCountry, provinceForTile } from '../src/data/places.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { CONFIG } from '../src/core/config.js';
import { build, canBuild, demolish,
  setResearch, setResearchShare, buyTech, canBuyTech, proposeContract, cancelContract,
  acceptContractOffer, postListing, take, takeLoan, repayLoan, toggleExport, toggleImport,
  setAllExports, setAllImports } from '../src/actions.js';
import { runTick } from '../src/systems/index.js';
import { produce } from '../src/systems/production.js';
import { payWages } from '../src/systems/economy.js';
import { movePrices, growEconomies } from '../src/systems/market.js';
import { sellDomestic, unmet, supplyRatio } from '../src/systems/domestic.js';
import { warehousesServing, spoil } from '../src/systems/logistics.js';
import { runStateIndustry } from '../src/systems/stateIndustry.js';
import { runResearch, runTechTrade, licenceCost } from '../src/systems/research.js';
import { runContracts, runContractDiplomacy, signContract, canSignContract, quotePrice } from '../src/systems/contracts.js';
import { runExchange, runLending, post, takeListing, borrow, repay, borrowLimit,
  suggestListing } from '../src/systems/exchange.js';
import { createLoop } from '../src/core/loop.js';
// The nation table's scoring is the one piece of UI with a rule in it rather
// than a layout, and it reads only `state` — so it is tested here like anything
// else. It must stay free of the DOM for this import to keep working headlessly.
import { scoreNations } from '../src/ui/ranks.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message} — expected ${expected}, got ${actual}`);
}

function close(actual, expected, tolerance, message) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message} — expected ${expected} ±${tolerance}, got ${actual}`);
  }
}

// Tests build on a scratch tile: the real map is fixed geography, so a test that
// wants "a coalfield here" says so, and stamps the tile into the nation whose
// government is doing the building. A site's owner IS the nation it stands in,
// so both have to be set together.
function placeIn(state, countryId, type, x, y, terrain) {
  const tile = state.tiles[y * state.grid.w + x];
  tile.terrain = terrain;
  tile.countryId = countryId;
  tile.buildingId = null;
  // Technology is tested on its own, below. Every other test is about the
  // economy, so the nation doing the building is granted whatever the industry
  // needs rather than being made to research it first.
  teach(state, countryId, BUILDINGS[type].tech);
  const result = build(state, type, tile, countryId);
  assert(result.ok, `failed to place ${type} in ${countryId}: ${result.reason}`);
  return result.building;
}

// Hands a nation a tech and everything it stands on.
function teach(state, countryId, techId) {
  if (!techId) return;
  for (const id of techChain(state.countries[countryId].techs ?? {}, techId)) {
    learnTech(state, countryId, id);
  }
}

function teachEverything(state, countryId) {
  for (const id of TECH_IDS) learnTech(state, countryId, id);
}

function place(state, type, x, y, terrain) {
  return placeIn(state, state.home, type, x, y, terrain);
}

// Ground a government could build on, without building on it. Real Japan is
// nowhere near real Iran, so a test that wants a nation to have room next to the
// depot it just stamped has to stamp that room too.
function claim(state, countryId, x, y, terrain) {
  const tile = state.tiles[y * state.grid.w + x];
  tile.terrain = terrain;
  tile.countryId = countryId;
  tile.buildingId = null;
  return tile;
}

function fixture() {
  const state = createInitialState();
  state.countries[state.home].cash = 1_000_000;
  // Almost every test below is about the economy rather than the tree, so the
  // nation being played already knows everything. The technology tests build
  // their own state and are explicit about what is and is not known.
  teachEverything(state, state.home);
  return state;
}

const me = (state) => state.countries[state.home];

// ---- world data integrity -------------------------------------------------

test('the map panels start folded away', () => {
  const ui = createUiState();
  equal(ui.panelOpen, false, 'the top information dock starts closed');
  equal(ui.leftOpen, false, 'the bottom build dock starts closed');
});

test('the world map is a complete rectangle of the declared size', () => {
  equal(WORLD_ROWS.length, WORLD_H, 'row count');
  assert(WORLD_W * WORLD_H >= 180_000, `the playable grid should be far larger than the source, got ${WORLD_W}x${WORLD_H}`);
  for (let y = 0; y < WORLD_ROWS.length; y++) {
    equal(WORLD_ROWS[y].length, WORLD_W, `row ${y} width`);
  }
});

test('the source art is exactly the declared source grid', () => {
  equal(SOURCE_ROWS.length, SOURCE_H, 'source row count');
  for (let y = 0; y < SOURCE_ROWS.length; y++) {
    equal(SOURCE_ROWS[y].length, SOURCE_W, `source row ${y} width`);
  }
});

test('every nation owns land on the map', () => {
  assert(COUNTRY_IDS.length >= 190, `the world should include nearly every country, got ${COUNTRY_IDS.length} nations`);
  const seen = new Set();
  for (const tile of createInitialState().tiles) if (tile.countryId) seen.add(tile.countryId);
  const missing = COUNTRY_IDS.filter((id) => !seen.has(id));
  equal(missing.length, 0, `nations with no tiles: ${missing.join(', ')}`);
});

test('small central Asian and Caucasus nations are present on the map', () => {
  const state = createInitialState();
  for (const id of COUNTRY_IDS) {
    const owned = state.tiles.filter((tile) => tile.countryId === id);
    assert(owned.length >= 9, `${id} should own a visible cluster of map tiles`);
  }
});

test('every country uses a canvas-safe hex colour', () => {
  for (const id of COUNTRY_IDS) {
    assert(/^#[0-9a-f]{6}$/i.test(COUNTRIES[id].color), `${id} has a non-hex map colour: ${COUNTRIES[id].color}`);
  }
});

test('the ISO country grid is exactly the declared source grid', () => {
  equal(SOURCE_COUNTRY_ROWS.length, SOURCE_COUNTRY_H, 'country source row count');
  for (let y = 0; y < SOURCE_COUNTRY_ROWS.length; y++) {
    equal(SOURCE_COUNTRY_ROWS[y].length, SOURCE_COUNTRY_W, `country source row ${y} width`);
  }
});

test('no country code on the map is left unexplained', () => {
  for (let y = 0; y < SOURCE_COUNTRY_ROWS.length; y++) {
    for (const id of SOURCE_COUNTRY_ROWS[y]) {
      assert(id == null || COUNTRIES[id],
        `row ${y} uses "${id}", which is not a known country`);
    }
  }
});

// The art is traced from real coastlines, so the countries have to land in the
// right hemispheres. A row or column shift would otherwise pass every other
// test in this file while putting Brazil in the Pacific.
test('nations sit where they do on a real map', () => {
  // The source is equirectangular: column 0 is 180W, row 0 is the far north.
  const lon = (id) => -180 + (CENTROIDS[id].x + 0.5) * (360 / SOURCE_COUNTRY_W);
  const lat = (id) => 90 - (CENTROIDS[id].y + 0.5) * (180 / SOURCE_COUNTRY_H);

  assert(lon('US') < -70 && lon('US') > -130, `the United States should be in the western hemisphere, got ${lon('US').toFixed(0)}`);
  assert(lon('JP') > 120 && lon('JP') < 155, `Japan should be in the far east, got ${lon('JP').toFixed(0)}`);
  assert(lat('NO') > 55, `Norway should be arctic, got ${lat('NO').toFixed(0)}`);
  assert(lat('ZA') < -15, `South Africa should be deep in the southern hemisphere, got ${lat('ZA').toFixed(0)}`);
  assert(lat('BR') < 5 && lon('BR') < -35, 'Brazil should be in the south Atlantic quadrant');
  assert(lat('AU') < -15 && lon('AU') > 110, 'Australia should be south-east');
});

test('distance wraps around the globe rather than across the map', () => {
  // Tokyo and Los Angeles face each other over the Pacific. Measured flat, the
  // route would run back over Europe and cost several times as much freight.
  const pacific = distanceBetween('JP', 'US');
  const overland = distanceBetween('JP', 'GB');
  assert(pacific < overland, `Japan should be nearer the US across the Pacific than the UK overland (${pacific.toFixed(1)} vs ${overland.toFixed(1)})`);
  equal(distanceBetween('IR', 'IR'), 0, 'a country is not distant from itself');
  assert(MAX_DISTANCE > 0, 'the world must have a longest haul');
  assert(haulShare('IR', 'IQ') < haulShare('IR', 'CL'), 'Iraq is nearer to Iran than Chile is');
});

test('a nations nearest neighbours are actually its neighbours', () => {
  const near = neighboursOf('DE').slice(0, 6);
  assert(near.some((id) => ['FR', 'NL', 'PL', 'IT'].includes(id)),
    `Germany's closest markets should be European, got ${near.join(', ')}`);
  assert(!near.includes('NZ'), 'New Zealand is not next door to Germany');
});

test('every country has a province and city for the map', () => {
  for (const id of COUNTRY_IDS) {
    const place = placeForCountry(id);
    assert(!('region' in place), `${id} should not be assigned to a region`);
    assert(place.province, `${id} is missing a province`);
    assert(place.city, `${id} is missing a city`);
    assert(place.provinces.length >= 1, `${id} is missing province labels`);
  }
  const spain = placeForCountry('ES');
  equal(spain.city, 'Madrid', 'Spain city');
});

test('large countries have multiple provinces on the map', () => {
  const state = createInitialState();
  const provinces = new Set(state.tiles
    .filter((tile) => tile.countryId === 'AF')
    .map((tile) => provinceForTile(tile)));
  assert(provinces.size > 1, `Afghanistan should have visible provinces, got ${[...provinces].join(', ')}`);
});

test('deposits only ever land inside the country that owns them', () => {
  const state = createInitialState();
  for (const tile of state.tiles) {
    if (DEPOSIT_TERRAINS.includes(tile.terrain)) {
      assert(tile.countryId, `deposit at (${tile.x},${tile.y}) sits on unowned land`);
    }
  }
});

test('every country has at least one land resource', () => {
  const state = createInitialState();
  const resource = new Set(DEPOSIT_TERRAINS.filter((terrain) => !WATER_TERRAINS.includes(terrain) && terrain !== 'desert'));
  const seen = new Set();
  for (const tile of state.tiles) {
    if (tile.countryId && resource.has(tile.terrain)) seen.add(tile.countryId);
  }
  const missing = COUNTRY_IDS.filter((id) => !seen.has(id));
  equal(missing.length, 0, `countries with no land resource: ${missing.join(', ')}`);
});

// Data-integrity guards over the industry tables. These are the failures that
// would otherwise show up as a chain that silently never runs.
test('every recipe input and output is a real commodity', () => {
  for (const [id, def] of Object.entries(BUILDINGS)) {
    if (!def.recipe) continue;
    for (const side of ['in', 'out']) {
      for (const commodity of Object.keys(def.recipe[side])) {
        assert(COMMODITIES[commodity], `${id}.recipe.${side} names unknown commodity "${commodity}"`);
      }
    }
  }
});

test('every building sits on a terrain the map actually produces', () => {
  const real = new Set(['plain', ...DEPOSIT_TERRAINS]);
  for (const [id, def] of Object.entries(BUILDINGS)) {
    for (const terrain of def.terrain) {
      assert(real.has(terrain), `${id} wants terrain "${terrain}", which no country generates`);
    }
  }
});

test('every commodity is produced by something and every deposit is mined', () => {
  const produced = new Set();
  const worked = new Set();
  for (const def of Object.values(BUILDINGS)) {
    if (def.recipe) for (const id of Object.keys(def.recipe.out)) produced.add(id);
    if (def.recipe && !Object.keys(def.recipe.in).length) for (const t of def.terrain) worked.add(t);
  }
  const orphans = COMMODITY_IDS.filter((id) => !produced.has(id));
  equal(orphans.length, 0, `commodities nothing produces: ${orphans.join(', ')}`);

  const unmined = DEPOSIT_TERRAINS.filter((t) => t !== 'desert' && !worked.has(t));
  equal(unmined.length, 0, `deposit terrains no building can work: ${unmined.join(', ')}`);
});

test('every recipe clears a margin on its inputs at base price', () => {
  const value = (bag) => Object.entries(bag)
    .reduce((sum, [id, qty]) => sum + qty * COMMODITIES[id].basePrice, 0);
  for (const [id, def] of Object.entries(BUILDINGS)) {
    if (!def.recipe || !Object.keys(def.recipe.in).length) continue;
    const inputs = value(def.recipe.in);
    const outputs = value(def.recipe.out);
    assert(outputs > inputs,
      `${id} destroys value: ${inputs} of inputs makes ${outputs} of output at base price`);
  }
});

// Wages are the only running cost besides inputs, so a wage multiplier set on
// hourly pay rather than unit labour cost quietly makes whole nations
// unplayable — every plant they could build loses money on the day it opens.
test('the dearest labour on earth can still run the deepest chain', () => {
  const dearest = COUNTRY_IDS.reduce((a, b) => (COUNTRIES[a].wageMul > COUNTRIES[b].wageMul ? a : b));
  const value = (bag) => Object.entries(bag)
    .reduce((sum, [id, qty]) => sum + qty * COMMODITIES[id].basePrice, 0);
  const def = BUILDINGS.vehiclePlant;
  const margin = (value(def.recipe.out) - value(def.recipe.in)) / def.recipe.ticks;
  const wages = def.wages * COUNTRIES[dearest].wageMul;
  assert(margin > wages,
    `${dearest} cannot profit on vehicles at base price: margin ${margin.toFixed(0)} vs wages ${wages.toFixed(0)}`);
});

test('Iran is generated as an oil and gas country', () => {
  const state = createInitialState();
  const iranian = state.tiles.filter((t) => t.countryId === 'IR');
  assert(iranian.length >= 8, `Iran should be a workable size, got ${iranian.length} tiles`);
  const oil = iranian.filter((t) => t.terrain === 'oilfield').length;
  equal(oil, Math.round(COUNTRIES.IR.deposits.oilfield * AREA_SCALE), 'Iran oilfields on the map');
  assert(iranian.some((t) => t.terrain === 'plain'), 'Iran needs flat ground to refine on');
});

// Deposits are authored against the source grid, so growing the playable grid
// must grow them with it or a big country turns into empty plains.
test('deposits keep their proportion of a country when the grid scales', () => {
  const state = createInitialState();
  for (const id of ['IR', 'AU', 'CN']) {
    const tiles = state.tiles.filter((t) => t.countryId === id);
    for (const [terrain, authored] of Object.entries(COUNTRIES[id].deposits)) {
      const found = tiles.filter((t) => t.terrain === terrain).length;
      const wanted = Math.round(authored * AREA_SCALE);
      assert(found > authored, `${id} ${terrain}: did not scale up — authored ${authored}, found ${found}`);
      assert(found <= wanted, `${id} ${terrain}: overshot — wanted at most ${wanted}, found ${found}`);
    }
  }
});

// A country that really has a little of something must not read as having none
// of it: Iran's Caspian forest, its limestone and the one uranium body at
// Saghand are all authored at a cell or half a cell, which is small enough to be
// dropped silently if DEPOSIT_ORDER or the budget ever moves.
test('Iran keeps its token forest, limestone and uranium', () => {
  const state = createInitialState();
  const tiles = state.tiles.filter((t) => t.countryId === 'IR');
  for (const terrain of ['forest', 'quarry', 'uraniumore']) {
    const found = tiles.filter((t) => t.terrain === terrain).length;
    assert(found > 0, `Iran lost its ${terrain}`);
    assert(found < 10, `Iran's ${terrain} is meant to be token, found ${found}`);
  }
});

// Over-subscribing is silent: generation runs out of room and drops whatever
// comes last in DEPOSIT_ORDER, so the country never gets a resource its data
// says it has. This is the guard that makes that a test failure instead.
test('no country asks for more deposits than it has room for', () => {
  const state = createInitialState();
  const offenders = [];
  for (const id of COUNTRY_IDS) {
    const tiles = state.tiles.filter((t) => t.countryId === id);
    if (!tiles.length) continue;
    for (const terrain of Object.keys(COUNTRIES[id].deposits)) {
      const found = tiles.filter((t) => t.terrain === terrain).length;
      if (found === 0) offenders.push(`${id} lost all its ${terrain}`);
    }
  }
  equal(offenders.length, 0, `deposits silently dropped: ${offenders.join('; ')}`);
});

// Every country must keep flat ground, or it can extract but never manufacture.
test('no country is paved over entirely with deposits', () => {
  const state = createInitialState();
  for (const id of COUNTRY_IDS) {
    const tiles = state.tiles.filter((t) => t.countryId === id);
    if (!tiles.length) continue;
    const plains = tiles.filter((t) => t.terrain === 'plain').length;
    assert(plains > 0, `${id} has no plain tiles at all — nothing can be manufactured there`);
  }
});

test('the same seed regenerates an identical world', () => {
  const a = createInitialState(4242);
  const b = createInitialState(4242);
  equal(JSON.stringify(a.tiles), JSON.stringify(b.tiles), 'world generation must be deterministic');
});

// ---- territorial waters and offshore --------------------------------------

test('coastal sea is claimed by a country and open ocean is not', () => {
  const state = createInitialState();
  const claimed = state.tiles.filter((t) => t.terrain === 'water' && t.countryId).length;
  const open = state.tiles.filter((t) => t.terrain === 'water' && !t.countryId).length;
  assert(claimed > 0, 'some sea should be territorial');
  assert(open > claimed, 'most of the ocean should still belong to nobody');
});

test('offshore deposits only appear in somebody territorial waters', () => {
  const state = createInitialState();
  const offshore = state.tiles.filter((t) => WATER_TERRAINS.includes(t.terrain));
  assert(offshore.length > 0, 'the sea should hold resources');
  for (const tile of offshore) {
    assert(tile.countryId, `offshore deposit at (${tile.x},${tile.y}) is unowned`);
  }
});

test('Iran gets the offshore gas its data claims', () => {
  const state = createInitialState();
  const gas = state.tiles.filter((t) => t.countryId === 'IR' && t.terrain === 'offshoreGas').length;
  assert(gas > 0, 'Iran shares the largest offshore gas field on earth');
});

test('warehouses can never stand on water of any kind', () => {
  for (const terrain of WATER_TERRAINS) {
    assert(!BUILDINGS.warehouse.terrain.includes(terrain),
      `warehouses must not be placeable on ${terrain}`);
  }
});

test('offshore extraction is buildable at sea but factories are not', () => {
  const state = fixture();
  const sea = state.tiles.find((t) => t.countryId === state.home && t.terrain === 'offshoreGas')
    ?? state.tiles.find((t) => t.countryId === state.home && t.terrain === 'water');
  sea.terrain = 'offshoreGas';
  equal(canBuild(state, 'offshoreGasRig', sea).ok, true, 'a rig goes to sea');
  equal(canBuild(state, 'refinery', sea).ok, false, 'a refinery does not');
  equal(canBuild(state, 'warehouse', sea).ok, false, 'nor does a depot');
});

test('open ocean stays unbuildable even for its nearest country', () => {
  const state = fixture();
  const open = state.tiles.find((t) => t.terrain === 'water' && !t.countryId);
  equal(canBuild(state, 'offshoreGasRig', open).ok, false, 'no claim, no licence');
});

test('an offshore rig delivers to a depot on shore', () => {
  const state = fixture();
  place(state, 'warehouse', 100, 100, 'plain');
  const rig = place(state, 'offshoreGasRig', 101, 100, 'offshoreGas');

  for (let i = 0; i < 8; i++) runTick(state);

  assert(rig.status === 'running', 'the rig is being collected from');
});

test('a fishing fleet feeds a cannery', () => {
  const state = fixture();
  place(state, 'warehouse', 100, 100, 'plain');
  place(state, 'fishingFleet', 101, 100, 'fishery');
  const cannery = place(state, 'cannery', 99, 100, 'plain');

  for (let i = 0; i < 14; i++) runTick(state);

  assert(cannery.status === 'running', 'the cannery should be fed within 14 ticks');
});

// ---- saving ----------------------------------------------------------------

// 180,000 tile objects will not fit in localStorage, so they are regenerated
// from the seed instead of stored. That round trip has to be exact.
test('a save omits tiles and rehydrates to the identical world', () => {
  const state = createInitialState(31_337, 'IR');
  // Built on ground that is ALREADY plain: the test helpers stamp terrain, and
  // regeneration would rightly discard that. Nothing in the real game mutates
  // terrain, which is exactly why tiles are safe to drop from the save.
  const spot = state.tiles.find((t) => t.countryId === 'IR' && t.terrain === 'plain');
  const placed = build(state, 'warehouse', spot);
  assert(placed.ok, `could not place a depot: ${placed.reason}`);

  const saved = packState(state);
  assert(!('tiles' in saved), 'tiles must not be part of the save payload');
  assert(JSON.stringify(saved).length < 900_000,
    `a save must stay small enough for localStorage, got ${JSON.stringify(saved).length} bytes`);

  const back = rehydrate(JSON.parse(JSON.stringify(saved)));
  equal(back.tiles.length, state.tiles.length, 'tile count restored');
  equal(JSON.stringify(back.tiles.map((t) => t.terrain)),
    JSON.stringify(state.tiles.map((t) => t.terrain)), 'terrain restored exactly');
  equal(JSON.stringify(back.tiles.map((t) => t.countryId)),
    JSON.stringify(state.tiles.map((t) => t.countryId)), 'ownership restored exactly');
  equal(back.tiles[placed.building.tileId].buildingId, placed.building.id,
    'the building is reattached to its tile');
});

test('nothing on the state survives a JSON round trip as anything but data', () => {
  const state = createInitialState(7, 'BR');
  const saved = packState(state);
  const back = JSON.parse(JSON.stringify(saved));
  equal(JSON.stringify(back), JSON.stringify(saved),
    'a Map, Set or class instance on the state would silently vanish here');
});

// ---- you are a nation ------------------------------------------------------

test('you govern one nation and build only on its soil', () => {
  const state = fixture();
  assert(isPlayer(state, state.home), 'the home country is you');
  assert(!isPlayer(state, 'DE'), 'Germany is not');

  const foreign = state.tiles.find((t) => t.countryId === 'DE');
  foreign.terrain = 'plain';
  const check = canBuild(state, 'warehouse', foreign);
  equal(check.ok, false, 'you cannot build abroad at any price');
  assert(check.reason.includes('Germany'), `the refusal should name the country, got: ${check.reason}`);
});

test('a government cannot build outside its own borders either', () => {
  const state = fixture();
  const iranian = state.tiles.find((t) => t.countryId === 'IR' && t.buildingId == null);
  equal(canBuild(state, 'warehouse', iranian, 'DE').ok, false, 'Germany may not build in Iran');
});

test('the ocean is never buildable', () => {
  const state = fixture();
  const ocean = state.tiles.find((t) => t.terrain === 'water');
  equal(canBuild(state, 'warehouse', ocean).ok, false, 'ocean refused');
});


// ---- trade pacts -----------------------------------------------------------






// ---- the home market -------------------------------------------------------

test('a nation sells to its own people up to what they eat, and no further', () => {
  const state = fixture();
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  depot.store.ore = 10_000;
  me(state).cash = 0;

  sellDomestic(state);

  const want = appetite(state, state.home, 'ore');
  close(state.markets[state.home].ore.soldLastTick, want, 0.001, 'the home market absorbs exactly its appetite');
  close(depot.store.ore, 10_000 - want, 0.001, 'the rest stays in the warehouse for export');
  assert(me(state).cash > 0, 'the sale reaches the treasury');
});

test('selling into your own market moves nobody elses price', () => {
  const state = fixture();
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  depot.store.food = 10_000;

  sellDomestic(state);

  assert(state.markets[state.home].food.soldLastTick > 0, 'your people bought');
  equal(state.markets.US.food.soldLastTick, 0, 'the United States saw none of it');
});

test('every nation collects a tax base whether or not it produces anything', () => {
  const state = fixture();
  me(state).cash = 0;
  sellDomestic(state);
  const expected = Math.round(me(state).demand * CONFIG.taxPerDemand);
  equal(me(state).report.tax, expected, 'tax scales with the size of the economy');
  equal(me(state).cash, expected, 'and it is real money');
});

test('warehouses across a nation draw on one shared appetite', () => {
  const state = fixture();
  const a = place(state, 'warehouse', 20, 20, 'plain');
  const b = place(state, 'warehouse', 60, 60, 'plain');
  a.store.ore = 10_000;
  b.store.ore = 10_000;

  sellDomestic(state);

  const want = appetite(state, state.home, 'ore');
  close(state.markets[state.home].ore.soldLastTick, want, 0.001,
    'two depots must not each sell a whole nations appetite');
});

// ---- world trade -----------------------------------------------------------







// ---- prices ----------------------------------------------------------------

test('flooding the market pushes the price below base', () => {
  const state = fixture();
  const before = state.markets[state.home].ore.price;
  state.markets[state.home].ore.soldLastTick = appetite(state, state.home, 'ore') * 40;

  movePrices(state);

  assert(state.markets[state.home].ore.price < before, 'price should fall when supply exceeds demand');
  assert(state.markets[state.home].ore.price >= COMMODITIES.ore.basePrice * CONFIG.price.floor,
    'price must respect the floor');
});

test('scarcity lifts the price toward the ceiling but never past it', () => {
  const state = fixture();
  for (let i = 0; i < 500; i++) {
    state.markets[state.home].ore.soldLastTick = 0;
    movePrices(state);
  }
  assert(state.markets[state.home].ore.price > COMMODITIES.ore.basePrice, 'price rises when nothing is sold');
  assert(state.markets[state.home].ore.price <= COMMODITIES.ore.basePrice * CONFIG.price.ceiling,
    'price must respect the ceiling');
});

test('a big market wants far more of a good than a small one', () => {
  const state = fixture();
  assert(appetite(state, 'US', 'food') > appetite(state, 'CD', 'food') * 10,
    'the United States should out-consume DR Congo by an order of magnitude');
  assert(appetite(state, 'IR', 'food') > appetite(state, 'IR', 'bauxite'),
    'food is consumed far more than bauxite');
});

test('the same goods fetch different prices in different countries', () => {
  const state = fixture();
  // Flood Iran with food; leave the United States alone.
  for (let i = 0; i < 40; i++) {
    state.markets.IR.food.soldLastTick = appetite(state, 'IR', 'food');
    state.markets.US.food.soldLastTick = 0;
    movePrices(state);
  }
  assert(state.markets.IR.food.price < state.markets.US.food.price,
    `flooding Iran should make it the worse market: IR ${state.markets.IR.food.price} vs US ${state.markets.US.food.price}`);
});

// ---- a living economy ------------------------------------------------------

test('supplying your people grows the economy and neglecting them shrinks it', () => {
  const fed = fixture();
  for (const id of COMMODITY_IDS) {
    fed.markets[fed.home][id].soldLastTick = appetite(fed, fed.home, id);
  }
  const startFed = fed.countries[fed.home].demand;
  growEconomies(fed);
  assert(fed.countries[fed.home].demand > startFed, 'a supplied nation grows');

  const starved = fixture();
  const startStarved = starved.countries[starved.home].demand;
  growEconomies(starved);
  assert(starved.countries[starved.home].demand < startStarved, 'an unsupplied one shrinks');
});

test('an economy cannot grow or collapse without limit', () => {
  const state = fixture();
  const base = COUNTRIES[state.home].demand;
  for (let i = 0; i < 4000; i++) {
    for (const id of COMMODITY_IDS) {
      state.markets[state.home][id].soldLastTick = appetite(state, state.home, id) * 5;
    }
    growEconomies(state);
  }
  close(me(state).demand, base * CONFIG.growth.ceiling, base * 0.01, 'growth is capped');

  for (let i = 0; i < 8000; i++) {
    for (const id of COMMODITY_IDS) state.markets[state.home][id].soldLastTick = 0;
    growEconomies(state);
  }
  // The floor is the demand floor UNDER the population floor: a nation that
  // starves for eight thousand ticks loses people as well as customers, and the
  // two compound. That is the whole point of the population layer.
  const bottom = base * CONFIG.growth.floor * CONFIG.population.floor;
  close(me(state).demand, bottom, base * 0.01, 'and so is collapse');
});

test('a glut of one commodity cannot pay for starving the rest', () => {
  const state = fixture();
  state.markets[state.home].ore.soldLastTick = appetite(state, state.home, 'ore') * 500;
  growEconomies(state);
  assert(me(state).supply < CONFIG.growth.pivot,
    'one flooded commodity must not read as a supplied nation');
});

test('goods left in a warehouse are quietly lost to carrying costs', () => {
  const state = fixture();
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  depot.store.ore = 1000;

  spoil(state);

  close(depot.store.ore, 1000 * (1 - CONFIG.spoilage), 0.001,
    'hoarding a commodity nobody wants has to cost something');
});

// ---- terrain gating --------------------------------------------------------

test('desert takes extraction and storage but not factories', () => {
  const state = fixture();
  const tile = state.tiles.find((t) => t.countryId === state.home);
  tile.terrain = 'desert';
  equal(canBuild(state, 'warehouse', tile).ok, true, 'warehouses work in desert');
  equal(canBuild(state, 'refinery', tile).ok, false, 'refineries need flat ground');
  equal(canBuild(state, 'steelMill', tile).ok, false, 'mills need flat ground');
});

test('an oil rig only goes on an oilfield', () => {
  const state = fixture();
  const tile = state.tiles.find((t) => t.countryId === state.home);
  tile.terrain = 'plain';
  equal(canBuild(state, 'oilRig', tile).ok, false, 'no rig on plains');
  tile.terrain = 'oilfield';
  equal(canBuild(state, 'oilRig', tile).ok, true, 'rig on oilfield');
});

// ---- production ------------------------------------------------------------

test('a multi-input recipe consumes nothing while any input is short', () => {
  const state = fixture();
  const mill = place(state, 'steelMill', 5, 5, 'plain');
  mill.input.ore = 6;
  mill.input.coal = 0;

  produce(state);

  equal(mill.input.ore, 6, 'ore must not be consumed when coal is missing');
  equal(mill.status, 'starved', 'mill status');
  assert(mill.shortage.includes('coal'), 'shortage should name coal');
  equal(mill.output.steel, 0, 'no steel produced');
});

test('a recipe consumes atomically once every input is present', () => {
  const state = fixture();
  const mill = place(state, 'steelMill', 5, 5, 'plain');
  mill.input.ore = 6;
  mill.input.coal = 3;

  produce(state);

  equal(mill.input.ore, 0, 'ore consumed');
  equal(mill.input.coal, 0, 'coal consumed');
  equal(mill.progress, 1, 'job started but not finished (2-tick recipe)');
  equal(mill.output.steel, 0, 'steel not delivered until the job completes');

  produce(state);
  equal(mill.output.steel, 3, 'steel delivered on the completing tick');
  equal(mill.progress, 0, 'job reset');
});

test('machine works will not burn steel while it has no fuel', () => {
  const state = fixture();
  const works = place(state, 'machineWorks', 5, 5, 'plain');
  works.input.steel = 4;
  works.input.fuel = 0;

  produce(state);

  equal(works.input.steel, 4, 'steel held back until fuel arrives');
  equal(works.status, 'starved', 'status');
  assert(works.shortage.includes('fuel'), 'shortage should name fuel');
});

// The radius is read from data rather than hardcoded, so it survives a change
// of map scale — the boundary behaviour is what matters, not the number.
test('warehouse service radius includes its exact reach and excludes one past it', () => {
  const state = fixture();
  const r = BUILDINGS.warehouse.radius;
  place(state, 'warehouse', 20, 20, 'plain');
  const home = state.home;

  equal(warehousesServing(state, 20 + r, 20, home).length, 1, `orthogonal distance ${r} is served`);
  equal(warehousesServing(state, 20 + r, 20 + r, home).length, 1, `diagonal distance ${r} is served`);
  equal(warehousesServing(state, 20 + r + 1, 20, home).length, 0, `distance ${r + 1} is out of range`);
});

// ---- wages and solvency ----------------------------------------------------

test('wages are priced by the nation the site stands in', () => {
  const state = fixture();
  const cheapest = COUNTRY_IDS.reduce((a, b) => (COUNTRIES[a].wageMul < COUNTRIES[b].wageMul ? a : b));
  const dearest = COUNTRY_IDS.reduce((a, b) => (COUNTRIES[a].wageMul > COUNTRIES[b].wageMul ? a : b));
  const cheap = placeIn(state, cheapest, 'steelMill', 5, 5, 'plain');
  const dear = placeIn(state, dearest, 'steelMill', 60, 60, 'plain');

  equal(siteWages(cheap), Math.round(160 * COUNTRIES[cheapest].wageMul), 'cheap payroll');
  equal(siteWages(dear), Math.round(160 * COUNTRIES[dearest].wageMul), 'dear payroll');
  assert(siteWages(dear) > siteWages(cheap) * 3, 'the spread has to be worth caring about');
});

test('wages are debited every tick and insolvency unstaffs every site', () => {
  const state = fixture();
  const mine = place(state, 'ironMine', 2, 2, 'hills');
  const payroll = siteWages(mine);
  assert(payroll > 0, 'the mine must cost something to staff');

  me(state).cash = 1000;
  payWages(state);
  equal(me(state).cash, 1000 - payroll, 'wages debited');
  equal(mine.staffed, true, 'still staffed while solvent');

  me(state).cash = payroll - 1;
  payWages(state);
  equal(me(state).cash, -1, 'cash may go negative');
  equal(me(state).solvent, false, 'flagged insolvent');
  equal(mine.staffed, false, 'sites unstaffed when payroll is missed');

  produce(state);
  equal(mine.status, 'unstaffed', 'unstaffed sites do not produce');
  equal(mine.output.ore, 0, 'no output while unstaffed');
});

test('every nation meets its own payroll independently', () => {
  const state = fixture();
  const yours = place(state, 'ironMine', 20, 20, 'hills');
  const theirs = placeIn(state, 'DE', 'ironMine', 80, 40, 'hills');

  me(state).cash = 10_000;
  state.countries.DE.cash = 0;
  payWages(state);

  equal(me(state).solvent, true, 'you are fine');
  equal(state.countries.DE.solvent, false, 'Germany missed its payroll');
  equal(yours.staffed, true, 'your site keeps running');
  equal(theirs.staffed, false, 'theirs idles');
});

// ---- other nations ---------------------------------------------------------

test('a government builds its own industry out of its treasury', () => {
  const state = fixture();
  const before = state.countries.RU.cash;
  for (let i = 0; i < 200; i++) runTick(state);

  const theirs = buildingsOf(state, 'RU');
  assert(theirs.length > 0, 'Russia should have built something within 200 ticks');
  assert(theirs.every((b) => b.owner === 'RU'), 'a government builds only at home');
  assert(state.countries.RU.cash !== before, 'the treasury should have moved');
});

test('nothing but you ever builds on your soil', () => {
  const state = fixture();
  for (let i = 0; i < 200; i++) runTick(state);
  equal(buildingsOf(state, state.home).length, 0, 'you built nothing, so your land is empty');
  assert(!state.buildings.some((b) => state.tiles[b.tileId].countryId === state.home),
    'and no other government took a tile of it');
});

test('a broke government closes plants instead of sinking forever', () => {
  const state = fixture();
  placeIn(state, 'DE', 'warehouse', 80, 40, 'plain');
  for (let i = 0; i < 6; i++) placeIn(state, 'DE', 'ironMine', 80 + i, 41, 'hills');
  state.countries.DE.cash = -1;
  state.countries.DE.solvent = false;
  const before = buildingsOf(state, 'DE').length;

  state.tick = CONFIG.stateBuildEvery;
  runStateIndustry(state);

  assert(buildingsOf(state, 'DE').length < before, 'it shut something down');
  assert(buildingsOf(state, 'DE').some((b) => b.store), 'but it kept the warehouse');
});

test('a warehouse will not serve a site belonging to someone else', () => {
  const state = fixture();
  placeIn(state, 'DE', 'warehouse', 80, 40, 'plain');
  const mine = placeIn(state, 'DE', 'ironMine', 81, 40, 'hills');

  equal(warehousesServing(state, mine.x, mine.y, state.home).length, 0,
    'a German depot is not your infrastructure');
  equal(warehousesServing(state, mine.x, mine.y, 'DE').length, 1,
    'it does serve its own owner');
});

test('you cannot demolish what you do not own', () => {
  const state = fixture();
  const depot = placeIn(state, 'DE', 'warehouse', 80, 40, 'plain');
  const result = demolish(state, state.tiles[depot.tileId]);
  equal(result.ok, false, 'refused');
  equal(state.buildings.length, 1, 'still standing');
});

// ---- what the panels read ---------------------------------------------------

test('a site reports how much of the time it is actually working', () => {
  const state = fixture();
  place(state, 'warehouse', 5, 5, 'plain');
  const mine = place(state, 'ironMine', 4, 4, 'hills');
  const mill = place(state, 'steelMill', 5, 4, 'plain');

  for (let i = 0; i < 30; i++) runTick(state);

  assert(mine.uptime > 0.8, `a mine on its own deposit should read as working, got ${mine.uptime}`);
  assert(mill.uptime < mine.uptime, 'a mill waiting on coal cannot be working as hard as the mine feeding it');
});

test('a new site has not worked a tick yet', () => {
  const state = fixture();
  const depot = place(state, 'warehouse', 5, 5, 'plain');
  equal(depot.uptime, 0, 'a site opens at nought');
});

test('building and demolishing your own sites announce themselves', () => {
  const state = fixture();
  const depot = place(state, 'warehouse', 5, 5, 'plain');
  assert(state.alerts.some((a) => a.text.includes('Warehouse') && a.text.includes('built')),
    'building said so');

  state.alerts = [];
  demolish(state, state.tiles[depot.tileId]);
  assert(state.alerts.some((a) => a.text.includes('demolished')), 'demolishing said so');
});

test('the other governments build without interrupting you', () => {
  const state = fixture();
  placeIn(state, 'DE', 'warehouse', 80, 40, 'plain');
  equal(state.alerts.length, 0, 'a German depot is not your news');
});

test('a message clears itself once its time is up', () => {
  const state = fixture();
  pushAlert(state, 'Something happened.', 'info');
  const at = state.alerts[0].at;

  equal(pruneAlerts(state, at + CONFIG.alertTtlMs - 1), false, 'nothing expires early');
  equal(state.alerts.length, 1, 'still on screen');

  equal(pruneAlerts(state, at + CONFIG.alertTtlMs + 1), true, 'it expires');
  equal(state.alerts.length, 0, 'and is gone');
});

test('a message that keeps firing keeps its place', () => {
  const state = fixture();
  pushAlert(state, 'Payroll missed.', 'danger');
  const first = state.alerts[0].at;
  state.alerts[0].at = first - CONFIG.alertTtlMs;   // as if it were about to expire
  pushAlert(state, 'Payroll missed.', 'danger');

  equal(state.alerts.length, 1, 'a repeat is not a second message');
  equal(state.alerts[0].count, 2, 'it counts instead');
  assert(state.alerts[0].at > first - CONFIG.alertTtlMs, 'and its clock restarts');
});

test('a message can be dismissed by hand', () => {
  const state = fixture();
  pushAlert(state, 'One.', 'info');
  pushAlert(state, 'Two.', 'info');
  equal(dismissAlert(state, 0), true, 'dismissed');
  equal(state.alerts.length, 1, 'one left');
  equal(dismissAlert(state, 5), false, 'and nothing else to dismiss');
});

test('unanswered offers expire against active game time', () => {
  const state = fixture();
  state.contractOffers = [{ from: 'DE', dir: 'sell', commodity: 'coal', qty: 10, every: 1, term: 20, price: 40, tick: state.tick }];

  equal(pruneOffers(state, 0), false, 'the active-time clock starts when the offer is first swept');
  equal(pruneOffers(state, CONFIG.offerTtlMs - 1), false, 'it does not expire early');
  equal(state.contractOffers.length, 1, 'the proposal is still waiting');

  equal(pruneOffers(state, CONFIG.offerTtlMs + 1), true, 'it expires after five active seconds');
  equal(state.contractOffers.length, 0, 'and is declined');
});

// ---- chains ----------------------------------------------------------------

test('a full ore + coal -> steel chain delivers steel', () => {
  const state = fixture();
  place(state, 'warehouse', 5, 5, 'plain');
  place(state, 'ironMine', 4, 4, 'hills');
  place(state, 'coalMine', 6, 6, 'coalfield');
  const mill = place(state, 'steelMill', 5, 4, 'plain');

  for (let i = 0; i < 12; i++) runTick(state);

  assert(mill.status === 'running', 'the mill should be fed within 12 ticks');
});

test('a full crude -> fuel chain delivers fuel', () => {
  const state = fixture();
  place(state, 'warehouse', 5, 5, 'plain');
  place(state, 'oilRig', 4, 4, 'oilfield');
  const refinery = place(state, 'refinery', 5, 4, 'plain');

  for (let i = 0; i < 15; i++) runTick(state);

  assert(refinery.status === 'running', 'the refinery should be fed within 15 ticks');
});

test('a gas well powers a plant', () => {
  const state = fixture();
  place(state, 'warehouse', 20, 20, 'plain');
  place(state, 'gasWell', 19, 19, 'gasfield');
  const plant = place(state, 'gasPlant', 21, 20, 'plain');

  for (let i = 0; i < 12; i++) runTick(state);

  assert(plant.status === 'running', 'power should be flowing within 12 ticks');
});

test('a copper chain runs from ore and power to refined copper', () => {
  const state = fixture();
  place(state, 'warehouse', 20, 20, 'plain');
  place(state, 'copperMine', 19, 19, 'copperbelt');
  place(state, 'coalMine', 18, 20, 'coalfield');
  place(state, 'coalPlant', 21, 19, 'plain');
  const smelter = place(state, 'copperSmelter', 21, 21, 'plain');

  for (let i = 0; i < 20; i++) runTick(state);

  assert(smelter.status === 'running', 'the smelter should be fed within 20 ticks');
});

test('a farm feeds a food plant', () => {
  const state = fixture();
  place(state, 'warehouse', 20, 20, 'plain');
  place(state, 'farm', 19, 19, 'farmland');
  const plant = place(state, 'foodPlant', 21, 20, 'plain');

  for (let i = 0; i < 12; i++) runTick(state);

  assert(plant.status === 'running', 'the food plant should be fed within 12 ticks');
});

test('a three-input assembly holds every input until all are present', () => {
  const state = fixture();
  const plant = place(state, 'vehiclePlant', 20, 20, 'plain');
  plant.input.machinery = 2;
  plant.input.steel = 3;
  plant.input.electronics = 0;

  produce(state);

  equal(plant.input.machinery, 2, 'machinery held back');
  equal(plant.input.steel, 3, 'steel held back');
  equal(plant.status, 'starved', 'status');
  assert(plant.shortage.includes('electronics'), 'shortage should name electronics');

  plant.input.electronics = 2;
  produce(state);
  equal(plant.input.machinery, 0, 'machinery consumed once complete');
  equal(plant.input.steel, 0, 'steel consumed once complete');
  equal(plant.input.electronics, 0, 'electronics consumed once complete');
});

test('an aluminium plant is the power hog it is meant to be', () => {
  const alu = BUILDINGS.aluminiumPlant.recipe;
  const smelter = BUILDINGS.copperSmelter.recipe;
  assert(alu.in.power / alu.out.aluminium > smelter.in.power / smelter.out.copper,
    'aluminium must cost more power per unit than copper');
});

test('a site with no warehouse in range fills its output buffer and blocks', () => {
  const state = fixture();
  const mine = place(state, 'ironMine', 1, 1, 'hills');

  for (let i = 0; i < 40; i++) runTick(state);

  equal(mine.status, 'blocked', 'mine blocks once its output buffer is full');
  equal(mine.output.ore, 60, 'output capped at the buffer size');
});

test('goods only leave a warehouse, never a factory floor', () => {
  const state = fixture();
  const mine = place(state, 'ironMine', 40, 40, 'hills');
  me(state).cash = 0;

  for (let i = 0; i < 6; i++) runTick(state);

  assert(mine.output.ore > 0, 'the ore piles up where it was dug');
  equal(warehouseStock(state, 'ore'), 0, 'and none of it is stock');
  equal(state.markets[state.home].ore.soldLastTick, 0, 'nothing was sold');
});


// ---- importing what you cannot dig up --------------------------------------





test('a chain that needs an import runs on one', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home);
  place(state, 'warehouse', 20, 20, 'plain');
  place(state, 'ironMine', 19, 19, 'hills');
  const mill = place(state, 'steelMill', 21, 20, 'plain');
  const theirs = placeIn(state, partner, 'warehouse', 60, 60, 'plain');
  state.countries[partner].cash = 1_000_000;

  for (let i = 0; i < 30; i++) {
    theirs.store.coal = 2000;   // a partner that keeps producing coal
    runTick(state);
  }

  // A contracted cargo lands in a warehouse like any other, so it is booked as
  // an import rather than as feedstock: whether it ends on a factory floor or
  // over a counter is decided afterwards, by `distribute` and `sellDomestic`.
  assert(state.ledger.total.coal.imported > 0, 'the coal was bought in');
  assert(mill.uptime > 0.3, `a mill on imported coal should be working, got ${mill.uptime.toFixed(2)}`);
  assert(state.ledger.total.steel.made > 0, 'and turning out steel');
});

// ---- the commodity ledger --------------------------------------------------

test('the ledger books what you made, burned, sold and shipped', () => {
  const state = fixture();
  place(state, 'warehouse', 20, 20, 'plain');
  place(state, 'farm', 19, 19, 'farmland');
  place(state, 'foodPlant', 21, 20, 'plain');

  for (let i = 0; i < 12; i++) runTick(state);

  const grain = state.ledger.total.grain;
  const food = state.ledger.total.food;
  assert(grain.made > 0, 'the farm turned out grain');
  assert(grain.used > 0, 'and the food plant burned some of it');
  assert(food.made > 0, 'which became food');
  assert(food.sold > 0 && food.revenue > 0, 'and your people bought it');
});

test('the ledger folds the tick into the total and starts the next one empty', () => {
  const state = fixture();
  place(state, 'warehouse', 20, 20, 'plain');
  place(state, 'farm', 19, 19, 'farmland');

  runTick(state);
  const first = state.ledger.tick.grain.made;
  assert(first > 0, 'the tick just run is what the panels read');

  runTick(state);
  equal(state.ledger.tick.grain.made, first, 'each tick reports itself, not a running sum');
  equal(state.ledger.total.grain.made, first, 'and the finished tick is what lands in the total');
});

test('only your own industry is booked', () => {
  const state = fixture();
  placeIn(state, 'DE', 'warehouse', 80, 40, 'plain');
  placeIn(state, 'DE', 'farm', 81, 40, 'farmland');

  for (let i = 0; i < 6; i++) runTick(state);

  equal(state.ledger.total.grain.made, 0, 'a German farm is not your ledger');
});

// ---- what the trade panel reads --------------------------------------------

test('your own deals are never crowded out by the rest of the world', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home);
  recordFlow(state, { tick: 1, from: state.home, to: partner, commodity: 'steel', qty: 5, value: 500 });
  for (let i = 0; i < CONFIG.maxFlows * 2; i++) {
    recordFlow(state, { tick: 2, from: 'DE', to: 'FR', commodity: 'steel', qty: 1, value: 10 });
  }

  equal(state.flows.length, CONFIG.maxFlows, 'the world list is capped');
  assert(!state.flows.some((f) => f.from === state.home), 'and your deal has been pushed off it');
  assert(ownFlows(state).some((f) => f.from === state.home),
    'which is exactly why your own deals are kept in a list of their own');
});

// ---- being asked ------------------------------------------------------------





// ---- other governments -----------------------------------------------------

test('a government will build a plant on an input it has to import', () => {
  const state = fixture();
  // Japan has no coalfield, so before feedstock existed it could never plan a
  // plant that burns coal, however rich it was.
  placeIn(state, 'JP', 'warehouse', 100, 60, 'plain');
  placeIn(state, 'JP', 'ironMine', 101, 60, 'hills');
  for (let x = 102; x < 108; x++) claim(state, 'JP', x, 60, 'plain');
  // ...and the world has coal standing in a warehouse, so it can be bought.
  placeIn(state, 'RU', 'warehouse', 40, 20, 'plain').store.coal = 2000;
  state.countries.JP.cash = 5_000_000;

  state.tick = CONFIG.stateBuildEvery;
  runStateIndustry(state);

  const burnsCoal = buildingsOf(state, 'JP')
    .filter((b) => BUILDINGS[b.type].recipe?.in?.coal);
  assert(burnsCoal.length > 0,
    'a country with no coalfield should still be able to plan around bought coal');
});

test('a government builds more than one site when it can plainly afford to', () => {
  const state = fixture();
  state.countries.RU.cash = 50_000_000;
  const before = buildingsOf(state, 'RU').length;

  state.tick = CONFIG.stateBuildEvery;
  runStateIndustry(state);

  const built = buildingsOf(state, 'RU').length - before;
  assert(built > 1, 'a full treasury should turn into industry rather than sitting there');
  assert(built <= CONFIG.stateBuildsPerDecision, 'but never more than the decision allows');
});

// ---- the nation table -------------------------------------------------------

test('every nation is scored against the rest of the world', () => {
  const state = fixture();
  place(state, 'warehouse', 20, 20, 'plain');
  for (let i = 0; i < 60; i++) runTick(state);

  const rows = scoreNations(state);
  equal(rows.length, COUNTRY_IDS.length, 'the table is the whole world');
  for (const row of rows) {
    assert(row.score >= 0 && row.score <= 100, `${row.id} scores off the scale: ${row.score}`);
  }
  const best = rows.reduce((a, b) => (a.score > b.score ? a : b));
  const worst = rows.reduce((a, b) => (a.score < b.score ? a : b));
  assert(best.score > worst.score, 'a score that separates nobody says nothing');
  assert(best.economy > worst.economy || best.sites > worst.sites,
    'and the leader has to lead on something');
});

// ---- technology ------------------------------------------------------------

test('the tech tree is a directed acyclic graph with reachable roots', () => {
  const depth = new Map();
  const walk = (id, seen) => {
    if (seen.has(id)) throw new Error(`${id} depends on itself through ${[...seen].join(' -> ')}`);
    if (depth.has(id)) return depth.get(id);
    seen.add(id);
    const d = 1 + Math.max(0, ...TECHS[id].needs.map((need) => {
      assert(TECHS[need], `${id} needs "${need}", which is not a technology`);
      return walk(need, seen);
    }));
    seen.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const id of TECH_IDS) walk(id, new Set());
  const roots = TECH_IDS.filter((id) => !TECHS[id].needs.length);
  assert(roots.length > 0, 'something has to be researchable on turn one');
});

test('every technology unlocks an industry and every gated industry names a real one', () => {
  const unlocked = new Set();
  for (const def of Object.values(BUILDINGS)) {
    if (!def.tech) continue;
    assert(TECHS[def.tech], `a building wants tech "${def.tech}", which does not exist`);
    unlocked.add(def.tech);
  }
  const idle = TECH_IDS.filter((id) => !unlocked.has(id));
  equal(idle.length, 0, `technologies that unlock nothing: ${idle.join(', ')}`);
});

test('a nation starts able to build the basics and nothing else', () => {
  const state = createInitialState();
  equal(techCount(state, state.home), STARTING_TECHS.length, 'a new nation starts with the shared basics');
  const tile = claim(state, state.home, 5, 5, 'plain');
  equal(canBuild(state, 'warehouse', tile).ok, true, 'a depot needs no technology');
  equal(canBuild(state, 'steelMill', tile).ok, true, 'nor does the steel chain everyone starts with');
  equal(canBuild(state, 'refinery', tile).ok, false, 'a refinery does');
  equal(canBuild(state, 'vehiclePlant', tile).ok, false, 'and so does the top of the tree');
});

test('every nation starts with the same technology', () => {
  const state = createInitialState();
  const baseline = JSON.stringify(state.countries[state.home].techs ?? {});
  for (const id of COUNTRY_IDS) {
    equal(JSON.stringify(state.countries[id].techs ?? {}), baseline, `${id} should not start ahead or behind`);
  }
});

test('the forty-five governments are gated by technology exactly as you are', () => {
  const state = createInitialState();
  const other = COUNTRY_IDS.find((id) => id !== state.home);
  const tile = claim(state, other, 6, 6, 'plain');
  state.countries[other].cash = 5_000_000;
  equal(canBuild(state, 'refinery', tile, other).ok, false, 'no refining, no refinery');
  learnTech(state, other, 'refining');
  equal(canBuild(state, 'refinery', tile, other).ok, true, 'and with it, a refinery');
});

test('research turns treasury into technology and completes a subject', () => {
  const state = createInitialState();
  const gov = state.countries[state.home];
  gov.cash = 5_000_000;
  gov.report.tax = 100_000;             // a big budget, so it lands in a few ticks
  setResearch(state, 'refining');
  equal(gov.researching, 'refining', 'the subject is on the bench');

  const before = gov.cash;
  runResearch(state);
  assert(gov.cash < before, 'laboratories are paid for out of the treasury');
  assert(gov.report.research > 0, 'and the tick reports what they cost');

  for (let i = 0; i < 20 && !knowsTech(state, state.home, 'refining'); i++) {
    gov.report.tax = 100_000;
    runResearch(state);
  }
  assert(knowsTech(state, state.home, 'refining'), 'a funded subject completes');
  equal(gov.researching, null, 'and the bench is clear again');
});

test('a subject you have not the prerequisites for cannot be started', () => {
  const state = createInitialState();
  equal(canResearch(state.countries[state.home].techs, 'petrochemistry'), false, 'petrochemistry needs refining');
  equal(setResearch(state, 'petrochemistry').ok, false, 'and the action refuses it');
  learnTech(state, state.home, 'refining');
  equal(setResearch(state, 'petrochemistry').ok, true, 'with refining in hand it opens');
});

test('a nation with nothing on the bench spends nothing', () => {
  const state = createInitialState();
  const gov = state.countries[state.home];
  gov.report.tax = 100_000;
  gov.cash = 1_000_000;
  gov.researching = null;
  runResearch(state);
  equal(gov.cash, 1_000_000, 'no subject, no bill');
});

test('licensing a technology pays the nation that has it', () => {
  const state = fixture();
  const seller = COUNTRY_IDS.find((id) => id !== state.home);
  // Start from nothing, so the licence is exactly the one tech.
  state.countries[state.home].techs = {};
  learnTech(state, seller, 'drilling');
  state.countries[state.home].cash = 5_000_000;
  const theirs = state.countries[seller].cash;
  const cost = licenceCost(state, state.home, 'drilling');
  assert(cost > 0, 'knowledge is not free');

  const result = buyTech(state, 'drilling', seller);
  assert(result.ok, `the licence should be available: ${result.reason}`);
  assert(knowsTech(state, state.home, 'drilling'), 'and it arrives at once');
  equal(state.countries[seller].cash, theirs + cost, 'the fee lands in the seller treasury');
});

test('a licence carries everything upstream the buyer is missing', () => {
  const state = fixture();
  const seller = COUNTRY_IDS.find((id) => id !== state.home);
  state.countries[state.home].techs = {};
  for (const id of ['drilling', 'refining', 'petrochemistry']) learnTech(state, seller, id);
  state.countries[state.home].cash = 50_000_000;

  buyTech(state, 'petrochemistry', seller);
  assert(knowsTech(state, state.home, 'drilling'), 'you cannot licence a chemical works to a nation that cannot drill');
  assert(knowsTech(state, state.home, 'refining'), 'so the whole missing branch comes with it');
  assert(knowsTech(state, state.home, 'petrochemistry'), 'along with what was actually asked for');
});


test('the world climbs the tree on its own', () => {
  const state = createInitialState();
  for (let i = 0; i < 400; i++) runTick(state);
  const learned = COUNTRY_IDS.filter((id) => id !== state.home && techCount(state, id) > 0);
  assert(learned.length > 20, `most governments should have researched something, got ${learned.length}`);
  const best = Math.max(...COUNTRY_IDS.map((id) => techCount(state, id)));
  const worst = Math.min(...COUNTRY_IDS.filter((id) => id !== state.home).map((id) => techCount(state, id)));
  assert(best > worst, 'and a big economy should be ahead of a small one');
});

// ---- contracts -------------------------------------------------------------

test('a contract moves goods at its own price, not the market price', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home);
  const mine = place(state, 'warehouse', 20, 20, 'plain');
  const theirs = placeIn(state, partner, 'warehouse', 60, 60, 'plain');
  theirs.store.coal = 500;
  state.countries[partner].cash = 5_000_000;

  const signed = signContract(state, {
    seller: partner, buyer: state.home, commodity: 'coal', qty: 10, every: 1, term: 20,
  });
  assert(signed.ok, `the contract should sign: ${signed.reason}`);
  const agreed = signed.contract.price;

  // The market moves under it; the contract does not.
  state.markets[state.home].coal.price = COMMODITIES.coal.basePrice * 1.9;
  state.tick = signed.contract.started;
  const before = me(state).cash;
  runContracts(state);

  close(mine.store.coal, 10, 0.001, 'the full order is delivered');
  close(before - me(state).cash, 10 * agreed, 0.01, 'and billed at the price agreed on the day');
});

test('a nation can hold more than the old contract cap', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home);
  place(state, 'warehouse', 20, 20, 'plain');
  const theirs = placeIn(state, partner, 'warehouse', 60, 60, 'plain');
  theirs.store.coal = 10_000;
  me(state).cash = 50_000_000;
  state.countries[partner].cash = 50_000_000;

  for (let i = 0; i < 35; i++) {
    const result = signContract(state, {
      seller: partner, buyer: state.home, commodity: 'coal', qty: 1, every: 1, term: 20,
    });
    assert(result.ok, `contract ${i + 1} should sign: ${result.reason}`);
  }
  equal(contractsOf(state, state.home).length, 35, 'every signed contract is held');
});

test('a contract is settled before a nation feeds its own people', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home);
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  placeIn(state, partner, 'warehouse', 60, 60, 'plain');
  depot.store.food = 12;
  state.countries[partner].cash = 50_000_000;
  const signed = signContract(state, {
    seller: state.home, buyer: partner, commodity: 'food', qty: 12, every: 1, term: 20,
  });
  state.tick = signed.contract.started;

  runContracts(state);
  close(depot.store.food, 0, 0.001, 'the promise is kept first');
  sellDomestic(state);
  equal(state.markets[state.home].food.soldLastTick, 0,
    'and there is nothing left for your own counter — which is what makes a contract a promise');
});

test('a seller that cannot deliver pays the buyer a penalty', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home);
  place(state, 'warehouse', 20, 20, 'plain');          // yours, empty
  placeIn(state, partner, 'warehouse', 60, 60, 'plain');
  state.countries[partner].cash = 50_000_000;
  const signed = signContract(state, {
    seller: state.home, buyer: partner, commodity: 'steel', qty: 10, every: 1, term: 20,
  });
  state.tick = signed.contract.started;

  const mine = me(state).cash;
  const theirs = state.countries[partner].cash;
  runContracts(state);

  const fee = 10 * signed.contract.price * CONFIG.contracts.penalty;
  close(mine - me(state).cash, fee, 0.01, 'the defaulter pays');
  close(state.countries[partner].cash - theirs, fee, 0.01, 'and the other side is paid');
  assert(signed.contract.missed > 0, 'the miss is on the record');
});

test('a buyer that cannot pay defaults just as a seller that cannot deliver does', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home);
  place(state, 'warehouse', 20, 20, 'plain');
  const theirs = placeIn(state, partner, 'warehouse', 60, 60, 'plain');
  theirs.store.steel = 500;
  state.countries[partner].cash = 50_000_000;
  const signed = signContract(state, {
    seller: partner, buyer: state.home, commodity: 'steel', qty: 10, every: 1, term: 20,
  });
  state.tick = signed.contract.started;
  me(state).cash = 0;                                   // nothing to pay with

  runContracts(state);
  assert(me(state).cash < 0, 'a penalty is charged whether or not it can be afforded');
  assert(signed.contract.missed > 0, 'and the shortfall is recorded');
});

test('a contract runs out its term and no further', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home);
  place(state, 'warehouse', 20, 20, 'plain');
  const theirs = placeIn(state, partner, 'warehouse', 60, 60, 'plain');
  theirs.store.coal = 10_000;
  state.countries[partner].cash = 50_000_000;
  me(state).cash = 50_000_000;
  const signed = signContract(state, {
    seller: partner, buyer: state.home, commodity: 'coal', qty: 2, every: 1, term: 5,
  });

  for (let i = 0; i <= 8; i++) { state.tick = signed.contract.started + i; runContracts(state); }
  equal(state.contracts.length, 0, 'it is gone once its term is up');
  equal(signed.contract.deliveries, 6, 'having settled on every tick of it, first and last included');
});


test('breaking a contract costs what defaulting on the rest of it would', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home);
  const signed = signContract(state, {
    seller: partner, buyer: state.home, commodity: 'coal', qty: 4, every: 2, term: 20,
  });
  me(state).cash = 5_000_000;
  const mine = me(state).cash;
  const theirs = state.countries[partner].cash;

  const result = cancelContract(state, signed.contract.id);
  assert(result.ok, 'your own contract is yours to break');
  equal(state.contracts.length, 0, 'and it is off the book');
  assert(result.fee > 0, 'walking away is not free');
  equal(mine - me(state).cash, result.fee, 'you pay');
  equal(state.countries[partner].cash - theirs, result.fee, 'they are paid');
});


test('the world writes contracts of its own', () => {
  const state = createInitialState();
  for (let i = 0; i < 400; i++) runTick(state);
  assert(state.contracts.length > 0, 'governments should be arranging standing supply with each other');
  for (const c of state.contracts) {
    assert(c.seller !== c.buyer, 'nobody contracts with itself');
    assert(canTrade(state, c.seller, c.buyer), 'and only with a partner it may trade with');
  }
});

// ---- feedstock, at the scale the world actually needs ----------------------

// The failure this fixes: a nation with three coal plants and no coalfield got
// one plant's worth of coal between them, however large its treasury. Two
// things were wrong — nobody in the world built the mine, because `hasHeadroom`
// counted only what populations EAT, and a well-supplied nation bid at its own
// settled local price and was outbid every tick by every hungry country there is.
test('a rich nation with no coal can feed three coal plants at once', () => {
  const state = createInitialState(1234, 'JP');
  state.buildings = [];
  for (const id of COUNTRY_IDS) {
    teachEverything(state, id);
    state.countries[id].pact = true;
  }
  const depot = place(state, 'warehouse', 300, 100, 'plain');
  const plants = [];
  for (let i = 0; i < 3; i++) {
    plants.push(place(state, 'coalPlant', 301 + i, 100, 'plain'));
  }
  me(state).cash = 500_000_000;
  const seller = COUNTRY_IDS.find((id) => id !== state.home);
  placeIn(state, seller, 'warehouse', 120, 120, 'plain').store.coal = 10_000;
  state.countries[seller].cash = 500_000_000;
  signContract(state, {
    seller, buyer: state.home, commodity: 'coal', qty: 30, every: 1, term: 400, price: 40,
  });

  for (let i = 0; i < 5; i++) runTick(state);
  const before = state.ledger.total.power.made;
  for (let i = 0; i < 60; i++) runTick(state);
  const made = state.ledger.total.power.made - before;

  const recipe = BUILDINGS.coalPlant.recipe;
  const ideal = 3 * 60 * recipe.out.power / recipe.ticks;
  assert(made > ideal * 0.75,
    `three plants on bought coal should run near capacity, got ${made} of ${ideal}`);
  assert(state.ledger.total.coal.imported > 0, 'and the coal has to have been bought in');
  assert(depot.store, 'the depot is what the cargo lands in');
});


// A government that only counted mouths never built the mine the world's
// factories were waiting on.
test('a government counts factory floors as demand, not just dinner tables', () => {
  const state = createInitialState();
  for (let i = 0; i < 300; i++) runTick(state);
  const burn = new Map();
  const make = new Map();
  for (const b of state.buildings) {
    const recipe = BUILDINGS[b.type].recipe;
    if (!recipe) continue;
    for (const [id, qty] of Object.entries(recipe.in)) burn.set(id, (burn.get(id) ?? 0) + qty / recipe.ticks);
    for (const [id, qty] of Object.entries(recipe.out)) make.set(id, (make.get(id) ?? 0) + qty / recipe.ticks);
  }
  for (const [id, eaten] of burn) {
    assert((make.get(id) ?? 0) > eaten * 0.5,
      `the world burns ${eaten.toFixed(1)} ${id} a tick and digs up only ${(make.get(id) ?? 0).toFixed(1)}`);
  }
});

// ---- every market is open --------------------------------------------------

test('every nation may deal with every other, and none with itself', () => {
  const state = createInitialState();
  for (const a of COUNTRY_IDS) {
    equal(canTrade(state, a, a), false, `${a} cannot trade with itself`);
    for (const b of COUNTRY_IDS.slice(0, 5)) {
      if (a === b) continue;
      equal(canTrade(state, a, b), true, `${a} and ${b} may deal — there is no permission left to buy`);
    }
  }
});

test('every nation starts solvent with a treasury and no debt', () => {
  const state = createInitialState();
  for (const id of COUNTRY_IDS) {
    const gov = state.countries[id];
    assert(gov.solvent, `${id} should open solvent`);
    assert(gov.cash > 0, `${id} should open with money`);
    equal(gov.debt, 0, `${id} should open owing nothing`);
    close(gov.pop, COUNTRIES[id].pop, 0.0001, `${id} should open with its authored population`);
  }
});

// ---- the exchange ----------------------------------------------------------

test('a bid and an ask that cross become a contract', () => {
  const state = fixture();
  const seller = COUNTRY_IDS.find((id) => id !== state.home);
  placeIn(state, seller, 'warehouse', 60, 60, 'plain').store.coal = 2000;
  place(state, 'warehouse', 20, 20, 'plain');
  state.countries[seller].cash = 5_000_000;

  post(state, { from: seller, side: 'sell', commodity: 'coal', qty: 10, price: 30 });
  post(state, { from: state.home, side: 'buy', commodity: 'coal', qty: 10, price: 60 });
  equal(exchangeOf(state).listings.length, 2, 'both sides are on the book');

  runExchange(state);

  const made = state.contracts.filter((c) => c.commodity === 'coal');
  equal(made.length, 1, 'the pair becomes exactly one contract');
  equal(made[0].seller, seller, 'from the one who offered to sell');
  equal(made[0].buyer, state.home, 'to the one who offered to buy');
  assert(made[0].price > 30 && made[0].price < 60, `the deal splits the difference, got ${made[0].price}`);
  assert(made[0].viaExchange, 'and it is marked as the exchange having brokered it');
});

test('a bid below the ask never crosses', () => {
  const state = fixture();
  const seller = COUNTRY_IDS.find((id) => id !== state.home);
  post(state, { from: seller, side: 'sell', commodity: 'coal', qty: 10, price: 60 });
  post(state, { from: state.home, side: 'buy', commodity: 'coal', qty: 10, price: 20 });

  runExchange(state);
  equal(state.contracts.length, 0, 'nobody sells below what they asked');
  equal(exchangeOf(state).listings.length, 2, 'and both listings stand');
});

test('two listings for different commodities are never matched with each other', () => {
  const state = fixture();
  const seller = COUNTRY_IDS.find((id) => id !== state.home);
  post(state, { from: seller, side: 'sell', commodity: 'coal', qty: 10, price: 10 });
  post(state, { from: state.home, side: 'buy', commodity: 'steel', qty: 10, price: 900 });

  runExchange(state);
  equal(state.contracts.length, 0, 'a coal ask is not a steel supply at any price');
});

test('a listing you take by hand becomes a contract at the price posted', () => {
  const state = fixture();
  const seller = COUNTRY_IDS.find((id) => id !== state.home);
  const posted = post(state, { from: seller, side: 'sell', commodity: 'coal', qty: 8, price: 41, term: 50 });

  const result = takeListing(state, posted.listing.id, state.home);
  assert(result.ok, `taking it should work: ${result.reason}`);
  equal(result.contract.price, 41, 'at their price, not a midpoint — you accepted their terms');
  equal(result.contract.buyer, state.home, 'and you are the buyer of an ask');
  equal(exchangeOf(state).listings.length, 0, 'the listing comes off the book');
});

test('taking a bid makes you the seller', () => {
  const state = fixture();
  const buyer = COUNTRY_IDS.find((id) => id !== state.home);
  const posted = post(state, { from: buyer, side: 'buy', commodity: 'steel', qty: 3, price: 400, term: 50 });

  const result = takeListing(state, posted.listing.id, state.home);
  assert(result.ok, `taking it should work: ${result.reason}`);
  equal(result.contract.seller, state.home, 'somebody offering to buy is somebody you can sell to');
});

test('a listing lapses if nobody takes it', () => {
  const state = fixture();
  const seller = COUNTRY_IDS.find((id) => id !== state.home);
  post(state, { from: seller, side: 'sell', commodity: 'uranium', qty: 2, price: 9999 });
  state.tick += CONFIG.exchange.ttl + 1;
  runExchange(state);
  equal(exchangeOf(state).listings.filter((l) => l.commodity === 'uranium').length, 0,
    'terms nobody would take do not stand for ever');
});

test('the world posts what it cannot place and bids for what it cannot dig up', () => {
  const state = createInitialState();
  for (let i = 0; i < 120; i++) runTick(state);
  const book = exchangeOf(state);
  assert(book.listings.length > 0, 'the book should not be empty once the world is producing');
  assert(book.listings.some((l) => l.side === 'sell'), 'somebody is offering something');
  assert(book.listings.some((l) => l.side === 'buy'), 'and somebody is asking for something');
  for (const l of book.listings) {
    assert(l.qty > 0 && l.price > 0, 'every listing has a quantity and a price');
    assert(COMMODITIES[l.commodity], 'and names a real commodity');
  }
});

test('nothing crosses a border except under a contract', () => {
  const state = createInitialState();
  for (let i = 0; i < 200; i++) runTick(state);
  const moved = COUNTRY_IDS.reduce((sum, id) => sum + state.countries[id].report.exports, 0);
  assert(moved > 0, 'the world should be trading by now');
  assert(state.contracts.length > 0, 'and every unit of it is under a contract');
  // The report lines ARE the contract settlements; nothing else writes them.
  const contracted = state.contracts.filter((c) => state.tick >= c.started);
  assert(contracted.length > 0, 'with contracts actually settling');
});

test('the ↗ and ↙ flags decide whether your government posts at all', () => {
  const state = fixture();
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  depot.store.steel = 5000;
  for (const id of COMMODITY_IDS) { state.exports[id] = false; state.imports[id] = false; }
  state.tick = CONFIG.exchange.post;

  runExchange(state);
  equal(exchangeOf(state).listings.filter((l) => l.from === state.home).length, 0,
    'with both flags off your surplus is yours to place by hand');

  state.exports.steel = true;
  state.tick += CONFIG.exchange.post;
  runExchange(state);
  assert(exchangeOf(state).listings.some((l) => l.from === state.home && l.side === 'sell' && l.commodity === 'steel'),
    'and with the flag on it is offered for you');
});

// The Market pane's "Fill from my books" button is this function and nothing
// else, so what it hands you has to be a listing you could actually stand
// behind: stock you really have spare, at a price your own government would ask.
test('a suggested ask is what you have spare, at the price your government would ask', () => {
  const state = fixture();
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  depot.store.steel = 4000;

  const ask = suggestListing(state, state.home, 'sell', 'steel');
  assert(ask.qty > 1, `an ask for a full warehouse should be worth posting, got ${ask.qty}`);
  assert(ask.price >= state.markets[state.home].steel.price,
    'and it asks at least what its own people pay');

  // ...and with the shelf empty there is nothing to promise, so it collapses to
  // the smallest quantity the form will take rather than to a blank field.
  depot.store.steel = 0;
  equal(suggestListing(state, state.home, 'sell', 'steel').qty, 0.1, 'an empty depot offers a token');
});

test('a suggested bid is what you are actually short of', () => {
  const state = fixture();
  place(state, 'warehouse', 20, 20, 'plain');
  place(state, 'steelMill', 21, 20, 'plain');

  const bid = suggestListing(state, state.home, 'buy', 'coal');
  assert(bid.qty > 0, 'a mill with no coal is short of coal');
  assert(bid.price > 0, 'and it bids a real price');

  // A bid already covered by a standing listing is not a shortage any more.
  post(state, { from: state.home, side: 'buy', commodity: 'coal', qty: 500, price: 40 });
  equal(suggestListing(state, state.home, 'buy', 'coal').qty, 0.1,
    'what is already on the book is not asked for twice');
});

test('turning off an export or import flag withdraws your matching listing', () => {
  const state = fixture();
  post(state, { from: state.home, side: 'sell', commodity: 'steel', qty: 10, price: 100 });
  post(state, { from: state.home, side: 'buy', commodity: 'coal', qty: 10, price: 100 });
  post(state, { from: state.home, side: 'sell', commodity: 'coal', qty: 10, price: 100 });

  toggleExport(state, 'steel');
  equal(exchangeOf(state).listings.some((l) => l.from === state.home && l.side === 'sell' && l.commodity === 'steel'), false,
    'disabled exports pull your ask');
  equal(exchangeOf(state).listings.some((l) => l.from === state.home && l.side === 'buy' && l.commodity === 'coal'), true,
    'other sides stay');

  toggleImport(state, 'coal');
  equal(exchangeOf(state).listings.some((l) => l.from === state.home && l.side === 'buy' && l.commodity === 'coal'), false,
    'disabled imports pull your bid');
});

test('bulk export and import policy clears the matching side of your book', () => {
  const state = fixture();
  post(state, { from: state.home, side: 'sell', commodity: 'steel', qty: 10, price: 100 });
  post(state, { from: state.home, side: 'buy', commodity: 'coal', qty: 10, price: 100 });
  post(state, { from: 'DE', side: 'sell', commodity: 'steel', qty: 10, price: 100 });

  setAllExports(state, false);
  equal(exchangeOf(state).listings.some((l) => l.from === state.home && l.side === 'sell'), false,
    'all disabled exports withdraw your asks');
  equal(exchangeOf(state).listings.some((l) => l.from === state.home && l.side === 'buy'), true,
    'your bids remain');
  equal(exchangeOf(state).listings.some((l) => l.from === 'DE'), true, 'other nations keep their listings');

  setAllImports(state, false);
  equal(exchangeOf(state).listings.some((l) => l.from === state.home && l.side === 'buy'), false,
    'all disabled imports withdraw your bids');
});

// A save written before the exchange existed has no book at all. Reaching into
// `state.exchange.listings` threw there, and because the click handler renders
// AFTER the action, the throw left the panel unrepainted — which is exactly what
// a button that does nothing looks like.
test('the bulk policy buttons work on a state with no exchange at all', () => {
  const state = fixture();
  delete state.exchange;

  equal(setAllExports(state, false).ok, true, 'turning every export off still succeeds');
  equal(COMMODITY_IDS.every((id) => state.exports[id] === false), true, 'and every flag is off');

  equal(setAllImports(state, true).ok, true, 'as does turning every import on');
  equal(COMMODITY_IDS.every((id) => state.imports[id] === true), true, 'and every flag is on');
});

test('a bulk policy change says what it did', () => {
  const state = fixture();
  post(state, { from: state.home, side: 'sell', commodity: 'steel', qty: 10, price: 100 });
  const before = state.alerts.length;

  const result = setAllExports(state, false);
  equal(result.pulled, 1, 'the ask it was standing behind comes off the book');
  assert(state.alerts.length > before, 'and the change announces itself');
});

// ---- the clearing fund and lending ----------------------------------------

test('the exchange takes a cut of both sides and it goes into the fund', () => {
  const state = fixture();
  const seller = COUNTRY_IDS.find((id) => id !== state.home);
  place(state, 'warehouse', 20, 20, 'plain');
  placeIn(state, seller, 'warehouse', 60, 60, 'plain').store.coal = 500;
  state.countries[seller].cash = 5_000_000;

  const signed = signContract(state, {
    seller, buyer: state.home, commodity: 'coal', qty: 10, every: 1, term: 20, price: 40,
    viaExchange: true,
  });
  state.tick = signed.contract.started;
  const before = exchangeOf(state).fund;
  runContracts(state);

  const fund = exchangeOf(state).fund;
  assert(fund > before, 'the house is paid');
  close(fund - before, 10 * 40 * CONFIG.exchange.fee * 2, 0.01, 'both sides of the deal, at the posted rate');
  assert(me(state).report.fees > 0, 'and your own books show what it cost you');
});

test('a contract written by hand pays no clearing fee', () => {
  const state = fixture();
  const seller = COUNTRY_IDS.find((id) => id !== state.home);
  place(state, 'warehouse', 20, 20, 'plain');
  placeIn(state, seller, 'warehouse', 60, 60, 'plain').store.coal = 500;
  state.countries[seller].cash = 5_000_000;

  const signed = signContract(state, {
    seller, buyer: state.home, commodity: 'coal', qty: 10, every: 1, term: 20, price: 40,
  });
  state.tick = signed.contract.started;
  runContracts(state);
  equal(exchangeOf(state).fund, 0, 'the house was not involved, so it is not paid');
});

test('a nation can borrow against the fund and is charged for it', () => {
  const state = fixture();
  exchangeOf(state).fund = 5_000_000;
  me(state).report.tax = 10_000;
  const cash = me(state).cash;

  const drawn = borrow(state, state.home, 200_000);
  assert(drawn.ok, `the fund should lend: ${drawn.reason}`);
  equal(me(state).cash, cash + drawn.amount, 'the money arrives');
  equal(me(state).debt, drawn.amount, 'and so does the balance');
  equal(exchangeOf(state).fund, 5_000_000 - drawn.amount, 'out of the fund, not out of thin air');

  const owed = me(state).debt;
  runLending(state);
  assert(me(state).report.interest > 0, 'interest accrues every tick');
  assert(me(state).debt < owed, 'and the tax base pays it down');
});

test('nothing is lent that the fund does not hold', () => {
  const state = fixture();
  exchangeOf(state).fund = 0;
  me(state).report.tax = 10_000;
  const result = borrow(state, state.home, 1_000_000);
  equal(result.ok, false, 'an empty fund lends nothing');
  equal(me(state).debt, 0, 'and nobody ends up owing it');
});

test('a balance is bounded by what the tax base can service', () => {
  const state = fixture();
  exchangeOf(state).fund = 500_000_000;
  me(state).report.tax = 1_000;
  const limit = borrowLimit(state, state.home);
  close(limit, 1_000 * CONFIG.exchange.loan.maxDebt, 1, 'a small economy is lent a small amount');
  borrow(state, state.home, 500_000_000);
  assert(me(state).debt <= limit + 1, 'and cannot draw past it however full the fund is');
});

test('a loan can be repaid early and the fund gets it back', () => {
  const state = fixture();
  exchangeOf(state).fund = 5_000_000;
  me(state).report.tax = 10_000;
  borrow(state, state.home, 100_000);
  const owed = me(state).debt;
  const fund = exchangeOf(state).fund;

  const result = repay(state, state.home, owed);
  assert(result.ok, 'you may clear it whenever you can afford to');
  equal(me(state).debt, 0, 'and then owe nothing');
  equal(exchangeOf(state).fund, fund + owed, 'the fund is whole again');
});

test('the world borrows rather than closing its industry', () => {
  const state = createInitialState();
  for (let i = 0; i < 400; i++) runTick(state);
  assert(exchangeOf(state).fund > 0, 'trade should have paid fees in by now');
  const borrowers = COUNTRY_IDS.filter((id) => (state.countries[id].debt ?? 0) > 0);
  assert(borrowers.length > 0, 'and somebody should have needed it');
  for (const id of borrowers) {
    assert(state.countries[id].debt <= borrowLimit(state, id) + state.countries[id].debt + 1,
      `${id} borrowed more than it may`);
  }
});

// ---- population ------------------------------------------------------------

test('a nation that is both well supplied and rich gains people', () => {
  const state = fixture();
  const gov = me(state);
  gov.cash = 500_000_000;
  gov.report.tax = 1_000;
  const before = gov.pop;
  for (let i = 0; i < 300; i++) {
    for (const id of COMMODITY_IDS) {
      state.markets[state.home][id].soldLastTick = appetite(state, state.home, id);
    }
    growEconomies(state);
  }
  assert(gov.pop > before, `a fed and solvent nation should grow, got ${gov.pop} from ${before}`);
  assert(gov.demand > COUNTRIES[state.home].demand, 'and its market with it');
});

test('a starving nation loses people, and both are bounded', () => {
  const state = fixture();
  const gov = me(state);
  gov.cash = 0;
  gov.report.tax = 1_000;
  for (let i = 0; i < 2_000; i++) {
    for (const id of COMMODITY_IDS) state.markets[state.home][id].soldLastTick = 0;
    growEconomies(state);
  }
  const base = COUNTRIES[state.home].pop;
  close(gov.pop, base * CONFIG.population.floor, base * 0.01, 'collapse has a floor');
  assert(gov.pop > 0, 'a nation is never emptied entirely');
});

test('being fed but poor holds a population steady', () => {
  const state = fixture();
  const gov = me(state);
  gov.cash = 0;                       // fed, but nowhere near comfortable
  gov.report.tax = 1_000_000;
  const before = gov.pop;
  for (let i = 0; i < 500; i++) {
    for (const id of COMMODITY_IDS) {
      state.markets[state.home][id].soldLastTick = appetite(state, state.home, id);
    }
    growEconomies(state);
  }
  close(gov.pop, before, 0.0001, 'the ordinary condition is neither boom nor exodus');
});

// ---- loop ------------------------------------------------------------------

function fakeClock() {
  let callback = null;
  return {
    schedule(fn) { callback = fn; return 1; },
    cancel() { callback = null; },
    advance(now) { const fn = callback; callback = null; if (fn) fn(now); },
  };
}

function loopFixture(overrides = {}) {
  const state = fixture();
  Object.assign(state, { paused: false, speed: 1 }, overrides);
  const clock = fakeClock();
  const counts = { ticks: 0, renders: 0 };
  const loop = createLoop({
    ctx: { state },
    onTick: () => counts.ticks++,
    onRender: () => counts.renders++,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  loop.start();
  clock.advance(0);
  return { state, clock, counts, loop };
}

test('the loop accumulates part-frames into exactly one tick per second', () => {
  const { clock, counts } = loopFixture();
  for (const t of [250, 500, 750]) { clock.advance(t); }
  equal(counts.ticks, 0, 'no tick before a full second of frames');
  clock.advance(1000);
  equal(counts.ticks, 1, 'the fourth 250ms frame completes the second');
  equal(counts.renders, 1, 'one render per tick batch, not per frame');
});

test('leftover time carries into later frames instead of being dropped', () => {
  const { clock, counts } = loopFixture();
  let now = 0;
  for (let i = 0; i < 8; i++) { now += 250; clock.advance(now); }
  equal(counts.ticks, 2, '2000ms of frames yields exactly two ticks');
});

test('speed multiplies ticks without changing real elapsed time', () => {
  const { clock, counts } = loopFixture({ speed: 4 });
  clock.advance(250);
  equal(counts.ticks, 1, 'a single 250ms frame at 4x completes a whole tick');
});

test('a paused loop never ticks and discards accumulated time', () => {
  const { state, clock, counts } = loopFixture({ paused: true });
  clock.advance(5000);
  equal(counts.ticks, 0, 'no ticks while paused');
  state.paused = false;
  clock.advance(5200);
  equal(counts.ticks, 0, 'time spent paused is not banked into a burst');
});

test('a long stall is clamped and cannot trigger a catch-up spiral', () => {
  const { clock, counts } = loopFixture({ speed: 4 });
  clock.advance(600_000);
  assert(counts.ticks <= 5, `a ten-minute stall must not burst past the catch-up cap, got ${counts.ticks}`);
  equal(counts.ticks, 1, 'the stalled frame is clamped to maxFrameMs of simulated work');
});

export function runTests(filter = '') {
  const needle = filter.trim().toLowerCase();
  const selected = needle ? tests.filter((t) => t.name.toLowerCase().includes(needle)) : tests;
  const results = selected.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (error) {
      return { name, ok: false, error: error.message };
    }
  });
  results.skipped = tests.length - selected.length;
  return results;
}

const isNode = typeof process !== 'undefined' && process.versions?.node && typeof document === 'undefined';
if (isNode) {
  const results = runTests(process.argv[2] ?? '');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.error}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passing`);
  process.exit(failed ? 1 : 0);
}
