import { createInitialState, createUiState, warehouseStock, siteWages, DEPOSIT_TERRAINS, WATER_TERRAINS, rehydrate,
  appetite, buildingsOf, canTrade, isPlayer, projectedWages, packState,
  pushAlert, pruneAlerts, dismissAlert, recordFlow, ownFlows,
  pruneOffers, knowsTech, learnTech, techCount, contractsOf, exchangeOf, spareRates,
  noteEvent, eventsFor, isAlive, setTileOwner, opinionOf, nudgeOpinion, decayOpinions } from '../src/core/state.js';
import { TECHS, TECH_IDS, STARTING_TECHS, canResearch, availableTechs, techChain } from '../src/data/technology.js';
import { COMMODITIES, COMMODITY_IDS } from '../src/data/commodities.js';
import { COUNTRIES, COUNTRY_IDS, COUNTRY_BY_CHAR } from '../src/data/countries.js';
import { WORLD_ROWS, WORLD_W, WORLD_H, SOURCE_ROWS, SOURCE_W, SOURCE_H,
  SOURCE_COUNTRY_ROWS, SOURCE_COUNTRY_W, SOURCE_COUNTRY_H, AREA_SCALE } from '../src/data/world.js';
import { CENTROIDS, distanceBetween, haulShare, neighboursOf, MAX_DISTANCE } from '../src/data/geography.js';
import { placeForCountry, provinceForTile, provinceForPoint } from '../src/data/places.js';
import { BUILDINGS, BUILDING_IDS } from '../src/data/buildings.js';
import { CONFIG } from '../src/core/config.js';
import { build, canBuild, demolish,
  setResearch, setResearchShare, buyTech, canBuyTech, proposeContract, cancelContract,
  acceptContractOffer, postListing, take, takeLoan, repayLoan, toggleExport, toggleImport,
  setAllExports, setAllImports, orderAutoConquest, orderAutoConquestAll, orderMoveMany,
  groupMany, unitsInBox, canCampaign } from '../src/actions.js';
import { runTick, PIPELINE } from '../src/systems/index.js';
import { produce } from '../src/systems/production.js';
import { payWages } from '../src/systems/economy.js';
import { movePrices, growEconomies } from '../src/systems/market.js';
import { sellDomestic, unmet, supplyRatio } from '../src/systems/domestic.js';
import { warehousesServing, spoil, relay } from '../src/systems/logistics.js';
import { runStateIndustry } from '../src/systems/stateIndustry.js';
import { runResearch, runTechTrade, licenceCost } from '../src/systems/research.js';
import { runContracts, runContractDiplomacy, signContract, canSignContract, quotePrice,
  suggestExportContract } from '../src/systems/contracts.js';
import { runExchange, runLending, post, takeListing, borrow, repay, borrowLimit,
  suggestListing } from '../src/systems/exchange.js';
import { canMilitaryEnter, createMilitaryUnit, defeatTerrorists, moveMilitaryUnit, startAutoConquest,
  cancelAutoConquest, canAutoConquer, enemiesOf, relationOf, setRelation, ticksToTerror,
  runMilitary, terroristForce, terroristStrength, unitsOf, armyCostOf, UNIT_TYPES, UNIT_IDS,
  canGroup, joinGroup, leaveGroup, groupMembers, groupSpeed, speedOf, rangeOf,
  unitShortfall, unitInStock, unitOnTile } from '../src/systems/military.js';
import { runRelations, proposeRelation, canPropose, answerProposal, declareWar, canDeclareWar,
  callOffWar, ultimatumBetween, ticksToWar, proposalsTo, relationAppetite, alliesOf,
  diplomacyOf, PROPOSABLE, warAppetite } from '../src/systems/relations.js';
import { runStateMilitary, armyTarget, atWar, mobilising } from '../src/systems/stateMilitary.js';
import { createLoop } from '../src/core/loop.js';
// The nation table's scoring is the one piece of UI with a rule in it rather
// than a layout, and it reads only `state` — so it is tested here like anything
// else. It must stay free of the DOM for this import to keep working headlessly.
import { scoreNations } from '../src/ui/ranks.js';
import { buildCategory } from '../src/ui/dashboard.js';

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
  state.buildings = [];
  state.nextBuildingId = 1;
  state.military.units = [];
  state.military.nextUnitId = 1;
  for (const tile of state.tiles) tile.buildingId = null;
  state.countries[state.home].cash = 1_000_000;
  // Almost every test below is about the economy rather than the tree, so the
  // nation being played already knows everything. The technology tests build
  // their own state and are explicit about what is and is not known.
  teachEverything(state, state.home);
  return state;
}

const me = (state) => state.countries[state.home];

// ---- world data integrity -------------------------------------------------

test('the information dock starts folded and the build dock starts open', () => {
  const ui = createUiState();
  equal(ui.panelOpen, false, 'the top information dock starts closed');
  equal(ui.leftOpen, true, 'the bottom build dock starts open');
});

test('build menu categories split economic and military tools', () => {
  equal(buildCategory('farm'), 'basic', 'farms sit in basic food');
  equal(buildCategory('ironMine'), 'extract', 'mines sit in extraction');
  equal(buildCategory('steelMill'), 'process', 'tier 1 factories sit in processing');
  equal(buildCategory('vehiclePlant'), 'assembly', 'tier 2 factories sit in assembly');
  equal(buildCategory('warehouse'), 'logistics', 'warehouses sit in logistics');
  // There is no military INDUSTRY: a formation is a unit, not a building, and
  // `buildCategory` sends every one of the five to 'military' with no building
  // definition behind it at all.
  for (const id of UNIT_IDS) equal(buildCategory(id), 'military', `${id} sits in military`);
});

test('every country starts with a small default economy and no military industry', () => {
  const state = createInitialState();
  for (const id of COUNTRY_IDS) {
    const mine = buildingsOf(state, id);
    assert(mine.some((b) => b.type === 'warehouse'), `${id} starts with a warehouse`);
    assert(mine.some((b) => b.type === 'farm' && state.tiles[b.tileId].terrain === 'farmland'), `${id} starts with farmland`);
    assert(mine.some((b) => b.type === 'foodPlant'), `${id} starts with an economic factory`);
    // The opening army is a FORMATION, not a factory, and there is no arms
    // industry left to build at all — a formation is raised out of base
    // commodities directly.
    assert(state.military.units.some((u) => u.owner === id && u.type === 'infantry'), `${id} starts with infantry`);
    assert(mine.length <= 3, `${id} starts small, not huge`);
  }
  assert(!BUILDING_IDS.some((id) => BUILDINGS[id].category === 'military'), 'no building is military industry any more');
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
  // The quarter-degree grid puts real centroids on real land, so Germany's six
  // closest markets are now the countries it actually touches — including the
  // small ones a coarse grid could not see.
  const near = neighboursOf('DE').slice(0, 6);
  const borders = ['FR', 'NL', 'PL', 'IT', 'BE', 'CH', 'AT', 'CZ', 'DK', 'LU', 'LI'];
  assert(near.every((id) => borders.includes(id)),
    `Germany's closest markets should be its neighbours, got ${near.join(', ')}`);
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

// A province with no land is a name on nothing: it would be listed, never drawn,
// and never reachable by hovering anything.
test('every province a country lists has land in it', () => {
  const found = {};
  for (let y = 0; y < SOURCE_COUNTRY_H; y++) {
    for (let x = 0; x < SOURCE_COUNTRY_W; x++) {
      const id = SOURCE_COUNTRY_ROWS[y][x];
      if (!id) continue;
      (found[id] ??= new Set()).add(provinceForPoint(id, x, y));
    }
  }
  for (const [id, names] of Object.entries(found)) {
    const listed = placeForCountry(id).provinces;
    equal(names.size, listed.length, `${id} lists ${listed.length} provinces but only ${names.size} have land`);
    for (const name of listed) {
      assert(names.has(name), `${id} lists ${name}, which no cell is in`);
    }
  }
});

// The provinces are real polygons now, so this is the check that the raster is
// the right way up and the right way round: a province has to be where the
// atlas says it is, not merely somewhere inside the right country.
test('a province is where the atlas puts it', () => {
  const middle = (id, name) => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = 0; y < SOURCE_COUNTRY_H; y++) {
      for (let x = 0; x < SOURCE_COUNTRY_W; x++) {
        if (SOURCE_COUNTRY_ROWS[y][x] !== id || provinceForPoint(id, x, y) !== name) continue;
        sx += x;
        sy += y;
        n++;
      }
    }
    assert(n > 0, `${id} has no ${name}`);
    return {
      lon: (sx / n) * 360 / SOURCE_COUNTRY_W - 180,
      lat: 90 - (sy / n) * 180 / SOURCE_COUNTRY_H,
      n,
    };
  };

  const near = (place, lon, lat, slack, what) => {
    assert(Math.abs(place.lon - lon) < slack && Math.abs(place.lat - lat) < slack,
      `${what} should be near ${lon}, ${lat} — found ${place.lon.toFixed(1)}, ${place.lat.toFixed(1)}`);
  };

  near(middle('US', 'Alaska'), -152, 64, 8, 'Alaska');
  near(middle('US', 'Texas'), -99.5, 31.5, 4, 'Texas');
  near(middle('US', 'Florida'), -82, 28.5, 4, 'Florida');
  near(middle('IR', 'Tehran'), 51.5, 35.5, 3, 'Tehran province');
  near(middle('IR', 'Sistan and Baluchestan'), 60.5, 28, 3, 'Sistan and Baluchestan');
  near(middle('AU', 'Queensland'), 144, -22.5, 5, 'Queensland');
  near(middle('CN', 'Xinjiang'), 85, 41, 5, 'Xinjiang');
});

// Thirty-one for Iran, not six blobs cut out of it by a clustering algorithm.
// This is the whole reason the admin-1 raster exists.
test('countries have their real subdivisions', () => {
  // The real subdivision counts, less any the quarter-degree raster is too
  // coarse to land a cell on — Afghanistan's thirty-four lose Panjshir and
  // Daykundi that way. These are a regression guard on the raster itself.
  const counts = { IR: 31, US: 51, AF: 32, DE: 16, JP: 47, BR: 27 };
  for (const [id, want] of Object.entries(counts)) {
    equal(placeForCountry(id).provinces.length, want, `${id} province count`);
  }
  const iran = placeForCountry('IR');
  equal(iran.province, 'Tehran', "Iran's capital province");
  for (const name of ['Khuzestan', 'Fars', 'Esfahan', 'Kerman', 'Gilan', 'Alborz']) {
    assert(iran.provinces.includes(name), `Iran should have ${name}`);
  }
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
    // Token is measured in AUTHORED cells, not tiles: the deposits in
    // countries.js are written against a 360x180 grid and AREA_SCALE converts
    // them, so the threshold has to be converted too or it means something
    // different every time the map gets sharper.
    const found = tiles.filter((t) => t.terrain === terrain).length;
    assert(found > 0, `Iran lost its ${terrain}`);
    assert(found < 3 * AREA_SCALE, `Iran's ${terrain} is meant to be token, found ${found}`);
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

// ---- the depot network ------------------------------------------------------

test('a depot hauls to a neighbouring depot what the far side is short of', () => {
  const state = fixture();
  // Three depots in a line, each 30 tiles from the next: the ends are 60 apart,
  // which is further than any warehouse reaches, so only the one in the middle
  // joins them up.
  const east = place(state, 'warehouse', 100, 100, 'plain');
  place(state, 'warehouse', 130, 100, 'plain');
  const west = place(state, 'warehouse', 160, 100, 'plain');
  const smelter = place(state, 'copperSmelter', 161, 100, 'plain');
  east.store.power = 400;
  east.store.copperOre = 400;

  for (let i = 0; i < 12; i++) runTick(state);

  assert((west.store.power ?? 0) > 0 || (smelter.input.power ?? 0) > 0,
    'power should have been hauled across the country to the smelter');
  equal(smelter.status, 'running', 'the smelter should be fed through the middle depot');
});

test('a depot does not accumulate what nothing near it needs', () => {
  const state = fixture();
  const east = place(state, 'warehouse', 100, 100, 'plain');
  const west = place(state, 'warehouse', 130, 100, 'plain');
  place(state, 'copperSmelter', 131, 100, 'plain');
  east.store.power = 200;
  east.store.aluminium = 200;

  for (let i = 0; i < 6; i++) relay(state);

  assert((west.store.power ?? 0) > 0, 'the smelter next door wants power');
  equal(Math.round(west.store.aluminium ?? 0), 0, 'nothing near the west depot eats aluminium');
});

test('a depot never gives away what its own industry is waiting for', () => {
  const state = fixture();
  const a = place(state, 'warehouse', 100, 100, 'plain');
  const b = place(state, 'warehouse', 130, 100, 'plain');
  place(state, 'copperSmelter', 101, 100, 'plain');
  place(state, 'copperSmelter', 131, 100, 'plain');
  a.store.power = 10;

  const before = a.store.power;
  relay(state);

  equal(a.store.power, before, 'a depot short of power for its own smelter hauls none away');
  equal(b.store.power ?? 0, 0, 'and the neighbour gets nothing');
});

test('depots too far apart do not haul to each other', () => {
  const state = fixture();
  const east = place(state, 'warehouse', 100, 100, 'plain');
  const west = place(state, 'warehouse', 200, 100, 'plain');
  place(state, 'copperSmelter', 201, 100, 'plain');
  east.store.power = 300;

  for (let i = 0; i < 6; i++) relay(state);

  equal(Math.round(west.store.power ?? 0), 0, 'a hundred tiles is beyond any warehouse');
  equal(Math.round(east.store.power), 300, 'and the cargo stays where it was');
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

test('opinion is sparse, asymmetric and survives a save round trip', () => {
  const state = createInitialState(7, 'BR');
  nudgeOpinion(state, 'BR', 'AR', 12.345);
  nudgeOpinion(state, 'AR', 'BR', -9);

  equal(opinionOf(state, 'BR', 'AR') > 0, true, 'Brazil can like Argentina');
  equal(opinionOf(state, 'AR', 'BR') < 0, true, 'without being liked back');

  const saved = packState(state);
  equal(saved.version, 15, 'the save version moves with the new state shape');
  equal(saved.diplomacy.opinion.BR.AR, 12.3, 'opinion is rounded on the way out');
  const back = rehydrate(JSON.parse(JSON.stringify(saved)));
  equal(opinionOf(back, 'BR', 'AR'), 12.3, 'positive opinion comes back');
  equal(opinionOf(back, 'AR', 'BR'), -9, 'negative opinion comes back too');

  nudgeOpinion(back, 'BR', 'AR', -12.3);
  equal(opinionOf(back, 'BR', 'AR'), 0, 'near-neutral opinions are dropped from the sparse table');
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
// A SELLER'S RED WARNING IS ABOUT NOW, NOT ABOUT WHAT IT ONCE MISSED.
//
// `lastShort` and its two halves are an audit of the settlement that just
// happened, and `missed` is a lifetime total that only ever grows. Neither can
// be the live "this contract is in trouble" flag for a seller: a rig opened
// after a missed cargo means the cargo was still missed and the contract is no
// longer in any trouble at all. `refreshSupplyHealth` recomputes `supplyShort`
// every tick from the same `spareRates` figure the offer filter uses, so the
// warning clears the moment the production does.
test('a seller warning clears when the production arrives, and the miss stays history', () => {
  const state = fixture();
  const them = other(state);
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  placeIn(state, them, 'warehouse', 24, 24, 'plain');
  state.countries[them].cash = 50_000_000;

  const signed = signContract(state, {
    seller: state.home, buyer: them, commodity: 'coal', qty: 4, every: 1, term: 40,
  });
  assert(signed.ok, `the contract should sign: ${signed.reason}`);
  const contract = signed.contract;
  state.tick = contract.started;

  // Nothing dug and nothing on the shelf: the delivery is missed outright, and
  // the promise is a rate this nation cannot sustain.
  runContracts(state);
  close(contract.lastSellerShort, 4, 0.001, 'the whole cargo was short on the seller side');
  assert(contract.missed > 0, 'and the miss is recorded');
  assert(contract.supplyShort > 0, 'the seller is flagged as unable to sustain the rate');

  // Now dig it. Enough collieries to cover four a tick, and the shelf filled so
  // the very next settlement goes out in full.
  for (let i = 0; i < 8; i++) place(state, 'coalMine', 21 + i, 20, 'coalfield');
  depot.store.coal = 500;
  const missedBefore = contract.missed;
  state.tick += contract.every;
  runContracts(state);

  close(contract.lastSellerShort, 0, 0.001, 'the latest delivery went out in full');
  close(contract.supplyShort, 0, 0.001, 'so the live seller warning is clear');
  equal(contract.missed, missedBefore, 'and the earlier miss is still a fact of the record');
});

// THE TRADE TAB'S "SUGGEST BEST BUYER" IS A DRAFT, NOT A DEAL.
//
// It starts from what you can actually sustain — spare rate less what you have
// already promised — and picks a country that genuinely NEEDS it rather than
// merely the richest one, because a contract a buyer cannot receive is a
// contract that defaults. It signs nothing: the player still sends it.
test('a suggested export is a real surplus offered to a country that needs it', () => {
  const state = fixture();
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  depot.store.coal = 2000;

  // No collieries yet, so there is no sustainable surplus to promise however
  // full the warehouse is — the same rule the offer filter goes by.
  const none = suggestExportContract(state, state.home, 'coal');
  equal(none.ok, false, 'nothing is suggested without a surplus RATE');

  for (let i = 0; i < 8; i++) place(state, 'coalMine', 21 + i, 20, 'coalfield');
  const spare = spareRates(state, state.home).coal;
  assert(spare > 1, `eight collieries leave a real surplus (${spare.toFixed(1)}/tick)`);

  const suggestion = suggestExportContract(state, state.home, 'coal');
  assert(suggestion.ok, `a buyer should be found: ${suggestion.reason}`);
  assert(suggestion.buyerId !== state.home, 'and it is somebody else');
  assert(suggestion.qty > 0 && suggestion.qty <= spare + 1e-6,
    `it never offers more than the surplus (${suggestion.qty} of ${spare.toFixed(1)})`);
  assert(suggestion.need > 0, 'the buyer it names is actually short of it');
  equal(state.contracts.length, 0, 'and nothing is signed — it fills a draft and no more');

  // Promise the whole surplus away and there is nothing left to suggest, which
  // is the half that stops the same coal being sold twice.
  const signed = signContract(state, {
    seller: state.home, buyer: suggestion.buyerId, commodity: 'coal',
    qty: Math.ceil(spare) + 2, every: 1, term: 40,
  });
  assert(signed.ok, `the over-committing contract should sign: ${signed.reason}`);
  equal(suggestExportContract(state, state.home, 'coal').ok, false,
    'a surplus already promised is not offered again');
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
  assert(opinionOf(state, partner, state.home) < CONFIG.diplomacy.opinion.signed,
    'and the buyer thinks less of the seller that defaulted');
});

test('signing and completing a contract improves opinion on both sides', () => {
  const state = fixture();
  const partner = COUNTRY_IDS.find((id) => id !== state.home);
  place(state, 'warehouse', 20, 20, 'plain');
  const theirs = placeIn(state, partner, 'warehouse', 60, 60, 'plain');
  theirs.store.coal = 100;
  me(state).cash = 5_000_000;
  state.countries[partner].cash = 5_000_000;

  const signed = signContract(state, {
    seller: partner, buyer: state.home, commodity: 'coal', qty: 1, every: 1, term: 0,
  });
  assert(signed.ok, 'the one-off contract signs');
  equal(opinionOf(state, state.home, partner), CONFIG.diplomacy.opinion.signed,
    'signing warms the buyer toward the seller');
  state.tick = signed.contract.started;
  runContracts(state);

  assert(opinionOf(state, state.home, partner) > CONFIG.diplomacy.opinion.signed,
    'completion warms the buyer further');
  assert(opinionOf(state, partner, state.home) > CONFIG.diplomacy.opinion.signed,
    'and the seller too');
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

test('world sellers undercut a standing ask when they sign a direct contract', () => {
  const state = fixture();
  const buyer = other(state);
  const seller = other(state, [buyer]);
  const standing = other(state, [buyer, seller]);
  for (const id of COUNTRY_IDS) state.countries[id].solvent = false;
  for (const id of [buyer, seller, standing]) {
    state.countries[id].solvent = true;
    state.countries[id].cash = 50_000_000;
  }

  const buyerTile = state.tiles.find((t) => t.countryId === buyer && t.terrain !== 'water');
  const sellerTile = state.tiles.find((t) => t.countryId === seller && t.terrain !== 'water');
  const standingTile = state.tiles.find((t) => t.countryId === standing && t.terrain !== 'water');
  placeIn(state, buyer, 'warehouse', buyerTile.x, buyerTile.y, 'plain');
  placeIn(state, buyer, 'coalPlant', buyerTile.x + 1, buyerTile.y, 'plain');
  placeIn(state, seller, 'warehouse', sellerTile.x, sellerTile.y, 'plain').store.coal = 5000;
  placeIn(state, standing, 'warehouse', standingTile.x, standingTile.y, 'plain').store.coal = 5000;
  state.markets[seller].coal.price = 200;
  state.markets[standing].coal.price = 200;
  post(state, { from: standing, side: 'sell', commodity: 'coal', qty: 10, price: 100 });

  const seekers = CONFIG.contracts.seekersPerTick;
  try {
    CONFIG.contracts.seekersPerTick = COUNTRY_IDS.length * 2;
    state.tick = CONFIG.contracts.every;
    runContractDiplomacy(state);
  } finally {
    CONFIG.contracts.seekersPerTick = seekers;
  }

  const made = state.contracts.find((c) => c.buyer === buyer && c.seller === seller && c.commodity === 'coal');
  assert(made, 'the buyer found the stocked seller');
  equal(made.price, 98, 'and the seller quoted under the best standing ask');
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

test('military movement needs access, alliance or war to enter foreign land', () => {
  const state = fixture();
  const own = state.tiles.find((t) => t.countryId === state.home && t.terrain === 'plain');
  const foreign = state.tiles.find((t) => t.countryId && t.countryId !== state.home && t.terrain !== 'water');
  // A formation is raised out of SUPPLIES, not out of the treasury, and
  // infantry eat and nothing else — so a depot with rations in it is the whole
  // requirement. `own` is now the depot's tile, so the unit musters beside it.
  const depot = place(state, 'warehouse', own.x, own.y, own.terrain);
  depot.store.food = UNIT_TYPES.infantry.cost.food * 2;
  const muster = state.tiles.find((t) => t.countryId === state.home
    && t.terrain !== 'water' && t.buildingId == null);
  const created = createMilitaryUnit(state, state.home, 'infantry', muster.id);
  assert(created.ok, `stocked rations can muster infantry (${created.reason ?? ''})`);
  const unit = created.unit;
  assert(canMilitaryEnter(state, unit, own), 'land units can move on home soil');
  assert(!canMilitaryEnter(state, unit, foreign), 'neutral foreign land is closed');
  assert(!moveMilitaryUnit(state, unit.id, foreign.id).ok, 'neutral foreign movement is rejected');
  setRelation(state, state.home, foreign.countryId, 'access');
  assert(canMilitaryEnter(state, unit, foreign), 'military access opens foreign land');
  assert(moveMilitaryUnit(state, unit.id, foreign.id).ok, 'military access allows movement');
  setRelation(state, state.home, foreign.countryId, 'war');
  equal(relationOf(state, state.home, foreign.countryId), 'war', 'war is mutual diplomacy state');
  assert(canMilitaryEnter(state, unit, foreign), 'war opens hostile land');
});

test('every formation is built out of a different bill, and infantry out of food alone', () => {
  equal(UNIT_IDS.length, 5, 'five formations: infantry, armoured car, tank, aircraft, artillery');
  equal(Object.keys(UNIT_TYPES.infantry.cost).join(), 'food', 'infantry are raised out of rations and nothing else');
  for (const id of UNIT_IDS) {
    const def = UNIT_TYPES[id];
    assert(Object.keys(def.cost).length > 0, `${id} is made of something`);
    for (const commodity of Object.keys(def.cost)) {
      assert(COMMODITIES[commodity], `${id} is raised out of a real commodity (${commodity})`);
    }
    // A formation costs its batch and NOTHING else, ever. This is the whole
    // shape of an army in this game: capital bought in goods, not a running
    // subscription — so a running bill is not merely unused data, it is a
    // contradiction of the rule.
    equal(def.upkeep, undefined, `${id} has no upkeep — a standing formation consumes nothing`);
  }
  // The four mechanised formations are still told apart by their fuel, and that
  // ordering is the whole point of having four of them. It just lives in what
  // they are BUILT from now rather than in what they burn.
  assert(UNIT_TYPES.armoredCar.cost.fuel < UNIT_TYPES.tank.cost.fuel,
    'an armoured car takes less fuel to build than a tank');
  assert(UNIT_TYPES.tank.cost.fuel < UNIT_TYPES.aircraft.cost.fuel,
    'and a tank less than an aircraft');
  assert(!UNIT_TYPES.artillery.cost.fuel, 'artillery need no oil at all');
  assert(UNIT_TYPES.artillery.cost.food < UNIT_TYPES.infantry.cost.food,
    'and less food than infantry');
  for (const dear of ['ore', 'power']) {
    assert(UNIT_TYPES.armoredCar.cost[dear] < UNIT_TYPES.tank.cost[dear],
      `an armoured car takes less ${dear} than a tank`);
  }
});

test('a formation is raised out of warehouse stock before it is out of the treasury', () => {
  const state = fixture();
  const own = state.tiles.find((t) => t.countryId === state.home && t.terrain === 'plain');
  const depot = place(state, 'warehouse', own.x, own.y, own.terrain);
  const ground = state.tiles.find((t) => t.countryId === state.home
    && t.terrain !== 'water' && t.buildingId == null);

  // An empty depot AND an empty treasury is the only combination that fields
  // nothing. Money alone can buy the batch in — dearly — which is what the
  // shortfall test above covers.
  me(state).cash = 0;
  equal(createMilitaryUnit(state, state.home, 'tank', ground.id).ok, false,
    'nothing on the shelf and nothing in the bank raises nothing');

  // With the goods on the shelf, the goods are what get spent: the treasury is
  // never touched when the warehouse can cover it.
  me(state).cash = 1_000_000;
  const cash = me(state).cash;
  Object.assign(depot.store, UNIT_TYPES.tank.cost);
  const raised = createMilitaryUnit(state, state.home, 'tank', ground.id);
  assert(raised.ok, `a stocked depot can (${raised.reason ?? ''})`);
  equal(raised.cash, 0, 'and nothing had to be bought in');
  equal(me(state).cash, cash, 'so the treasury is untouched — goods are always the cheaper route');
  for (const [commodity, qty] of Object.entries(UNIT_TYPES.tank.cost)) {
    assert(depot.store[commodity] < qty, `${commodity} came out of the warehouse`);
  }
  equal(createMilitaryUnit(state, state.home, 'tank', ground.id).ok, false,
    'two formations cannot hold the same ground');
});

test('a treasury can buy in what the warehouses have not got, at a markup', () => {
  const state = fixture();
  const own = state.tiles.find((t) => t.countryId === state.home && t.terrain === 'plain');
  const depot = place(state, 'warehouse', own.x, own.y, own.terrain);
  const ground = state.tiles.find((t) => t.countryId === state.home
    && t.terrain !== 'water' && t.buildingId == null);

  // Nothing on the shelves at all: the whole batch has to be bought in.
  const whole = unitShortfall(state, state.home, 'infantry', [depot]);
  equal(Object.keys(whole.short).join(), 'food', 'it is short of exactly what infantry are made of');
  assert(whole.cash > 0, `and that has a price (${whole.cash})`);
  // Dearer than the goods are worth, which is the entire point — producing it
  // yourself has to stay the better answer.
  assert(whole.cash > UNIT_TYPES.infantry.cost.food * COMMODITIES.food.basePrice,
    'procurement costs more than the goods are worth');

  // Too poor to buy and nothing to draw on: refused, and told why.
  me(state).cash = whole.cash - 1;
  const broke = createMilitaryUnit(state, state.home, 'infantry', ground.id);
  equal(broke.ok, false, 'a treasury that cannot cover it is refused');
  assert(/buying it in/.test(broke.reason), `and the refusal says so: ${broke.reason}`);

  // Rich enough, and it is raised out of MONEY with no depot stock at all.
  me(state).cash = whole.cash + 500_000;
  const before = me(state).cash;
  const bought = createMilitaryUnit(state, state.home, 'infantry', ground.id);
  assert(bought.ok, `a full treasury can field one (${bought.reason ?? ''})`);
  equal(bought.cash, whole.cash, 'and pays the quoted price');
  equal(me(state).cash, before - whole.cash, 'straight out of the treasury');

  // No contract, no counterparty, nothing crossed a border: this is procurement,
  // not trade, and that distinction is the whole rule.
  equal((state.contracts ?? []).length, 0, 'buying goods in writes no contract');
  equal((state.contractOffers ?? []).length, 0, 'and puts no offer to anybody');
});

test('goods are cheaper than money, and part-stocked means part-paid', () => {
  const state = fixture();
  const own = state.tiles.find((t) => t.countryId === state.home && t.terrain === 'plain');
  const depot = place(state, 'warehouse', own.x, own.y, own.terrain);
  const ground = state.tiles.find((t) => t.countryId === state.home
    && t.terrain !== 'water' && t.buildingId == null);
  me(state).cash = 5_000_000;

  const empty = unitShortfall(state, state.home, 'infantry', [depot]).cash;
  // Half the batch on the shelf halves what has to be bought.
  depot.store.food = UNIT_TYPES.infantry.cost.food / 2;
  const half = unitShortfall(state, state.home, 'infantry', [depot]).cash;
  assert(half > 0 && half < empty, `part-stocked costs part-price (${half} vs ${empty})`);

  // Fully stocked costs nothing at all — goods are always the cheaper route.
  depot.store.food = UNIT_TYPES.infantry.cost.food;
  equal(unitShortfall(state, state.home, 'infantry', [depot]).cash, 0,
    'a full shelf costs no money whatever');
  assert(unitInStock(state, state.home, 'infantry', [depot]), 'and reads as in stock');

  const cashBefore = me(state).cash;
  const raised = createMilitaryUnit(state, state.home, 'infantry', ground.id);
  assert(raised.ok, 'it is raised');
  equal(me(state).cash, cashBefore, 'and the treasury is untouched when the goods were there');
  equal(depot.store.food, 0, 'the goods went instead');
});

test('a standing formation costs its batch once and nothing ever again', () => {
  const state = fixture();
  const own = state.tiles.find((t) => t.countryId === state.home && t.terrain === 'plain');
  const depot = place(state, 'warehouse', own.x, own.y, own.terrain);
  const ground = state.tiles.find((t) => t.countryId === state.home
    && t.terrain !== 'water' && t.buildingId == null);
  depot.store.food = UNIT_TYPES.infantry.cost.food + 40;
  const before = depot.store.food;
  assert(createMilitaryUnit(state, state.home, 'infantry', ground.id).ok, 'infantry raised');
  equal(depot.store.food, before - UNIT_TYPES.infantry.cost.food, 'the batch came out of the depot');
  equal(Object.keys(armyCostOf(state, state.home)).join(), 'food',
    'and the army is accounted for in what it was built from');

  // An army is CAPITAL, not a subscription. Whatever is left in the depot after
  // the batch is still there a thousand ticks later.
  const kept = depot.store.food;
  const unit = unitsOf(state, state.home)[0];
  for (let i = 0; i < 400; i++) runMilitary(state);
  equal(depot.store.food, kept, 'a standing formation draws nothing at all, ever');
  equal(unit.strength, UNIT_TYPES.infantry.strength, 'and never wastes away');
  equal(unitsOf(state, state.home).length, 1, 'so an empty treasury cannot disband it');

  // ...and an empty depot changes nothing either, which is the point.
  depot.store.food = 0;
  for (let i = 0; i < 400; i++) runMilitary(state);
  equal(unitsOf(state, state.home).length, 1, 'nor can an empty warehouse');
  equal(unit.strength, UNIT_TYPES.infantry.strength, 'the only thing that can hurt it is an enemy');
});

// ---- how fast a formation moves and how far it reaches ---------------------

// A straight run of home soil, so a march can be measured in TILES rather than
// left to the shape of the real world. `claim` is the same tool the economy
// tests use to give a nation room next to a depot it just stamped.
function marchLane(state, length) {
  const start = state.tiles.find((t) => t.countryId === state.home && t.terrain !== 'water'
    && t.x + length + 1 < state.grid.w && t.y + 9 < state.grid.h);
  const lane = [];
  for (let i = 0; i <= length; i++) lane.push(claim(state, state.home, start.x + i, start.y, 'plain'));
  // Deliberately NO depot: a standing formation draws nothing, so a lane needs
  // no logistics behind it, and an empty lane is one where the only thing that
  // can move a unit's strength is an enemy.
  return lane;
}

// A formation put straight on the map. Raising one properly is tested above;
// these tests are about what it does once it is standing.
function station(state, type, tile, owner = state.home) {
  const def = UNIT_TYPES[type];
  const unit = {
    id: state.military.nextUnitId++, type, owner, domain: def.domain,
    tileId: tile.id, x: tile.x, y: tile.y, strength: def.strength,
    engaged: false, orderTileId: null, groupId: null,
  };
  state.military.units.push(unit);
  return unit;
}

test('every formation moves at its own pace and reaches only as far as it should', () => {
  // The five are told apart on the map by exactly two numbers, and both are
  // DATA — a system that hardcoded either would be the bug this asserts against.
  equal(UNIT_TYPES.infantry.speed, 1, 'infantry march a tile a tick');
  equal(UNIT_TYPES.artillery.speed, 1, 'and guns are no faster');
  equal(UNIT_TYPES.tank.speed, 2, 'a tank makes two');
  equal(UNIT_TYPES.armoredCar.speed, 3, 'a wheeled car three');
  equal(UNIT_TYPES.aircraft.speed, 20, 'and an aircraft twenty');
  assert(UNIT_TYPES.armoredCar.speed > UNIT_TYPES.tank.speed,
    'the light thing outruns the heavy one it is lighter than');
  assert(UNIT_TYPES.aircraft.speed > UNIT_TYPES.armoredCar.speed * 5,
    'and nothing on the ground is in the same class as an aircraft');

  for (const id of UNIT_IDS) {
    const def = UNIT_TYPES[id];
    assert(Number.isInteger(def.speed) && def.speed >= 1, `${id} covers whole tiles`);
    assert(Number.isInteger(def.range) && def.range >= 1, `${id} reaches at least the ground it touches`);
    equal(def.range, id === 'artillery' ? 3 : 1,
      `${id} strikes ${id === 'artillery' ? 'three tiles out' : 'only what it can touch'}`);
  }
});

test('a move order is a march, not a teleport — a tile a tick for infantry', () => {
  const state = fixture();
  const lane = marchLane(state, 6);
  const unit = station(state, 'infantry', lane[0]);

  const order = moveMilitaryUnit(state, unit.id, lane[5].id);
  assert(order.ok, `the order is accepted (${order.reason ?? ''})`);
  equal(unit.x, lane[0].x, 'and nothing has moved yet — an order is not an arrival');

  runMilitary(state);
  equal(unit.x, lane[1].x, 'one tick covers exactly one tile');
  runMilitary(state);
  equal(unit.x, lane[2].x, 'and the next covers one more');
  for (let i = 0; i < 3; i++) runMilitary(state);
  equal(unit.tileId, lane[5].id, 'it arrives on the tile it was ordered to');
  equal(unit.orderTileId, null, 'and the order is spent');
  runMilitary(state);
  equal(unit.tileId, lane[5].id, 'a formation with no order stays where it is');
});

test('a tank covers two tiles a tick, a car three, and an aircraft twenty', () => {
  const state = fixture();
  const lane = marchLane(state, 24);
  const paces = { tank: 2, armoredCar: 3, aircraft: 20 };
  for (const [type, pace] of Object.entries(paces)) {
    const unit = station(state, type, lane[0]);
    assert(moveMilitaryUnit(state, unit.id, lane[24].id).ok, `${type} takes the order`);
    runMilitary(state);
    equal(unit.x - lane[0].x, pace, `${type} covers ${pace} tiles in one tick`);
    // Take it off the board again so the next one starts from the same ground.
    state.military.units = state.military.units.filter((u) => u.id !== unit.id);
  }
});

// ---- grouping --------------------------------------------------------------

test('land formations group with land, and aircraft only with aircraft', () => {
  const state = fixture();
  const lane = marchLane(state, 4);
  const foot = station(state, 'infantry', lane[0]);
  const guns = station(state, 'artillery', lane[1]);
  const plane = station(state, 'aircraft', lane[2]);
  const wing = station(state, 'aircraft', lane[3]);
  const foreign = COUNTRY_IDS.find((id) => id !== state.home);
  const theirs = station(state, 'infantry', lane[4], foreign);

  assert(canGroup(foot, guns), 'riflemen and guns march together');
  assert(canGroup(plane, wing), 'and aircraft fly with aircraft');
  equal(canGroup(foot, plane), false, 'but an aircraft does not march with infantry');
  equal(canGroup(plane, guns), false, 'nor with a gun battery');
  equal(canGroup(foot, theirs), false, 'and two governments’ armies are not one army');

  assert(joinGroup(state, foot.id, guns.id).ok, 'a land group forms');
  equal(joinGroup(state, foot.id, plane.id).ok, false, 'an aircraft cannot join it');
  equal(joinGroup(state, foot.id, theirs.id).ok, false, 'and neither can a foreign formation');
  equal(groupMembers(state, foot.groupId).length, 2, 'the group is the two who could');
});

test('a group moves together, at the pace of its slowest member', () => {
  const state = fixture();
  const lane = marchLane(state, 12);
  const car = station(state, 'armoredCar', lane[0]);
  const foot = station(state, 'infantry', lane[0]);
  assert(joinGroup(state, car.id, foot.id).ok, 'the column forms');
  equal(groupSpeed(state, car.groupId), 1,
    'and it moves at the rifleman’s pace, not the car’s');

  // The order is given to the CAR, and the whole column takes it.
  const order = moveMilitaryUnit(state, car.id, lane[3].id);
  assert(order.ok, 'the order is accepted');
  equal(order.ordered.length, 2, 'and it is given to both of them');
  equal(foot.orderTileId, lane[3].id, 'the rifleman has the same destination');

  runMilitary(state);
  equal(car.x - lane[0].x, 1, 'the car is held to one tile a tick');
  equal(foot.x - lane[0].x, 1, 'and the rifleman keeps up with it');
  for (let i = 0; i < 2; i++) runMilitary(state);
  equal(car.tileId, lane[3].id, 'they arrive together');
  equal(foot.tileId, lane[3].id, 'on the same ground');

  // Cut loose, the car is itself again.
  assert(leaveGroup(state, car.id).ok, 'a formation can leave the column');
  equal(car.groupId, null, 'and stops being part of it');
  equal(foot.groupId, null, 'a group of one is no group at all — the last member is freed too');
  assert(moveMilitaryUnit(state, car.id, lane[9].id).ok, 'the car takes its own order');
  runMilitary(state);
  equal(car.x - lane[3].x, speedOf(car), 'and moves at its own three tiles a tick again');
  equal(foot.tileId, lane[3].id, 'while the rifleman it left behind stays put');
});

// ---- what a formation can reach --------------------------------------------

test('artillery shells a cell three tiles out; everything else must stand on it', () => {
  const state = fixture();
  const lane = marchLane(state, 8);
  const camp = lane[0];

  const raid = () => {
    const active = {
      id: 'terror-test', name: 'ISIS cell', countryId: state.home,
      tileId: camp.id, x: camp.x, y: camp.y,
      infantry: CONFIG.terrorism.startInfantry, spawnedAt: 0, movedAt: 0,
      targetId: null, destroyed: 0,
    };
    active.strength = terroristStrength(active);
    state.terrorism.active = active;
    return active;
  };

  // Did the cell take anything off it this tick? That, rather than whether it
  // was cleared outright, is the question about REACH — a cell is worn down
  // now, so "did it feel that" is the honest signal.
  const hurts = () => {
    const was = terroristStrength(state.terrorism.active);
    runMilitary(state);
    return !state.terrorism.active || terroristStrength(state.terrorism.active) < was;
  };

  // A gun battery three tiles out shells the camp without ever standing on it —
  // the whole reason for dragging one around.
  const active = raid();
  const guns = station(state, 'artillery', lane[3]);
  guns.strength = active.strength;
  equal(rangeOf(guns), 3, 'a gun reaches three tiles');
  assert(hurts(), 'and hits the camp from where it stands');

  // A tile further out and it is only watching.
  state.military.units = [];
  raid();
  station(state, 'artillery', lane[4]).strength = terroristStrength(state.terrorism.active);
  equal(hurts(), false, 'four tiles is out of range even for a gun');

  // Riflemen at the same distance do nothing at all...
  state.military.units = [];
  const still = raid();
  const foot = station(state, 'infantry', lane[3]);
  foot.strength = still.strength;
  equal(hurts(), false, 'infantry three tiles away cannot touch it');

  // ...but adjacent is inside their one tile of reach.
  foot.x = lane[1].x;
  foot.y = lane[1].y;
  foot.tileId = lane[1].id;
  assert(hurts(), 'a rifleman on the next tile can');
});

test('a terrorist cell is infantry and a few cars, never grows, and moves slowly toward a target', () => {
  const state = fixture();
  const host = COUNTRY_IDS.find((id) => id !== state.home);
  const camp = state.tiles.find((t) => t.countryId === host && t.terrain !== 'water');
  // Far enough away that closing the gap takes several move ticks — the whole
  // point of `moveTiles` being small — so the target must survive the first one.
  const far = state.tiles.find((t) => t.countryId === host && t.terrain !== 'water'
    && Math.abs(t.x - camp.x) + Math.abs(t.y - camp.y) >= CONFIG.terrorism.moveTiles * 4);
  const target = placeIn(state, host, 'warehouse', far.x, far.y, 'plain');
  const before = state.buildings.length;
  const active = {
    id: 'terror-test', name: 'ISIS cell', countryId: host,
    tileId: camp.id, x: camp.x, y: camp.y,
    infantry: CONFIG.terrorism.startInfantry,
    spawnedAt: 0, movedAt: 0, targetId: null, destroyed: 0,
  };
  active.strength = terroristStrength(active);
  state.terrorism.active = active;

  const force = terroristForce(active);
  equal(force.infantry, CONFIG.terrorism.startInfantry, 'a cell is counted in riflemen');
  assert(force.armoredCar < force.infantry, 'and it always has fewer cars than men');

  // `runMilitary` rather than `runTick`, so nothing else in the world builds or
  // demolishes while this is being measured — only the clock is walked forward
  // by hand, which is enough to trigger `moveEvery`.
  state.tick = CONFIG.terrorism.moveEvery;
  runMilitary(state);
  equal(active.destroyed, 0, 'one move tick does not close a distant target');
  assert(state.buildings.some((b) => b.id === target.id), 'so the target survives the first step');
  const stepped = Math.abs(active.x - camp.x) + Math.abs(active.y - camp.y);
  assert(stepped > 0 && stepped <= CONFIG.terrorism.moveTiles * 2, 'it closed at most a couple of tiles');
  equal(terroristForce(active).infantry, CONFIG.terrorism.startInfantry,
    'and it never gains a formation it has no industry for — the force is fixed');

  // Walk the clock forward until it must have arrived and struck.
  for (let i = 1; i <= 60 && active.destroyed === 0; i++) {
    state.tick += CONFIG.terrorism.moveEvery;
    runMilitary(state);
  }
  equal(active.destroyed, 1, 'it eventually reaches and destroys the site');
  equal(state.buildings.length, before - 1, 'and builds nothing to replace it');
  equal(state.buildings.some((b) => b.id === target.id), false, 'the site it reached is gone');
  equal(state.tiles[target.tileId].buildingId, null, 'and the ground it stood on is cleared');
});

test('a matched defence clears a terrorist cell and pays a bounty', () => {
  const state = fixture();
  const camp = state.tiles.find((t) => t.countryId === state.home && t.terrain !== 'water');
  const depotTile = state.tiles.find((t) => t.countryId === state.home
    && t.terrain !== 'water' && t.id !== camp.id);
  place(state, 'warehouse', depotTile.x, depotTile.y, depotTile.terrain).store.food = 500;

  const active = {
    id: 'terror-test', name: 'ISIS cell', countryId: state.home,
    tileId: camp.id, x: camp.x, y: camp.y,
    infantry: CONFIG.terrorism.startInfantry, spawnedAt: 0, movedAt: 0, targetId: null, destroyed: 0,
  };
  active.strength = terroristStrength(active);
  state.terrorism.active = active;
  state.military.units.push({
    id: state.military.nextUnitId++, type: 'infantry', owner: state.home, domain: 'land',
    tileId: camp.id, x: camp.x, y: camp.y, strength: active.strength, engaged: false,
  });

  const cashBefore = me(state).cash;
  // Fighting a cell is a FIGHT, not a threshold: a matched force wears it down
  // over a run of ticks rather than clearing it in one stroke. The old rule was
  // all-or-nothing, and that is exactly what left a lone formation standing on a
  // camp for two thousand ticks doing nothing at all.
  runMilitary(state);
  assert(state.terrorism.active, 'one tick does not settle it');
  assert(terroristForce(state.terrorism.active).infantry < CONFIG.terrorism.startInfantry
    || terroristStrength(state.terrorism.active) < active.strength,
    'but the cell has taken losses');

  let ticks = 1;
  while (state.terrorism.active && ticks < 400) { runMilitary(state); ticks++; }
  equal(state.terrorism.active, null, `a matched defending force does clear it (${ticks} ticks)`);
  equal(me(state).cash, cashBefore + CONFIG.terrorism.bounty, 'and the bounty lands straight in the treasury');
});

test('a cell wears its attackers down too, and destroys one it outmatches', () => {
  const state = fixture();
  const camp = state.tiles.find((t) => t.countryId === state.home && t.terrain !== 'water');
  const active = {
    id: 'terror-test', name: 'ISIS cell', countryId: state.home,
    tileId: camp.id, x: camp.x, y: camp.y,
    infantry: CONFIG.terrorism.startInfantry, spawnedAt: 0, movedAt: 0, targetId: null, destroyed: 0,
  };
  active.strength = terroristStrength(active);
  state.terrorism.active = active;
  // One rifleman against a whole cell — the case that used to be a permanent
  // stalemate, with the unit standing on the camp for ever.
  state.military.units.push({
    id: state.military.nextUnitId++, type: 'infantry', owner: state.home, domain: 'land',
    tileId: camp.id, x: camp.x, y: camp.y, strength: UNIT_TYPES.infantry.strength, engaged: false,
  });

  // Snapshot the NUMBER: `active` is the live cell, so reading `active.strength`
  // after the fight would be comparing it against itself.
  const wasStrength = active.strength;
  let ticks = 0;
  while (state.military.units.length && ticks < 400) { runMilitary(state); ticks++; }
  equal(state.military.units.length, 0, `an outmatched formation is destroyed (${ticks} ticks)`);
  assert(state.terrorism.active, 'and it does not clear the cell on its own');
  assert(terroristStrength(state.terrorism.active) < wasStrength,
    'though it does real damage on the way down — several such attacks add up');
});

// ---- the world log ---------------------------------------------------------

test('the world log records what other governments do, and forgets it after 50 ticks', () => {
  const state = createInitialState();
  for (let i = 0; i < 400; i++) runTick(state);

  const log = state.events ?? [];
  assert(log.length > 0, 'the world has been doing things and they are written down');
  // Every row is DATA, not a sentence — that is what keeps the save small and
  // keeps presentation text out of `src/systems`.
  for (const e of log) {
    assert(typeof e.kind === 'string' && e.kind.length, 'each row names what happened');
    assert(COUNTRIES[e.who], `and who did it (${e.who})`);
    equal(typeof e.text, 'undefined', 'and carries no formatted sentence');
  }
  // Bounded twice over: nothing older than the TTL, and never more than the cap.
  const oldest = Math.min(...log.map((e) => e.tick));
  assert(state.tick - oldest <= CONFIG.events.ttl,
    `nothing survives past ${CONFIG.events.ttl} ticks (oldest was ${state.tick - oldest} ago)`);
  assert(log.length <= CONFIG.events.max, `and the list is capped at ${CONFIG.events.max}`);

  // It is the WORLD's news, not only yours — that is the entire point.
  assert(log.some((e) => e.who !== state.home), 'other governments appear in it');
});

test('the log finds a nation under either name, and filters to it', () => {
  const state = fixture();
  const them = other(state);
  const third = other(state, [them]);
  state.tick = 10;
  noteEvent(state, 'pact', them, { about: third, what: 'access' });
  noteEvent(state, 'army', state.home, { what: 'infantry', qty: 0 });

  equal(eventsFor(state, 'all').length, 2, 'the world sees both');
  equal(eventsFor(state, state.home).length, 1, 'yours sees only yours');
  // `about` counts as much as `who`: a pact put TO a nation is that nation's
  // news as much as the proposer's.
  equal(eventsFor(state, third).length, 1, 'a nation appears under `about` too');
  equal(eventsFor(state, third)[0].who, them, 'attributed to whoever acted');
  // Newest first — a log you have to scroll to the bottom of is a log nobody
  // reads.
  state.tick = 20;
  noteEvent(state, 'war', them, { about: third });
  equal(eventsFor(state, 'all')[0].kind, 'war', 'newest first');
});

test('a burst is capped even before the sweep runs', () => {
  const state = fixture();
  // Every nation acting on one decision tick is the real case: the sweep runs
  // once a tick, so the cap has to hold WITHIN a tick as well as between them.
  for (let i = 0; i < CONFIG.events.max * 2; i++) {
    noteEvent(state, 'army', state.home, { what: 'infantry', qty: 0 });
  }
  equal(state.events.length, CONFIG.events.max, 'the cap holds inside a single tick');
  // ...and the ones kept are the NEWEST, or a burst would bury the news it
  // arrived with.
  const ids = state.events.map((e) => e.id);
  equal(ids[ids.length - 1], Math.max(...ids), 'and the newest are the ones kept');
});

// ---- diplomacy is asked for; war is declared -------------------------------

const other = (state, skip = []) => COUNTRY_IDS.find((id) => id !== state.home && !skip.includes(id));

test('alliance, access and peace are requests — war is the one thing that is not', () => {
  const state = fixture();
  const them = other(state);

  for (const relation of PROPOSABLE) {
    assert(relation !== 'war', 'war is not on the list of things one government may ask another for');
  }
  const refused = canPropose(state, state.home, them, 'war');
  equal(refused.ok, false, 'and it cannot be proposed even by name');
  assert(/declared/.test(refused.reason), `the refusal says why: ${refused.reason}`);

  const put = proposeRelation(state, state.home, them, 'access');
  assert(put.ok, `access can be asked for (${put.reason ?? ''})`);
  equal(relationOf(state, state.home, them), 'neutral',
    'and asking changes nothing — a proposal is not a relation');

  equal(proposeRelation(state, state.home, them, 'alliance').ok, false,
    'only one thing on the table with one nation at a time');

  assert(answerProposal(state, put.proposal.id, true, them).ok, 'they can agree');
  equal(relationOf(state, state.home, them), 'access', 'and THAT is what changes the relation');
  equal(diplomacyOf(state).proposals.length, 0, 'an answered proposal leaves the table');
});

test('a declaration of war waits its hundred ticks, then begins', () => {
  const state = fixture();
  const them = other(state);
  setRelation(state, state.home, them, 'alliance');

  const declared = declareWar(state, state.home, them);
  assert(declared.ok, `war can be declared without asking (${declared.reason ?? ''})`);
  equal(relationOf(state, state.home, them), 'neutral',
    'the alliance is torn up on the spot — you cannot be an ally and be marching on them');
  equal(ticksToWar(state, state.home, them), CONFIG.diplomacy.warDelay,
    'and the clock starts at the full delay');

  // Walk it to one tick short of the deadline.
  for (let i = 0; i < CONFIG.diplomacy.warDelay - 1; i++) {
    state.tick++;
    runRelations(state);
  }
  equal(relationOf(state, state.home, them), 'neutral', 'ninety-nine ticks in, nobody is at war');
  equal(ticksToWar(state, state.home, them), 1, 'but it is one tick away');

  state.tick++;
  runRelations(state);
  equal(relationOf(state, state.home, them), 'war', 'on the hundredth tick the war begins');
  equal(ultimatumBetween(state, state.home, them), null, 'and the declaration is spent');
});

test('a declaration can be called off while it is still only a declaration', () => {
  const state = fixture();
  const them = other(state);
  const declared = declareWar(state, state.home, them);
  assert(declared.ok, 'war declared');

  for (let i = 0; i < 30; i++) { state.tick++; runRelations(state); }
  assert(callOffWar(state, declared.ultimatum.id, state.home).ok, 'the government that declared it can call it off');
  equal(ultimatumBetween(state, state.home, them), null, 'the declaration is gone');

  for (let i = 0; i < CONFIG.diplomacy.warDelay * 2; i++) { state.tick++; runRelations(state); }
  equal(relationOf(state, state.home, them), 'neutral', 'and no war ever starts');
});

test('the defender’s allies are dragged in — with their own hundred ticks', () => {
  const state = fixture();
  const them = other(state);
  const friend = other(state, [them]);
  setRelation(state, them, friend, 'alliance');
  equal(alliesOf(state, them).includes(friend), true, 'they have an ally');

  declareWar(state, state.home, them);
  for (let i = 0; i < CONFIG.diplomacy.warDelay; i++) { state.tick++; runRelations(state); }
  equal(relationOf(state, state.home, them), 'war', 'the first war has begun');
  equal(relationOf(state, state.home, friend), 'neutral',
    'and their ally is NOT instantly at war — there is no back door round the delay');
  equal(ticksToWar(state, state.home, friend), CONFIG.diplomacy.warDelay,
    'it has declared, and its own hundred ticks are running');

  for (let i = 0; i < CONFIG.diplomacy.warDelay; i++) { state.tick++; runRelations(state); }
  equal(relationOf(state, state.home, friend), 'war', 'then it joins');
});

test('peace has to be agreed, and it holds for a while afterwards', () => {
  const state = fixture();
  const them = other(state);
  setRelation(state, state.home, them, 'war');

  equal(canPropose(state, state.home, them, 'alliance').ok, false,
    'you do not ask a nation you are shelling for an alliance');
  const suit = proposeRelation(state, state.home, them, 'neutral');
  assert(suit.ok, `but you may sue for peace (${suit.reason ?? ''})`);
  equal(relationOf(state, state.home, them), 'war', 'asking is not peace');

  answerProposal(state, suit.proposal.id, false, them);
  equal(relationOf(state, state.home, them), 'war', 'and a refusal leaves the war standing');

  const again = proposeRelation(state, state.home, them, 'neutral');
  equal(again.ok, false, 'nor can you ask the same thing again straight away');

  // Walk past the cooldown and try once more, this time accepted.
  state.tick += CONFIG.diplomacy.cooldown;
  const accepted = proposeRelation(state, state.home, them, 'neutral');
  assert(accepted.ok, 'after the cooldown it can be put again');
  answerProposal(state, accepted.proposal.id, true, them);
  equal(relationOf(state, state.home, them), 'neutral', 'and agreed peace ends the war');
  equal(canDeclareWar(state, state.home, them).ok, false,
    'the peace holds — you cannot declare again on the same tick you signed it');
  state.tick += CONFIG.diplomacy.peaceCooldown;
  assert(canDeclareWar(state, state.home, them).ok, 'but it is not permanent');
});

test('the world answers what is put to it, and the same save answers the same way', () => {
  const play = (seed) => {
    const state = fixture();
    state.seed = seed;
    const them = other(state);
    proposeRelation(state, state.home, them, 'access');
    for (let i = 0; i < CONFIG.diplomacy.every * 2; i++) { state.tick++; runRelations(state); }
    return relationOf(state, state.home, them);
  };
  const first = play(CONFIG.seed);
  assert(first === 'access' || first === 'neutral', 'a proposal put to the world gets an answer');
  equal(diplomacyOf(fixture()).proposals.length, 0, 'and nothing is left on the table');
  equal(play(CONFIG.seed), first, 'a replayed save answers identically — diplomacy is deterministic');
});

test('a government wants a near neighbour more than a stranger', () => {
  const state = createInitialState();
  // Neighbours and antipodes, measured with the same `haulShare` freight is.
  const near = relationAppetite(state, 'FR', 'DE', 'access');
  const far = relationAppetite(state, 'FR', 'NZ', 'access');
  assert(near > far, `geography decides diplomacy too (${near.toFixed(2)} vs ${far.toFixed(2)})`);
  // An alliance is a promise to fight somebody else's war, so it is wanted less
  // freely than a landing strip, all else being equal.
  assert(relationAppetite(state, 'FR', 'DE', 'alliance') < relationAppetite(state, 'FR', 'DE', 'access'),
    'and an alliance is a bigger ask than access');
});

test('opinion changes diplomatic appetite and decays toward neutral', () => {
  const state = createInitialState();
  const cold = relationAppetite(state, 'FR', 'DE', 'access');
  nudgeOpinion(state, 'FR', 'DE', 50);
  const warm = relationAppetite(state, 'FR', 'DE', 'access');
  assert(warm > cold, 'liking a government makes a pact more attractive');

  const before = opinionOf(state, 'FR', 'DE');
  decayOpinions(state);
  assert(opinionOf(state, 'FR', 'DE') < before, 'and opinion fades toward neutral on review');
});

test('declaring war damages opinion, including friends of the defender', () => {
  const state = fixture();
  const attacker = other(state);
  const defender = other(state, [attacker]);
  const friend = other(state, [attacker, defender]);
  nudgeOpinion(state, friend, defender, 60);

  const before = warAppetite(state, attacker, defender);
  const declared = declareWar(state, attacker, defender);
  assert(declared.ok, 'the attack is declared');

  assert(opinionOf(state, defender, attacker) <= CONFIG.diplomacy.opinion.war,
    'the defender strongly dislikes the attacker');
  assert(opinionOf(state, friend, attacker) < 0,
    'and a friend of the defender lowers its opinion of the attacker too');
  assert(warAppetite(state, attacker, defender) < before,
    'an existing declaration no longer has appetite to declare again');
});

test('the world can declare war, but only one per review and not during the quiet period', () => {
  const state = createInitialState();
  const attacker = 'FR';
  const defender = neighboursOf(attacker).find((id) => id !== state.home);
  for (const id of COUNTRY_IDS) state.countries[id].solvent = false;
  for (const id of [attacker, defender]) {
    state.countries[id].solvent = true;
    state.countries[id].cash = 50_000_000;
  }
  state.countries[attacker].demand = 1000;
  state.countries[defender].demand = 1;
  nudgeOpinion(state, attacker, defender, -100);

  const jitter = CONFIG.diplomacy.jitter;
  try {
    CONFIG.diplomacy.jitter = 0;
    state.tick = CONFIG.diplomacy.warQuiet;
    runRelations(state);
    equal(diplomacyOf(state).ultimatums.length, 1, 'one hostile pair can produce one declaration');

    const secondTarget = neighboursOf(attacker).find((id) => id !== defender && id !== state.home);
    state.countries[secondTarget].solvent = true;
    nudgeOpinion(state, attacker, secondTarget, -100);
    state.tick += CONFIG.diplomacy.every;
    runRelations(state);
    equal(diplomacyOf(state).ultimatums.length, 1, 'the worldwide quiet period blocks another one');
  } finally {
    CONFIG.diplomacy.jitter = jitter;
  }
});

test('the world never puts more than a few pacts to you at once', () => {
  const state = createInitialState();
  for (let i = 0; i < 400; i++) runTick(state);
  assert(proposalsTo(state, state.home).length <= CONFIG.diplomacy.maxProposals,
    'your inbox is capped — a stack of pacts is a stack nobody reads');
});

// ---- what a war actually does ----------------------------------------------

// Nothing to set up: a formation costs nothing to keep, so a combat test needs
// no depots on either side and any strength that moves in one moved because
// somebody shot it off.

test('formations at war grind each other down; at peace they do not', () => {
  const state = fixture();
  const lane = marchLane(state, 4);
  const them = other(state);
  const mine = station(state, 'infantry', lane[0]);
  const theirs = station(state, 'infantry', lane[0], them);

  const before = mine.strength;
  runMilitary(state);
  equal(mine.strength, before, 'two formations sharing a tile in peacetime simply stand there');
  equal(theirs.strength, UNIT_TYPES.infantry.strength, 'both of them, and both are fed');

  setRelation(state, state.home, them, 'war');
  runMilitary(state);
  assert(mine.strength < before, 'at war they fire');
  assert(theirs.strength < UNIT_TYPES.infantry.strength, 'and BOTH of them are hit — nobody shoots first');
  equal(mine.strength.toFixed(4), theirs.strength.toFixed(4),
    'by exactly the same amount: who is earlier in the array cannot decide a battle');

  // A formation IN CONTACT does not make its losses good. Without that rule its
  // recovery outruns an even enemy's fire, both settle at half strength for
  // ever, and no war between two even armies can be decided at all.
  equal(mine.engaged, true, 'it is in contact');
  const wounded = mine.strength;
  runMilitary(state);
  assert(mine.strength < wounded, 'and still losing ground — a unit under fire gets no replacements');

  // Evenly matched, they are gone together rather than one surviving on the
  // strength of being earlier in the array.
  for (let i = 0; i < 200 && state.military.units.length; i++) runMilitary(state);
  equal(state.military.units.length, 0, 'an even fight destroys both');
});

test('a formation that is broken is destroyed rather than lingering at nothing', () => {
  const state = fixture();
  const lane = marchLane(state, 4);
  const them = other(state);
  setRelation(state, state.home, them, 'war');
  // A tank against a rifleman: the rifleman is broken long before the tank is.
  const tank = station(state, 'tank', lane[0]);
  const foot = station(state, 'infantry', lane[0], them);

  let ticks = 0;
  while (state.military.units.includes(foot) && ticks < 200) { runMilitary(state); ticks++; }
  assert(ticks < 200, `the rifleman is destroyed rather than decaying for ever (${ticks} ticks)`);
  assert(state.military.units.includes(tank), 'and the tank is still standing');

  // ...and the survivor is out of contact again, so it makes its losses good.
  // Left flagged as engaged it could never recover from a war it had won.
  // `reorganise` runs before the shooting, so the flag clears on the tick after
  // the fight ends and recovery starts on the one after that — a deliberate
  // one-tick lag, not an oversight.
  const hurt = tank.strength;
  assert(hurt < UNIT_TYPES.tank.strength, 'the tank did not come through unscathed');
  runMilitary(state);
  equal(tank.engaged, false, 'the last unit standing is in contact with nothing');
  runMilitary(state);
  assert(tank.strength > hurt, 'and starts making its losses good');
  // Damage is a share of the attacker's strength, so nothing ever reaches zero
  // on its own — the break point is what turns that asymptote into an outcome.
  assert(UNIT_TYPES.infantry.strength * CONFIG.war.breakAt > 0,
    'a formation is spent well before its strength is');
});

test('artillery outranges everything, and shells across the line', () => {
  const state = fixture();
  const lane = marchLane(state, 6);
  const them = other(state);
  setRelation(state, state.home, them, 'war');
  const guns = station(state, 'artillery', lane[0]);
  const foe = station(state, 'infantry', lane[3], them);

  const gunsAt = guns.strength;
  runMilitary(state);
  // Both are supplied, so any strength that moved here moved because it was
  // shot off — which is the whole point of stocking the enemy's depot.
  assert(foe.strength < UNIT_TYPES.infantry.strength, 'a gun three tiles out hits');
  equal(guns.strength, gunsAt, 'and riflemen three tiles away cannot hit back');

  // A fourth tile is out of range of even the guns.
  const distant = station(state, 'infantry', lane[4], them);
  runMilitary(state);
  equal(distant.strength, UNIT_TYPES.infantry.strength, 'four tiles is out of reach of everything');
});

test('a war costs the loser its industry', () => {
  const state = fixture();
  const lane = marchLane(state, 4);
  const them = other(state);
  // Their soil, their factory, right beside our line.
  const site = placeIn(state, them, 'warehouse', lane[3].x, lane[3].y, 'plain');
  const raider = station(state, 'infantry', lane[2]);
  equal(raider.owner, state.home, 'the raider is ours');

  state.tick = CONFIG.war.raidEvery;
  runMilitary(state);
  assert(state.buildings.some((b) => b.id === site.id), 'in peacetime a neighbour’s factory is safe');

  setRelation(state, state.home, them, 'war');
  runMilitary(state);
  equal(state.buildings.some((b) => b.id === site.id), false, 'at war a formation beside it wrecks it');
  equal(state.tiles[site.tileId].buildingId, null, 'and the ground it stood on is cleared');
});

// ---- taking ground ---------------------------------------------------------

test('a land formation takes the ground it stands on, and an aircraft never does', () => {
  const state = fixture();
  const lane = marchLane(state, 4);
  const them = other(state);
  // Their soil, right beside our line.
  const theirs = claim(state, them, lane[2].x, lane[2].y, 'plain');
  const air = claim(state, them, lane[3].x, lane[3].y, 'plain');
  setRelation(state, state.home, them, 'war');

  const foot = station(state, 'infantry', theirs);
  const plane = station(state, 'aircraft', air);
  state.tick = CONFIG.war.conquerEvery;
  runMilitary(state);

  equal(theirs.countryId, state.home, 'the rifleman took the tile it was standing on');
  equal(air.countryId, them, 'and the aircraft took nothing — it overflies, it does not occupy');
  equal(foot.owner, state.home, 'the formation is unchanged by any of it');
  equal(plane.owner, state.home, 'both of them');

  // The DIFF is written down, because tiles are dropped from the save and
  // regenerated from the seed — a conquest that only lived on the tile would be
  // silently undone by a save/load.
  equal(state.claims[theirs.id], state.home, 'the change is recorded as a claim');
  assert((state.mapVersion ?? 0) > 0, 'and the map version moved, so the AI caches know');
});

test('ground taken carries whatever is built on it', () => {
  const state = fixture();
  const lane = marchLane(state, 4);
  const them = other(state);
  const ground = claim(state, them, lane[2].x, lane[2].y, 'plain');
  const site = placeIn(state, them, 'warehouse', ground.x, ground.y, 'plain');
  equal(site.owner, them, 'their factory to begin with');
  setRelation(state, state.home, them, 'war');
  // Beside it rather than on it — a building occupies its tile, so the raid
  // clears the site first and the ground is taken once the unit can stand there.
  station(state, 'infantry', ground);

  // A tick the conquest cadence falls on but the RAID cadence does not, so the
  // site is still standing when the ground moves — otherwise this would be
  // testing demolition rather than transfer.
  state.tick = CONFIG.war.conquerEvery;
  assert(state.tick % CONFIG.war.raidEvery !== 0, 'no raid falls on this tick');
  runMilitary(state);
  equal(ground.countryId, state.home, 'the ground changed hands');
  // `building.owner` is ALSO the country the site stands in — a stated
  // invariant — so a site whose ground moved has to move with it or the two
  // would disagree.
  const still = state.buildings.find((b) => b.id === site.id);
  assert(still, 'the site is still standing');
  equal(still.owner, state.home, 'and changed hands with the ground under it');
});

test('a march takes EVERY tile it crosses, not just the one it stops on', () => {
  const state = fixture();
  const lane = marchLane(state, 8);
  const them = other(state);
  // A corridor of their soil to walk down.
  for (let i = 1; i <= 6; i++) claim(state, them, lane[i].x, lane[i].y, 'plain');
  setRelation(state, state.home, them, 'war');
  const unit = station(state, 'infantry', lane[0]);

  assert(moveMilitaryUnit(state, unit.id, lane[6].id).ok, 'ordered down the corridor');
  for (let i = 0; i < 10 && unit.orderTileId != null; i++) { state.tick++; runMilitary(state); }
  equal(unit.tileId, lane[6].id, 'it arrived');

  // The whole corridor, not merely the far end. A unit that walked through six
  // tiles of enemy country has been in six tiles of enemy country — before this
  // it took only whichever tile it happened to stand on when the conquest
  // cadence next came round, which is one in ten.
  for (let i = 1; i <= 6; i++) {
    equal(lane[i].countryId, state.home, `tile ${i} of the corridor was taken`);
  }
});
// A CAMPAIGN NEEDS A WAR AND NOTHING ELSE.
//
// It marches at the nearest enemy that still holds ground and takes every tile
// it crosses, one a tick even for a formation that could cover three — the pace
// is what makes it something you watch rather than a button that wins a war.
test('a land formation can automatically occupy an enemy one tile per tick', () => {
  const state = fixture();
  const lane = marchLane(state, 5);
  const them = other(state);
  // Keep the test country to this small, reachable corridor so the sweep has a
  // finite and observable objective.
  for (const tile of state.tiles) if (tile.countryId === them) tile.countryId = null;
  for (let i = 1; i <= 4; i++) claim(state, them, lane[i].x, lane[i].y, 'plain');
  setRelation(state, state.home, them, 'war');
  const unit = station(state, 'armoredCar', lane[0]);

  const order = startAutoConquest(state, unit.id);
  assert(order.ok, 'a land unit can campaign against an enemy');
  equal(order.countryId, them, 'it selects the enemy');
  for (let i = 1; i <= 4; i++) {
    state.tick++;
    runMilitary(state);
    equal(unit.tileId, lane[i].id, `it advances exactly one tile on tick ${i}`);
    equal(lane[i].countryId, state.home, `it occupies tile ${i} as it crosses it`);
  }
  equal(isAlive(state, them), false, 'taking the final tile annexes the country');
  assert(!startAutoConquest(state, unit.id).ok, 'the order is unavailable once no enemy at war has land');
});

// The gate USED to be narrower: the enemy also had to have no formations left,
// which made this a tidying-up order for a war already won rather than the "go
// and take them" button it reads as. The fighting needs no rule of its own —
// `resolveWarCombat` triggers on proximity plus `war` and has never taken an
// attack order — so marching at the enemy IS attacking it.
test('an automatic campaign needs only an enemy at war that still holds ground', () => {
  const state = fixture();
  const lane = marchLane(state, 5);
  const them = other(state);
  const unit = station(state, 'infantry', lane[0]);

  assert(!canAutoConquer(state, unit).ok, 'no war, no campaign');
  equal(canCampaign(state), false, 'and the army-wide button is not offered either');

  setRelation(state, state.home, them, 'war');
  // ...and they field a formation of their own, which used to be what refused
  // the order outright.
  const theirs = state.tiles.find((t) => t.countryId === them && t.terrain !== 'water');
  station(state, 'infantry', theirs, them);
  assert(canAutoConquer(state, unit).ok, 'a defended enemy can still be campaigned against');
  assert(enemiesOf(state, state.home).includes(them), 'and they count as an enemy holding land');
  equal(canCampaign(state), true, 'so the army-wide button is offered');

  const order = orderAutoConquest(state, unit.id, true);
  assert(order.ok, 'the order is taken');
  equal(unit.autoConquerCountryId, them, 'and it marches at them');

  // The SAME button pressed again is what calls it off. It is a separate entry
  // point rather than a toggle inside the start, so a campaign the system has
  // already ended cannot be restarted by trying to stop it.
  assert(orderAutoConquest(state, unit.id, false).ok, 'the same order stops it');
  equal(unit.autoConquerCountryId, null, 'the campaign is off');
  assert(!cancelAutoConquest(state, unit.id).ok, 'and stopping a formation that is not campaigning is refused');
});

test('a campaign moves on to the next enemy rather than ending with the first', () => {
  const state = fixture();
  const lane = marchLane(state, 6);
  const [them, alsoThem] = COUNTRY_IDS.filter((id) => id !== state.home).slice(0, 2);
  for (const tile of state.tiles) if (tile.countryId === them || tile.countryId === alsoThem) tile.countryId = null;
  // Two enemies along one lane, a tile each: the first is annexed almost at
  // once, so the campaign has to find the second by itself or it stops there.
  claim(state, them, lane[1].x, lane[1].y, 'plain');
  claim(state, alsoThem, lane[3].x, lane[3].y, 'plain');
  setRelation(state, state.home, them, 'war');
  setRelation(state, state.home, alsoThem, 'war');
  const unit = station(state, 'infantry', lane[0]);

  assert(startAutoConquest(state, unit.id).ok, 'the campaign begins');
  equal(unit.autoConquerCountryId, them, 'against the nearer of the two');
  for (let i = 0; i < 8; i++) { state.tick++; runMilitary(state); }
  equal(lane[1].countryId, state.home, 'the first enemy tile was taken');
  equal(lane[3].countryId, state.home, 'and so was the second enemy, without a new order');
});

test('one order can campaign a whole army, and one can call every campaign off', () => {
  const state = fixture();
  const lane = marchLane(state, 8);
  const them = other(state);
  setRelation(state, state.home, them, 'war');
  const foot = station(state, 'infantry', lane[0]);
  const car = station(state, 'armoredCar', lane[1]);
  // An aircraft occupies nothing, so a bulk order must refuse it for exactly the
  // reason a single one does — a campaign is ground being taken.
  const plane = station(state, 'aircraft', lane[2]);

  const all = orderAutoConquestAll(state, null, true);
  assert(all.ok, 'the whole army is ordered at once');
  equal(all.ordered, 2, 'both land formations campaign');
  assert(foot.autoConquerCountryId && car.autoConquerCountryId, 'the two land formations are campaigning');
  equal(plane.autoConquerCountryId ?? null, null, 'the aircraft is not');

  const off = orderAutoConquestAll(state, null, false);
  assert(off.ok, 'and one order calls them all off');
  equal(off.ordered, 2, 'both campaigns stopped');
  assert(!foot.autoConquerCountryId && !car.autoConquerCountryId, 'nothing is campaigning');

  // ...and the same order confined to a SELECTION touches only what is in it.
  assert(orderAutoConquestAll(state, [car.id], true).ok, 'a selection can be ordered on its own');
  equal(foot.autoConquerCountryId ?? null, null, 'the formation outside the selection is untouched');
  assert(Boolean(car.autoConquerCountryId), 'and the one inside it is campaigning');
});

test('a campaign cannot be started in peacetime by any route', () => {
  const state = fixture();
  const lane = marchLane(state, 3);
  const unit = station(state, 'infantry', lane[0]);
  equal(orderAutoConquestAll(state, null, true).ok, false, 'the bulk order is refused');
  equal(unit.autoConquerCountryId ?? null, null, 'and nothing is campaigning');
});

test('a selection box picks out your own formations and orders them together', () => {
  const state = fixture();
  const lane = marchLane(state, 6);
  const them = other(state);
  const mine = station(state, 'infantry', lane[1]);
  const alsoMine = station(state, 'tank', lane[2]);
  const outside = station(state, 'infantry', lane[5]);
  const theirs = station(state, 'infantry', lane[3], them);

  const box = unitsInBox(state, lane[1].x, lane[1].y, lane[3].x, lane[3].y);
  assert(box.includes(mine.id) && box.includes(alsoMine.id), 'both of yours inside the box are caught');
  assert(!box.includes(theirs.id), 'a foreign formation inside it is not');
  assert(!box.includes(outside.id), 'and one of yours outside it is not');

  // ...and a selection is ordered as one. Every formation in it marches, and a
  // formation left out of it does not.
  const order = orderMoveMany(state, box, lane[4]);
  assert(order.ok, 'the selection takes the order');
  equal(order.ordered, 2, 'both selected formations march');
  equal(mine.orderTileId, lane[4].id, 'the first is marching');
  equal(alsoMine.orderTileId, lane[4].id, 'and so is the second');
  equal(outside.orderTileId ?? null, null, 'the unselected one is not');

  // Grouping a selection goes through `joinGroup`, so land stays with land and
  // this file needs to know nothing about domains.
  assert(groupMany(state, box).ok, 'the selection groups');
  assert(mine.groupId != null && mine.groupId === alsoMine.groupId, 'into one column');
});

test('a formation can walk BACKWARDS off a peninsula to get where it is going', () => {
  const state = fixture();
  const lane = marchLane(state, 10);
  // A spit: the unit sits at the tip, and the only land is to the WEST while the
  // goal is to the EAST. Everything around it except lane[0] is sea.
  const tip = claim(state, state.home, lane[1].x, lane[1].y, 'plain');
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const t = state.tiles[(tip.y + oy) * state.grid.w + (tip.x + ox)];
      if (t && t.id !== lane[0].id) { t.terrain = 'water'; t.countryId = null; }
    }
  }
  // A way round, one row south, back out to the east.
  for (let i = 0; i <= 10; i++) claim(state, state.home, lane[0].x + i, lane[0].y + 1, 'plain');
  const goal = claim(state, state.home, lane[9].x, lane[9].y + 1, 'plain');

  const unit = station(state, 'infantry', tip);
  assert(moveMilitaryUnit(state, unit.id, goal.id).ok, 'ordered east, off the spit');
  let ticks = 0;
  while (unit.orderTileId != null && ticks < 200) { state.tick++; runMilitary(state); ticks++; }

  // It has to go WEST first — away from the goal — which the first version of
  // the step rule forbade outright. That is what pinned Turkey's whole army on
  // the Black Sea coast: every order it was given died on the first tick.
  equal(unit.tileId, goal.id, `it got there by going the long way round (${ticks} ticks)`);
});

test('a march that cannot get there gives up instead of circling for ever', () => {
  const state = fixture();
  const lane = marchLane(state, 4);
  const them = other(state);
  setRelation(state, state.home, them, 'war');
  const unit = station(state, 'infantry', lane[0]);
  // An island: their soil, ringed by sea, with no land approach at all.
  const isle = claim(state, them, lane[0].x, lane[0].y + 4, 'plain');
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const t = state.tiles[(isle.y + oy) * state.grid.w + (isle.x + ox)];
      if (t) { t.terrain = 'water'; t.countryId = null; }
    }
  }

  assert(moveMilitaryUnit(state, unit.id, isle.id).ok, 'the order is accepted — you cannot see it is hopeless');
  let ticks = 0;
  while (unit.orderTileId != null && ticks < 400) { state.tick++; runMilitary(state); ticks++; }
  equal(unit.orderTileId, null, `the march is abandoned rather than run for ever (${ticks} ticks)`);
  assert(ticks <= CONFIG.war.giveUpAfter + 20, 'and abandoned promptly once it stops making progress');
  equal(unit.unreachable, isle.id, 'the place is remembered, so it is not ordered there again');
  equal(isle.countryId, them, 'and the island was never taken');
});

test('a formation standing still fights whatever walks into its range', () => {
  const state = fixture();
  const lane = marchLane(state, 6);
  const them = other(state);
  setRelation(state, state.home, them, 'war');

  // Ours is stationary and under no orders at all — a garrison.
  const guard = station(state, 'infantry', lane[0]);
  // Theirs walks past it.
  const raider = station(state, 'infantry', lane[4], them);
  moveMilitaryUnit(state, raider.id, lane[6].id);

  const full = UNIT_TYPES.infantry.strength;
  state.tick = 1;
  runMilitary(state);
  equal(guard.strength, full, 'four tiles away, nothing happens');
  equal(guard.orderTileId, null, 'and the garrison has no orders of its own');

  // Let it march. Nothing is ordered to attack and nothing is targeted — the
  // raider is simply walking past, and coming within reach is the whole trigger.
  moveMilitaryUnit(state, raider.id, lane[0].id);
  for (let i = 0; i < 6 && guard.strength === full; i++) { state.tick++; runMilitary(state); }
  assert(guard.strength < full, 'once it is adjacent, the garrison is in the fight');
  assert(raider.strength < full, 'and so is the raider — both fire, neither was ordered to');
  equal(guard.engaged, true, 'the garrison reads as in contact');
});

test('a nation with no land left ceases to exist and can do nothing', () => {
  const state = fixture();
  const them = other(state);
  // Reduce them to a single tile, then take it.
  const owned = state.tiles.filter((t) => t.countryId === them);
  for (const tile of owned.slice(1)) tile.countryId = null;
  const last = owned[0];
  last.terrain = 'plain';
  setRelation(state, state.home, them, 'war');
  station(state, 'infantry', last);

  assert(isAlive(state, them), 'they exist while they hold ground');
  state.tick = CONFIG.war.conquerEvery;
  runMilitary(state);

  equal(last.countryId, state.home, 'the last tile is taken');
  equal(isAlive(state, them), false, 'and the nation is finished');
  equal(canTrade(state, state.home, them), false, 'a nation that does not exist is not a market');
  equal(canPropose(state, state.home, them, 'access').ok, false, 'nor can it be dealt with');
  equal(unitsOf(state, them).length, 0, 'its army is gone');
  equal(state.countries[them].demand, 0, 'and it has no economy');

  // It does not come back, and it does not act.
  for (let i = 0; i < 60; i++) runTick(state);
  equal(isAlive(state, them), false, 'conquest is permanent');
});

test('a march holds the straight line rather than dog-legging to a corner', () => {
  const state = fixture();
  // A wide open field so terrain cannot be the reason for any bend in the path.
  const x0 = 400;
  const y0 = 300;
  for (let y = y0 - 4; y <= y0 + 24; y++) {
    for (let x = x0 - 2; x <= x0 + 62; x++) claim(state, state.home, x, y, 'plain');
  }
  const from = state.tiles[y0 * state.grid.w + x0];
  const goal = state.tiles[(y0 + 20) * state.grid.w + (x0 + 60)];
  const unit = station(state, 'infantry', from);
  assert(moveMilitaryUnit(state, unit.id, goal.id).ok, 'ordered across the field');

  let worst = 0;
  for (let i = 0; i < 200 && unit.orderTileId != null; i++) {
    state.tick++;
    runMilitary(state);
    // How far off the sight-line from start to goal it has strayed.
    const cross = Math.abs((goal.x - from.x) * (unit.y - from.y) - (goal.y - from.y) * (unit.x - from.x));
    worst = Math.max(worst, cross / Math.hypot(goal.x - from.x, goal.y - from.y));
  }
  equal(unit.tileId, goal.id, 'it arrives');
  // Distance here is CHEBYSHEV, so a whole family of routes is equally short and
  // the tie-break decides which one you watch. Settling ties by neighbour order
  // sent a column up to the northern coast and along it; closing both axes first
  // walked the diagonal out and then turned a hard corner. Following the
  // sight-line keeps it on the line a person would draw.
  assert(worst <= 1.5, `it stays on the sight-line (worst deviation ${worst.toFixed(2)} tiles)`);
});

test('an army fans out rather than marching down one road', () => {
  const state = fixture();
  const them = other(state);
  const seat = state.tiles.find((t) => t.countryId === them && t.terrain !== 'water');
  // Three separate objectives to aim at.
  const sites = [];
  for (let i = 0; i < 3; i++) {
    sites.push(placeIn(state, them, 'warehouse', seat.x + i * 6, seat.y + 6, 'plain'));
  }
  // ...and three of ours, mustered together.
  const home = state.tiles.find((t) => t.countryId === state.home && t.terrain !== 'water');
  const ours = [0, 1, 2].map(() => station(state, 'infantry', home));
  setRelation(state, state.home, them, 'war');

  // `orderArmy` is the government's, so drive it as one: this is about how a
  // government spreads its army, not about the player's own orders.
  const enemyState = { ...state, home: 'ZZ' };   // so runStateMilitary does not skip us
  enemyState.tick = CONFIG.stateArmyEvery;
  runStateMilitary(enemyState);

  const goals = ours.map((u) => u.orderTileId).filter((g) => g != null);
  assert(goals.length > 1, `more than one formation was given an objective (${goals.length})`);
  equal(new Set(goals).size, goals.length,
    'and no two were sent to the same tile — an army that walks single file arrives as a stack');
});

test('a government marches at enemy formations before enemy land', () => {
  const state = fixture();
  const actor = other(state);
  const enemy = other(state, [actor]);
  const actorTile = state.tiles.find((t) => t.countryId === actor && t.terrain !== 'water');
  const enemyTile = state.tiles.find((t) => t.countryId === enemy && t.terrain !== 'water');
  const ours = station(state, 'infantry', actorTile, actor);
  const theirs = station(state, 'infantry', enemyTile, enemy);
  setRelation(state, actor, enemy, 'war');

  const spread = CONFIG.army.spread;
  try {
    CONFIG.army.spread = 0;
    const aiState = { ...state, home: 'ZZ' };
    aiState.tick = CONFIG.stateArmyEvery;
    runStateMilitary(aiState);
  } finally {
    CONFIG.army.spread = spread;
  }

  equal(ours.orderTileId, theirs.tileId, 'the first objective is the enemy formation');
});

test('a government marches at enemy land when there are no sites or formations left', () => {
  const state = fixture();
  const actor = other(state);
  const enemy = other(state, [actor]);
  const actorTile = state.tiles.find((t) => t.countryId === actor && t.terrain !== 'water');
  const ours = station(state, 'infantry', actorTile, actor);
  state.buildings = state.buildings.filter((b) => b.owner !== enemy);
  state.military.units = state.military.units.filter((u) => u.owner !== enemy);
  setRelation(state, actor, enemy, 'war');

  const aiState = { ...state, home: 'ZZ' };
  aiState.tick = CONFIG.stateArmyEvery;
  runStateMilitary(aiState);

  assert(ours.orderTileId != null, 'it still gets an objective');
  equal(state.tiles[ours.orderTileId].countryId, enemy, 'and that objective is enemy ground');
});

test('a defeated nation\'s treasury, people and industry pass to the victor', () => {
  const state = fixture();
  const them = other(state);
  // One tile left, with a treasury and a population on it.
  const owned = state.tiles.filter((t) => t.countryId === them);
  for (const tile of owned.slice(1)) tile.countryId = null;
  const last = owned[0];
  last.terrain = 'plain';
  const gov = state.countries[them];
  gov.cash = 250_000;
  gov.pop = 12;
  gov.demand = 9;

  const mine = me(state);
  const cashBefore = mine.cash;
  const popBefore = mine.pop ?? 0;
  const demandBefore = mine.demand;

  setRelation(state, state.home, them, 'war');
  station(state, 'infantry', last);
  state.tick = CONFIG.war.conquerEvery;
  runMilitary(state);

  equal(isAlive(state, them), false, 'they are conquered');
  equal(mine.cash, cashBefore + 250_000, 'their treasury is yours');
  equal(mine.pop, popBefore + 12, 'and their people');
  equal(mine.demand, demandBefore + 9, 'and the economy they were');
  equal(state.countries[them].cash, 0, 'they keep nothing');
  equal(state.buildings.some((b) => b.owner === them), false, 'nor any industry');
});

test('a cell that finishes a nation inherits nothing — it is not a government', () => {
  const state = fixture();
  const them = other(state);
  const owned = state.tiles.filter((t) => t.countryId === them);
  for (const tile of owned.slice(1)) tile.countryId = null;
  const last = owned[0];
  last.terrain = 'plain';
  state.countries[them].cash = 500_000;
  const before = COUNTRY_IDS.reduce((sum, id) => sum + state.countries[id].cash, 0);

  const active = {
    id: 'terror-test', name: 'ISIS cell', countryId: them,
    tileId: last.id, x: last.x, y: last.y,
    infantry: CONFIG.terrorism.startInfantry, spawnedAt: 0, movedAt: 0,
    targetId: null, destroyed: 0,
  };
  active.strength = terroristStrength(active);
  state.terrorism.active = active;
  placeIn(state, them, 'warehouse', last.x, last.y, 'plain');   // something to go for

  for (let i = 1; i <= 20 && isAlive(state, them); i++) {
    state.tick += CONFIG.terrorism.moveEvery;
    runMilitary(state);
  }
  const after = COUNTRY_IDS.reduce((sum, id) => sum + state.countries[id].cash, 0);
  assert(after <= before, 'no government got richer for a cell taking a country');
});

test('a terrorist cell takes ground, and freeing it gives the ground back', () => {
  const state = fixture();
  const them = other(state);
  const seat = state.tiles.find((t) => t.countryId === them && t.terrain !== 'water');
  const target = placeIn(state, them, 'warehouse', seat.x + 3, seat.y, 'plain');
  const active = {
    id: 'terror-test', name: 'ISIS cell', countryId: them,
    tileId: seat.id, x: seat.x, y: seat.y,
    infantry: CONFIG.terrorism.startInfantry, spawnedAt: 0, movedAt: 0,
    targetId: target.id, destroyed: 0,
  };
  active.strength = terroristStrength(active);
  state.terrorism.active = active;

  // Walk it until it has taken ground.
  for (let i = 1; i <= 20 && !Object.keys(state.occupied ?? {}).length; i++) {
    state.tick += CONFIG.terrorism.moveEvery;
    runMilitary(state);
  }
  const held = Object.keys(state.occupied ?? {});
  assert(held.length > 0, 'the cell holds ground it has walked over');
  for (const tileId of held) {
    equal(state.occupied[tileId], them, 'and remembers whose it was');
    equal(state.tiles[Number(tileId)].countryId, null,
      'while it holds it, the ground belongs to nobody — a cell is not a government');
  }

  // A THIRD nation clears it. The ground must go back to `them`, not to the
  // liberator — that is the whole rule.
  const liberator = other(state, [them]);
  const camp = state.tiles[active.tileId];
  claim(state, liberator, camp.x, camp.y + 40, 'plain');   // somewhere of their own
  state.countries[liberator].cash = 1;
  defeatTerrorists(state);

  equal(Object.keys(state.occupied).length, 0, 'the cell holds nothing once it is gone');
  for (const tileId of held) {
    equal(state.tiles[Number(tileId)].countryId, them,
      'liberated ground goes home to the nation it was taken from, never to the liberator');
  }
});

test('conquest survives a save and a load', () => {
  const state = fixture();
  const lane = marchLane(state, 4);
  const them = other(state);
  const ground = claim(state, them, lane[2].x, lane[2].y, 'plain');
  setRelation(state, state.home, them, 'war');
  station(state, 'infantry', ground);
  state.tick = CONFIG.war.conquerEvery;
  runMilitary(state);
  equal(ground.countryId, state.home, 'taken');

  // Tiles are dropped from the save and rebuilt from the seed, so this is the
  // case the claims diff exists for: without it the border would spring back.
  const loaded = rehydrate(JSON.parse(JSON.stringify(packState(state))));
  equal(loaded.tiles[ground.id].countryId, state.home,
    'the conquest is still there after a round trip');
});

// ---- the world raises armies -----------------------------------------------

test('a government raises an army out of its own warehouses, sized by its economy', () => {
  const state = fixture();
  const them = other(state);
  const seat = state.tiles.find((t) => t.countryId === them && t.terrain === 'plain');
  const depot = placeIn(state, them, 'warehouse', seat.x, seat.y, 'plain');
  for (const id of COMMODITY_IDS) depot.store[id] = 2000;
  // Bare ground beside the depot for the formations to muster on.
  for (let i = 1; i <= 4; i++) claim(state, them, seat.x + i, seat.y, 'plain');

  const target = armyTarget(state, them);
  assert(target >= CONFIG.army.min, 'every government wants at least a token force');
  assert(target <= CONFIG.army.max, 'and none of them wants an absurd one');

  equal(unitsOf(state, them).length, 0, 'it starts with nothing standing');
  for (let i = 0; i < 40; i++) { state.tick += CONFIG.stateArmyEvery; runStateMilitary(state); }
  const raised = unitsOf(state, them);
  assert(raised.length > 0, 'a stocked depot lets it field something');
  assert(raised.length <= target, `and it stops at what it wants (${raised.length} of ${target})`);
  for (const unit of raised) equal(unit.owner, them, 'everything it raised is its own');
});

test('a government with an empty depot buys its army in, and a broke one gets none', () => {
  const state = fixture();
  const them = other(state);
  const seat = state.tiles.find((t) => t.countryId === them && t.terrain === 'plain');
  placeIn(state, them, 'warehouse', seat.x, seat.y, 'plain');   // empty on purpose
  for (let i = 1; i <= 4; i++) claim(state, them, seat.x + i, seat.y, 'plain');

  // Broke and bare: nothing to draw on and nothing to pay with.
  state.countries[them].cash = 0;
  for (let i = 0; i < 20; i++) { state.tick += CONFIG.stateArmyEvery; runStateMilitary(state); }
  equal(unitsOf(state, them).length, 0, 'an empty treasury and an empty shelf field nothing');

  // Rich and bare: it buys the shortfall in, which is the whole point of the
  // treasury route — a nation with money is not a nation without an army.
  state.countries[them].cash = 50_000_000;
  for (let i = 0; i < 20; i++) { state.tick += CONFIG.stateArmyEvery; runStateMilitary(state); }
  const raised = unitsOf(state, them);
  assert(raised.length > 0, 'but money alone can field one');
  assert(state.countries[them].cash < 50_000_000, 'and it came out of the treasury');
  // Procurement is dear, so it buys the CHEAPEST formation rather than the best.
  const dearest = UNIT_IDS.slice().sort((a, b) => UNIT_TYPES[b].strength - UNIT_TYPES[a].strength)[0];
  equal(raised.some((u) => u.type === dearest), false,
    'a government paying cash buys riflemen, not aircraft');
});

test('a government mobilises while the ultimatum is still running, not after it', () => {
  const state = fixture();
  const them = other(state);
  const peace = armyTarget(state, them);
  equal(mobilising(state, them), false, 'nothing is coming yet');

  declareWar(state, state.home, them);
  // Early in the ultimatum it is still on a peacetime footing — the whole delay
  // is not spent under arms.
  equal(mobilising(state, them), false, 'a declaration alone does not mobilise anybody');
  equal(armyTarget(state, them), peace, 'so the army it wants is unchanged');

  // Wind the clock to `mobiliseAt` ticks before the fighting.
  state.tick += CONFIG.diplomacy.warDelay - CONFIG.diplomacy.mobiliseAt;
  equal(mobilising(state, them), true, 'with the deadline close it prepares');
  assert(armyTarget(state, them) >= peace, 'and wants a bigger army BEFORE a shot is fired');
  // The one being declared ON prepares too — it is the side that most needs to.
  equal(mobilising(state, state.home), true, 'both sides of a declaration mobilise');
});

test('a government at war wants a bigger army than one at peace', () => {
  const state = fixture();
  const them = other(state);
  const peace = armyTarget(state, them);
  equal(atWar(state, them), false, 'it is at peace to begin with');
  setRelation(state, them, state.home, 'war');
  equal(atWar(state, them), true, 'and now it is not');
  assert(armyTarget(state, them) >= peace, 'a war is a reason to raise more');
});

test('a defence weaker than the cell does not clear it', () => {
  const state = fixture();
  const camp = state.tiles.find((t) => t.countryId === state.home && t.terrain !== 'water');
  const depotTile = state.tiles.find((t) => t.countryId === state.home
    && t.terrain !== 'water' && t.id !== camp.id);
  place(state, 'warehouse', depotTile.x, depotTile.y, depotTile.terrain).store.food = 500;

  const active = {
    id: 'terror-test', name: 'ISIS cell', countryId: state.home,
    tileId: camp.id, x: camp.x, y: camp.y,
    infantry: CONFIG.terrorism.startInfantry, spawnedAt: 0, movedAt: 0, targetId: null, destroyed: 0,
  };
  active.strength = terroristStrength(active);
  state.terrorism.active = active;
  state.military.units.push({
    id: state.military.nextUnitId++, type: 'infantry', owner: state.home, domain: 'land',
    tileId: camp.id, x: camp.x, y: camp.y, strength: active.strength - 1, engaged: false,
  });

  runMilitary(state);
  assert(state.terrorism.active, 'an under-strength defence does not clear the presence');
});

test('a cell is announced a hundred ticks before it appears, and appears where it was announced', () => {
  const state = fixture();
  const warnAt = CONFIG.terrorism.firstAt - CONFIG.terrorism.warnBefore;
  for (let i = 0; i < warnAt - 1; i++) runTick(state);
  equal(state.terrorism.warning, null, 'nothing is announced before the warning window');
  equal(ticksToTerror(state), null, 'and there is no countdown to read');

  runTick(state);
  const warning = state.terrorism.warning;
  assert(warning, 'the warning goes up a hundred ticks out');
  equal(state.terrorism.active, null, 'and nothing is standing on the ground yet');
  equal(ticksToTerror(state), CONFIG.terrorism.warnBefore, 'the countdown starts at the full warning');
  assert(COUNTRIES[warning.countryId], `it names a real country (${warning.countryId})`);
  assert(state.tiles[warning.tileId], 'and a real tile');

  // The ground must not WANDER while the clock runs — the whole point is that
  // you can march somewhere before anything happens, and a target that moved
  // every tick would make that pointless.
  const half = Math.floor(CONFIG.terrorism.warnBefore / 2);
  for (let i = 0; i < half; i++) runTick(state);
  equal(state.terrorism.warning.tileId, warning.tileId, 'the announced ground does not move');
  equal(state.terrorism.warning.countryId, warning.countryId, 'nor does the country');
  equal(ticksToTerror(state), CONFIG.terrorism.warnBefore - half, 'and the countdown runs down');

  for (let i = 0; i < CONFIG.terrorism.warnBefore - half; i++) runTick(state);
  assert(state.terrorism.active, 'it appears when the clock runs out');
  equal(state.terrorism.active.countryId, warning.countryId, 'in the country it was announced for');
  equal(state.terrorism.active.tileId, warning.tileId, 'on the ground it was announced for');
  equal(state.terrorism.warning, null, 'and the warning is spent');
  equal(ticksToTerror(state), null, 'so there is no countdown left to read');

  // Defeating it clears the warning too — the next cell has not been chosen yet.
  defeatTerrorists(state);
  equal(state.terrorism.warning, null, 'a defeat leaves no stale warning behind');
});

test('terrorists spawn only after 600 ticks and never duplicate while active', () => {
  const state = fixture();
  for (let i = 0; i < 599; i++) runTick(state);
  equal(state.terrorism.active, null, 'no terrorists before tick 600');
  runTick(state);
  assert(state.terrorism.active, 'terrorists appear at tick 600');
  const first = state.terrorism.active.id;
  for (let i = 0; i < 220; i++) runTick(state);
  equal(state.terrorism.active.id, first, 'no second terrorist area appears while one is active');
  defeatTerrorists(state);
  equal(state.terrorism.active, null, 'defeat removes the active presence');
  for (let i = 0; i < 599; i++) runTick(state);
  equal(state.terrorism.active, null, 'respawn waits 600 more ticks after defeat');
  runTick(state);
  assert(state.terrorism.active, 'terrorists respawn after the cooldown');
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

// ---- what a nation can actually promise -----------------------------------

test('spare is what you MAKE less what you burn and your people want', () => {
  const state = fixture();
  // A coal mine and a coal plant: the mine digs it, the plant burns it, and the
  // difference is the only thing that could ever be promised abroad.
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  depot.store.coal = 9999;
  const before = spareRates(state, state.home).coal;
  place(state, 'coalMine', 21, 20, 'coalfield');
  const dug = spareRates(state, state.home).coal;
  assert(dug > before, 'digging coal adds to what you can spare');
  place(state, 'coalPlant', 22, 20, 'plain');
  const burnt = spareRates(state, state.home).coal;
  assert(burnt < dug, 'and burning it in your own plant takes it away again');
  // Stock is deliberately NOT part of it: the warehouse is full of coal
  // throughout, and the figure only moved when a RATE did.
  equal(depot.store.coal, 9999, 'the shelf is untouched by any of this');
});

// A neighbour whose power stations burn coal it cannot dig, and a home nation
// with `mines` collieries of its own. This is the shape of the whole rule: they
// want coal, and whether they are allowed to ask you for it depends on what you
// actually have left over — not on what happens to be in your warehouse.
function coalFixture(mines) {
  const state = fixture();
  const them = other(state);
  const depot = place(state, 'warehouse', 20, 20, 'plain');
  for (const id of COMMODITY_IDS) depot.store[id] = 4000;
  for (let i = 0; i < mines; i++) place(state, 'coalMine', 21 + i, 20, 'coalfield');
  const theirs = placeIn(state, them, 'warehouse', 24, 24, 'plain');
  for (const id of COMMODITY_IDS) theirs.store[id] = 4000;
  placeIn(state, them, 'coalPlant', 25, 24, 'plain');
  return state;
}

// Every offer the world puts to you over a dozen decision rounds.
function offersOver(state, rounds = 12) {
  const seen = [];
  for (let round = 1; round <= rounds; round++) {
    state.tick = CONFIG.contracts.every * round;
    state.contractOffers = [];
    runContractDiplomacy(state);
    seen.push(...state.contractOffers);
  }
  return seen;
}

test('nobody asks you for more coal than you can actually spare', () => {
  // With no colliery of your own you are a net CONSUMER of coal, and nobody
  // comes asking you for any however full the warehouse is — which is the whole
  // point: a warehouse is a one-off and a contract is a rate.
  const poor = coalFixture(0);
  assert(spareRates(poor, poor.home).coal <= 0, 'no mines means nothing to spare');
  equal(offersOver(poor).some((o) => o.dir === 'buy' && o.commodity === 'coal'), false,
    'so no contract to supply coal is ever put to you');

  // Dig six and the same neighbour comes asking — the path is live, and this is
  // what makes the assertion above mean something.
  const rich = coalFixture(6);
  const spare = spareRates(rich, rich.home);
  assert(spare.coal > 1, `six collieries leave a real surplus (${spare.coal.toFixed(1)}/tick)`);
  const buys = offersOver(rich).filter((o) => o.dir === 'buy');
  assert(buys.length > 0, 'a nation with a genuine surplus IS asked for it');
  assert(buys.some((o) => o.commodity === 'coal'), 'and asked for the thing it has a surplus of');
  for (const offer of buys) {
    const rate = offer.qty / offer.every;
    assert(rate <= (spare[offer.commodity] ?? 0) + 1e-6,
      `asked for ${rate.toFixed(2)} ${offer.commodity}/tick with only ${(spare[offer.commodity] ?? 0).toFixed(2)} spare`);
  }
});

test('a commodity you will not export is one nobody asks you for', () => {
  const state = coalFixture(6);
  assert(offersOver(state).some((o) => o.dir === 'buy'), 'they ask while the ↗ flag is on');

  for (const id of COMMODITY_IDS) state.exports[id] = false;
  equal(offersOver(state).some((o) => o.dir === 'buy'), false,
    'and stop the moment it is off — the flag is your policy, not just an exchange setting');

  // The mirror on the way in: ↙ off and nobody offers to sell you anything.
  const buyer = coalFixture(0);
  assert(offersOver(buyer).some((o) => o.dir === 'sell'), 'they offer to supply you while ↙ is on');
  for (const id of COMMODITY_IDS) buyer.imports[id] = false;
  equal(offersOver(buyer).some((o) => o.dir === 'sell'), false, 'and stop when it is off');
});

test('the world cannot sign a contract with you that you never agreed to', () => {
  const state = createInitialState();
  // Turn every flag off: nothing of yours is for sale on any channel, so the
  // only contracts you can end up in are ones you accepted by hand.
  for (const id of COMMODITY_IDS) { state.exports[id] = false; state.imports[id] = false; }
  for (let i = 0; i < 500; i++) runTick(state);
  const mine = (state.contracts ?? []).filter((c) => c.seller === state.home || c.buyer === state.home);
  equal(mine.length, 0,
    `a contract exists only because two governments agreed terms — found ${mine.length} you never signed`);
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
