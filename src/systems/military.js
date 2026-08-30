import { CONFIG } from '../core/config.js';
import { BUILDINGS } from '../data/buildings.js';
import { COMMODITIES } from '../data/commodities.js';
import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { isPlayer, noteLedger, pushAlert, noteEvent, setTileOwner } from '../core/state.js';
import { drawFrom, depotsByOwner, stockIn } from './logistics.js';
import { landOf } from './worldIndex.js';

export const RELATIONS = ['neutral', 'alliance', 'access', 'war'];
export const TERRORIST_NAMES = ['ISIS cell', 'Taliban cell', 'Insurgent camp'];

// Five formations, and what each one is MADE OF. A unit is not a building: it
// is raised by clicking ground you own with the unit in hand, and the batch it
// costs comes straight out of your warehouses.
//
// `cost` is that batch, and it is the ONLY thing a formation ever draws. Once it
// is standing it consumes nothing — no rations, no fuel, no running bill of any
// kind. An army here is CAPITAL you paid for in goods, not a subscription: the
// decision is whether you can afford to raise it, and that decision is taken
// once, at the moment you raise it.
//
// This file is the unit DATA exactly as buildings.js is the industry data: a
// quantity belongs here, never in the code that spends it, and no system reads
// a unit type by name.
//
// The spread across the five is the whole design, and it lives entirely in
// `cost` now:
//   infantry    — rations and nothing else. Any nation on earth can field one.
//   armoredCar  — iron and power, and a LITTLE fuel.
//   tank        — iron and power, and real fuel.
//   aircraft    — steel and power, and more fuel than anything else.
//   artillery   — a little food, copper and coal. No oil at all, which is what
//                 makes it the heavy weapon a poor nation can actually raise.
//
// `speed` and `range` are tiles, and they are what tell the five apart on the
// MAP rather than on the balance sheet. Speed is how many tiles a formation
// covers in one tick under a standing order; range is how far it can reach to
// fight from where it stands. Only artillery reaches past the ground it is on —
// everything else has to be right on top of what it is fighting — and that one
// asymmetry is what makes a gun worth dragging around. The wheeled car outruns
// the tank it is lighter than, and an aircraft crosses a continent in the time
// a rifleman crosses a field.
export const UNIT_TYPES = {
  infantry: {
    name: 'Infantry', glyph: '♟', domain: 'land', strength: 10, speed: 1, range: 1,
    cost: { food: 24 },
    blurb: 'Riflemen, raised on rations and nothing else, which is why anybody can field them. They march a tile a tick and fight what they can touch.',
  },
  armoredCar: {
    name: 'Armored Car', glyph: '⛝', domain: 'land', strength: 16, speed: 3, range: 1,
    cost: { ore: 24, power: 12, fuel: 6 },
    blurb: 'Wheeled and light. Iron and power to build, a fraction of a tank’s fuel, and three tiles a tick — the fastest thing you have on land.',
  },
  tank: {
    name: 'Tank', glyph: '⛞', domain: 'land', strength: 28, speed: 2, range: 1,
    cost: { ore: 48, power: 24, fuel: 24 },
    blurb: 'Iron, power and fuel by the tonne to build. The heaviest thing that moves on land, and it makes two tiles a tick.',
  },
  aircraft: {
    name: 'Aircraft', glyph: '✈', domain: 'air', strength: 34, speed: 20, range: 1,
    cost: { steel: 40, power: 30, fuel: 30 },
    blurb: 'Steel airframes at a price nothing else comes near. Twenty tiles a tick over anything you have access to — and it groups only with its own kind.',
  },
  artillery: {
    name: 'Artillery', glyph: '⁂', domain: 'land', strength: 22, speed: 1, range: 3,
    cost: { food: 10, copper: 18, coal: 24 },
    blurb: 'Guns and crews, built out of copper and coal rather than oil — the heavy weapon a poor nation can actually raise. Slow as a rifleman, and the only thing here that strikes three tiles away.',
  },
};

export const UNIT_IDS = Object.keys(UNIT_TYPES);

// What a formation makes good per tick once it is out of contact. There is no
// starvation counterpart any more: an army costs nothing to keep, so the only
// thing that can take strength off one is an enemy.
const RECOVERY = 0.5;

export function relationOf(state, a, b) {
  if (a === b) return 'self';
  return state.diplomacy?.relations?.[a]?.[b] ?? 'neutral';
}

export function setRelation(state, a, b, relation) {
  if (a === b || !RELATIONS.includes(relation)) return { ok: false, reason: 'Invalid relation.' };
  if (!state.diplomacy) state.diplomacy = { relations: {}, lastWarAt: -1 };
  if (!state.diplomacy.relations[a]) state.diplomacy.relations[a] = {};
  if (!state.diplomacy.relations[b]) state.diplomacy.relations[b] = {};
  state.diplomacy.relations[a][b] = relation;
  state.diplomacy.relations[b][a] = relation;
  if (relation === 'war') state.diplomacy.lastWarAt = state.tick;
  return { ok: true };
}

export function canMilitaryEnter(state, unit, tile) {
  if (!unit || !tile) return false;
  if (unit.domain === 'sea') return tile.terrain === 'water' || allowedLand(state, unit.owner, tile.countryId);
  if (unit.domain === 'air') return !tile.countryId || allowedLand(state, unit.owner, tile.countryId);
  return tile.terrain !== 'water' && allowedLand(state, unit.owner, tile.countryId);
}

// Is this particular square somewhere this formation could stand? Deliberately
// CHEAP: no warehouse is scanned, because the map asks it of every visible tile
// on every draw while a formation is in hand, and a depot scan per tile over a
// viewport that can be the whole planet is unaffordable. Whether the nation can
// pay for one is a separate question, asked once (`unitAffordable`).
export function deployableTile(state, owner, type, tile) {
  const def = UNIT_TYPES[type];
  if (!def || !tile) return false;
  if (tile.countryId !== owner || tile.buildingId != null) return false;
  return canMilitaryEnter(state, { owner, domain: def.domain }, tile);
}

// WHAT A FORMATION COSTS WHEN THE WAREHOUSES CANNOT COVER IT.
//
// A formation is made of goods, and drawing them out of your own depots is much
// the cheapest way to raise one. What this adds is the other route: whatever the
// depots are short of, the government BUYS IN — out of the treasury, at
// `CONFIG.army.cashMarkup` times the price. So a nation with a full treasury and
// an empty warehouse can still field an army, and pays through the nose for it.
//
// It is NOT a purchase from anybody. No contract is written, no border is
// crossed and no other country's stock moves: goods cross a border only under a
// contract, and this is not one. It is a government paying its own economy to
// procure, which is why nothing here touches `state.contracts`, `recordFlow` or
// another nation's depots.
//
// The price is the DEARER of the local market and the commodity's base — the
// same rule `marginPerTick` costs a plan's inputs by. A depressed home market is
// never a bargain, and a genuine shortage really does make procurement dearer.
export function unitShortfall(state, owner, type, depots = depotsByOwner(state).get(owner) ?? []) {
  const def = UNIT_TYPES[type];
  if (!def) return { short: {}, cash: 0 };
  const short = {};
  let cash = 0;
  for (const [commodity, qty] of Object.entries(def.cost)) {
    const missing = qty - stockIn(depots, commodity);
    if (missing <= 1e-9) continue;
    short[commodity] = missing;
    cash += missing * procurementPrice(state, owner, commodity);
  }
  return { short, cash: Math.round(cash) };
}

function procurementPrice(state, owner, commodityId) {
  const local = state.markets?.[owner]?.[commodityId]?.price ?? 0;
  return Math.max(local, COMMODITIES[commodityId].basePrice) * CONFIG.army.cashMarkup;
}

// ...and the half that costs a scan, asked once per render rather than once per
// tile. The depot index is passed in wherever the caller already has one.
// "Affordable" now means stock OR treasury, since either can pay for a unit.
export function unitAffordable(state, owner, type, depots = depotsByOwner(state).get(owner) ?? []) {
  const def = UNIT_TYPES[type];
  if (!def) return false;
  const { cash } = unitShortfall(state, owner, type, depots);
  return cash <= 0 || (state.countries[owner]?.cash ?? 0) >= cash;
}

// Whether the warehouses alone could do it — what the build dock uses to tell
// "you have this" from "you would have to buy it in", which are worth showing
// differently because one of them is far dearer.
export function unitInStock(state, owner, type, depots = depotsByOwner(state).get(owner) ?? []) {
  return UNIT_TYPES[type] ? unitShortfall(state, owner, type, depots).cash <= 0 : false;
}

// "May I raise this here, and can I pay for it?" — the authoritative answer,
// asked once when a tile is actually clicked. It mutates nothing, so the panel
// can use it to explain a refusal before anything has happened.
export function canDeployUnit(state, owner, type, tile) {
  const def = UNIT_TYPES[type];
  if (!def) return { ok: false, reason: 'Unknown formation.' };
  if (!tile) return { ok: false, reason: 'No such tile.' };
  if (!tile.countryId) return { ok: false, reason: 'Unclaimed territory — no government here.' };
  if (tile.countryId !== owner) {
    return { ok: false, reason: `${COUNTRIES[tile.countryId]?.name ?? tile.countryId} is foreign soil — units muster at home.` };
  }
  if (tile.buildingId != null) return { ok: false, reason: 'Tile is already occupied.' };
  if (unitOnTile(state, tile.id)) return { ok: false, reason: 'A formation already holds that ground.' };
  if (!deployableTile(state, owner, type, tile)) return { ok: false, reason: `${def.name} cannot deploy there.` };
  // A depot is no longer required. What the warehouses cannot supply the
  // treasury buys in, so a nation with money and an empty shelf can still field
  // something — it simply pays a great deal more for it.
  const depots = depotsByOwner(state).get(owner) ?? [];
  const { short, cash } = unitShortfall(state, owner, type, depots);
  if (cash > 0 && (state.countries[owner]?.cash ?? 0) < cash) {
    const missing = Object.keys(short).map((id) => COMMODITIES[id].name).join(' and ');
    return { ok: false, reason: `Short of ${missing} — buying it in would cost ${money(cash)}, more than the treasury holds.` };
  }
  return { ok: true, cash };
}

export function createMilitaryUnit(state, owner, type, tileId) {
  ensureMilitary(state);
  const tile = state.tiles[tileId];
  const check = canDeployUnit(state, owner, type, tile);
  if (!check.ok) return check;
  const def = UNIT_TYPES[type];
  const depots = depotsByOwner(state).get(owner) ?? [];
  // Priced BEFORE anything is drawn, or the shortfall would be measured against
  // warehouses this very call has just emptied.
  const { cash } = unitShortfall(state, owner, type, depots);
  for (const [commodity, qty] of Object.entries(def.cost)) {
    const taken = drawFrom(depots, commodity, qty);
    if (isPlayer(state, owner)) noteLedger(state, commodity, 'used', taken);
  }
  // ...and whatever the shelves could not cover is bought in out of the
  // treasury. Nothing crosses a border to do it — see `unitShortfall`.
  if (cash > 0 && state.countries[owner]) state.countries[owner].cash -= cash;
  const created = {
    id: state.military.nextUnitId++,
    type,
    owner,
    domain: def.domain,
    tileId,
    x: tile.x,
    y: tile.y,
    strength: def.strength,
    // Whether it was in contact last tick. A formation under fire does not
    // make its losses good, which is what keeps a war decisive.
    engaged: false,
    // Where it has been told to go, and who it marches with. Both are plain
    // JSON — a tile index and a number — because everything on `state` has to
    // round-trip through the save.
    orderTileId: null,
    groupId: null,
  };
  state.military.units.push(created);
  noteEvent(state, 'army', owner, { what: type, qty: cash });
  return { ok: true, unit: created, cash };
}

// An ORDER, not a teleport. A formation no longer arrives the moment you point
// at the map: the destination is written down and `advanceUnits` walks it there
// at `speed` tiles a tick during the security phase, so distance is a real cost
// and an aircraft crossing a continent is genuinely different from infantry
// crossing a field.
//
// A unit in a GROUP takes its group with it: every member is given the same
// destination and the whole formation moves at its slowest member's pace, which
// is what "together" means. That is the one thing group membership does.
export function moveMilitaryUnit(state, unitId, tileId) {
  ensureMilitary(state);
  const unit = state.military.units.find((u) => u.id === unitId);
  const tile = state.tiles[tileId];
  if (!unit || !tile) return { ok: false, reason: 'Invalid movement order.' };
  if (!canMilitaryEnter(state, unit, tile)) return { ok: false, reason: 'No military access.' };
  const ordered = [];
  for (const member of groupOf(state, unit)) {
    // A group is one domain by construction, so if the leader may stand there
    // so may everybody — but this is the authoritative place for the question
    // and the check is cheap.
    if (!canMilitaryEnter(state, member, tile)) continue;
    member.orderTileId = tileId;
    // A player-issued destination always replaces a sweep order. Otherwise a
    // redirected unit would quietly resume annexing when it arrived.
    member.autoConquerCountryId = null;
    member.autoConquerTargetId = null;
    member.autoConquerSkipped = null;
    member.autoConquerClosest = null;
    member.autoConquerStalled = null;
    // A new order is judged on its own: forget how close the LAST one came.
    member.closest = null;
    member.stalled = 0;
    member.trail = [];
    // Where this march STARTED, so the step rule can follow the sight-line from
    // here to there rather than any of the equally-short dog-legs.
    member.fromX = member.x;
    member.fromY = member.y;
    ordered.push(member);
  }
  return { ok: true, unit, ordered };
}

// A CAMPAIGN ORDER: march at the nearest enemy and keep taking its ground, one
// tile a security phase, until there is none of it left to take.
//
// The one condition is that an ENEMY EXISTS — somebody this formation's
// government is actually at war with, who still holds land. It used to also
// require that enemy to have no formations left, which made this a tidying-up
// order for a war already won and nothing else; the fighting is the half a
// player most wants automated, and it needs no rule of its own to get it. A
// formation that walks into a defended country is fought by whatever it walks
// into: `resolveWarCombat` triggers on proximity plus a relation of `war` and
// has never taken an attack order, so "march at the enemy and take its ground"
// IS "attack the enemy", with no second code path for the shooting.
//
// It is LAND-only, because an aircraft occupies nothing (`takeGround`), and it
// only ever begins on an explicit order — yours, or none.
export function canAutoConquer(state, unit, countryId = null) {
  if (!unit || !state.military?.units?.includes(unit)) return { ok: false, reason: 'No such formation.' };
  if ((UNIT_TYPES[unit.type]?.domain ?? unit.domain) !== 'land') return { ok: false, reason: 'Only land formations can occupy territory.' };
  const enemies = enemiesOf(state, unit.owner);
  if (countryId && !enemies.includes(countryId)) return { ok: false, reason: 'You are not at war with them, or they have no land left.' };
  if (!enemies.length) return { ok: false, reason: 'No enemy at war has land left to take.' };
  return { ok: true, enemies };
}

// Everybody this government is at war with who still holds ground. It is the
// whole gate on an automatic campaign, and the reason one cannot be started in
// peacetime by any route — the panel asks it to decide whether to show the
// button, and the order asks it again before it writes anything.
export function enemiesOf(state, owner) {
  return Object.keys(state.countries ?? {}).filter((id) =>
    id !== owner && relationOf(state, owner, id) === 'war' && hasLand(state, id));
}

export function startAutoConquest(state, unitId, countryId = null) {
  ensureMilitary(state);
  const unit = state.military.units.find((u) => u.id === unitId);
  const picked = pickCampaignTarget(state, unit, countryId);
  if (!picked.ok) return picked;
  const target = picked.countryId;
  unit.orderTileId = null;
  unit.closest = null;
  unit.stalled = 0;
  unit.trail = [];
  unit.autoConquerCountryId = target;
  unit.autoConquerTargetId = null;
  unit.autoConquerSkipped = [];
  unit.autoConquerClosest = null;
  unit.autoConquerStalled = 0;
  return { ok: true, unit, countryId: target };
}

// ...and calling one off, which is the same button pressed a second time. It
// is deliberately a separate entry point rather than a toggle inside
// `startAutoConquest`: "stop" has to work on a formation whose campaign the
// system has already ended for it, and a toggle would restart that one instead.
export function cancelAutoConquest(state, unitId) {
  ensureMilitary(state);
  const unit = state.military.units.find((u) => u.id === unitId);
  if (!unit) return { ok: false, reason: 'No such formation.' };
  if (!unit.autoConquerCountryId) return { ok: false, reason: 'That formation is not campaigning.' };
  const countryId = unit.autoConquerCountryId;
  // Announced by the caller, not here: the alert for an order you gave says
  // something different from the one for a campaign that ran out of ground.
  stopAutoConquest(state, unit, 'called off', false);
  return { ok: true, unit, countryId };
}

// WHICH ENEMY THIS FORMATION MARCHES AT: the nearest one it is at war with
// that still holds land, unless one was named. It is one function because it is
// asked in two places — when the order is given, and again whenever a campaign
// runs its target country out of ground — and the two must not disagree about
// what an enemy is.
function pickCampaignTarget(state, unit, countryId = null) {
  const check = canAutoConquer(state, unit, countryId);
  if (!check.ok) return check;
  if (countryId) return { ok: true, countryId };
  const nearest = check.enemies.reduce((best, id) => {
    const distance = nearestEnemyLandDistance(state, unit, id);
    return distance < best.distance ? { id, distance } : best;
  }, { id: check.enemies[0], distance: Infinity });
  return { ok: true, countryId: nearest.id };
}

export function disbandUnit(state, unitId) {
  ensureMilitary(state);
  const before = state.military.units.length;
  const unit = state.military.units.find((u) => u.id === unitId);
  state.military.units = state.military.units.filter((u) => u.id !== unitId);
  if (unit?.groupId != null) dissolveIfAlone(state, unit.groupId);
  return before === state.military.units.length ? { ok: false, reason: 'No such unit.' } : { ok: true };
}

// --- groups ---------------------------------------------------------------
//
// A group is a `groupId` on each member and NOTHING else — no object, no list,
// no `Map` — so it rides along in the save exactly like a contract does. What
// it buys is one thing: an order given to any member is given to all of them,
// at the pace of the slowest, so a mixed column arrives as a column.
//
// Who may stand together is decided by DOMAIN, which is what makes "land units
// group with land units, aircraft only with aircraft" ONE rule rather than two:
// aircraft are the only air formation there is, so "same domain" says both. A
// group is also one government's — two nations' armies are not one army however
// friendly they are.
export function canGroup(a, b) {
  if (!a || !b || a.id === b.id) return false;
  if (a.owner !== b.owner) return false;
  return domainOf(a) === domainOf(b);
}

export function groupMembers(state, groupId) {
  if (groupId == null) return [];
  return (state.military?.units ?? []).filter((u) => u.groupId === groupId);
}

// The formations that move when this one is ordered: its group, or just itself.
export function groupOf(state, unit) {
  if (!unit) return [];
  return unit.groupId == null ? [unit] : groupMembers(state, unit.groupId);
}

// The pace a group actually moves at: its SLOWEST member. Moving together at
// the fastest member's speed would not be moving together — it would be the
// armoured cars arriving alone and the guns turning up long after.
export function groupSpeed(state, groupId) {
  const members = groupMembers(state, groupId);
  if (!members.length) return 1;
  return members.reduce((slowest, u) => Math.min(slowest, speedOf(u)), Infinity);
}

// Put two formations in one group. Either or both may already be grouped, in
// which case the two merge — there is no leader, so nothing has to be decided
// beyond which id survives.
export function joinGroup(state, unitId, otherId) {
  ensureMilitary(state);
  const a = state.military.units.find((u) => u.id === unitId);
  const b = state.military.units.find((u) => u.id === otherId);
  if (!a || !b) return { ok: false, reason: 'No such formation.' };
  if (a.id === b.id) return { ok: false, reason: 'A formation cannot group with itself.' };
  if (a.owner !== b.owner) return { ok: false, reason: 'That formation belongs to another government.' };
  if (!canGroup(a, b)) {
    return { ok: false, reason: 'Aircraft group only with aircraft — air and land do not march together.' };
  }
  if (a.groupId != null && a.groupId === b.groupId) {
    return { ok: false, reason: 'Those formations are already grouped.' };
  }
  const groupId = a.groupId ?? b.groupId ?? state.military.nextGroupId++;
  const joining = b.groupId != null ? groupMembers(state, b.groupId) : [b];
  for (const member of [a, ...joining]) member.groupId = groupId;
  return { ok: true, groupId, size: groupMembers(state, groupId).length };
}

export function leaveGroup(state, unitId) {
  ensureMilitary(state);
  const unit = state.military.units.find((u) => u.id === unitId);
  if (!unit) return { ok: false, reason: 'No such formation.' };
  if (unit.groupId == null) return { ok: false, reason: 'That formation is not in a group.' };
  const groupId = unit.groupId;
  unit.groupId = null;
  dissolveIfAlone(state, groupId);
  return { ok: true };
}

// A group of one is not a group. Dropping the last companion clears the id
// rather than leaving a formation flagged as part of something that no longer
// exists — the panel reads `groupId` directly, so a stale one would lie.
function dissolveIfAlone(state, groupId) {
  const left = groupMembers(state, groupId);
  if (left.length === 1) left[0].groupId = null;
}

export function speedOf(unit) {
  return UNIT_TYPES[unit?.type]?.speed ?? 1;
}

// How far this formation can reach to fight from where it stands, in tiles.
// One for everything that has to be on top of what it is fighting; three for
// the guns, which is the only reason to drag them anywhere.
export function rangeOf(unit) {
  return UNIT_TYPES[unit?.type]?.range ?? 1;
}

function domainOf(unit) {
  return UNIT_TYPES[unit?.type]?.domain ?? unit?.domain;
}

export function unitsOf(state, owner) {
  return (state.military?.units ?? []).filter((u) => u.owner === owner);
}

export function unitOnTile(state, tileId) {
  return (state.military?.units ?? []).find((u) => u.tileId === tileId) ?? null;
}

// What a nation's standing army COST it, by commodity — the batches that raised
// every formation it has. The build dock shows it, so raising another squadron
// is a decision taken with the bill already spent in view. It is a total, not a
// rate: a formation draws its cost once and nothing afterwards.
export function armyCostOf(state, owner) {
  const bill = {};
  for (const unit of unitsOf(state, owner)) {
    for (const [commodity, qty] of Object.entries(UNIT_TYPES[unit.type]?.cost ?? {})) {
      bill[commodity] = (bill[commodity] ?? 0) + qty;
    }
  }
  return bill;
}

export function runMilitary(state) {
  ensureMilitary(state);
  reorganise(state);
  // Marching happens BEFORE the fighting, so a column that closed the last
  // tiles this tick gets to use them: an order given ten ticks ago arrives and
  // engages in the same tick it arrives, rather than standing in front of the
  // camp for one tick doing nothing. Supply is drawn first either way — a
  // formation eats whether it marched or not.
  advanceUnits(state);
  // ...then the shooting. Formations first, sites second: an army has to be
  // beaten before the industry behind it can be wrecked, which is what makes
  // covering your own factories worth doing.
  resolveWarCombat(state);
  raidEnemySites(state);
  // Ground changes hands only after the fighting on it has been resolved, so a
  // formation cannot take a tile on the tick it is destroyed.
  conquerGround(state);
  // Your own army then gets first say over the cell: a force in range resolves
  // the fight before the cell can spawn a replacement or take another step, so
  // a defeat this tick truly ends it this tick.
  resolveTerrorCombat(state);
  warnTerrorists(state);
  spawnTerrorists(state);
  runTerrorists(state);
}

// WHAT A WAR ACTUALLY DOES, half one.
//
// Every formation within its own `range` of an enemy formation takes strength
// off it, at `CONFIG.war.damage` of the attacker's own strength. Both sides fire
// in the same pass off the SAME snapshot of strengths, so who is listed first in
// `state.military.units` cannot decide a battle — the same determinism argument
// that puts `collect` before `produce`.
//
// Only `war` counts. An alliance, an access agreement and a plain neutral
// border are all peace here: two formations standing on the same tile in
// peacetime simply stand there.
function resolveWarCombat(state) {
  const units = state.military.units;
  // A lone survivor is not in contact with anything, and `engaged` has to say
  // so — left standing from the tick its enemy died, it would block that unit
  // from ever making its losses good again.
  if (units.length < 2) {
    for (const unit of units) unit.engaged = false;
    return;
  }
  // Bucketed by tile block, so this is not every unit against every other. The
  // block is the longest range in the game, which is what makes three
  // neighbouring buckets enough to find everything in reach.
  const reach = maxRange();
  const buckets = new Map();
  for (const unit of units) {
    const bx = Math.floor(unit.x / reach);
    const by = Math.floor(unit.y / reach);
    const key = `${bx},${by}`;
    const list = buckets.get(key);
    if (list) list.push(unit); else buckets.set(key, [unit]);
  }
  const damage = new Map();
  for (const unit of units) {
    const range = rangeOf(unit);
    const bx = Math.floor(unit.x / reach);
    const by = Math.floor(unit.y / reach);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (const foe of buckets.get(`${bx + ox},${by + oy}`) ?? []) {
          if (foe.owner === unit.owner) continue;
          if (relationOf(state, unit.owner, foe.owner) !== 'war') continue;
          if (Math.max(Math.abs(foe.x - unit.x), Math.abs(foe.y - unit.y)) > range) continue;
          damage.set(foe.id, (damage.get(foe.id) ?? 0) + unit.strength * CONFIG.war.damage);
        }
      }
    }
  }
  // Being in contact is remembered, because `reorganise` has to know about it
  // NEXT tick: a formation under fire does not make its losses good. Without
  // that rule it recovers half a point a tick, damage falls away with the
  // strength doing it, and two even forces settle into a permanent stalemate at
  // half strength — a war nobody can win or lose.
  for (const unit of units) unit.engaged = damage.has(unit.id);
  if (!damage.size) return;
  const lost = [];
  for (const unit of units) {
    const hit = damage.get(unit.id);
    if (!hit) continue;
    unit.strength -= hit;
    // ...and a formation broken past `breakAt` is gone rather than lingering at
    // a hundredth of a point: damage is a share of the attacker's strength, so
    // without a break point the two sides decay toward zero and never arrive.
    if (unit.strength <= (UNIT_TYPES[unit.type]?.strength ?? 1) * CONFIG.war.breakAt) lost.push(unit);
  }
  if (!lost.length) return;
  state.military.units = units.filter((u) => !lost.includes(u));
  for (const unit of lost) {
    if (unit.groupId != null) dissolveIfAlone(state, unit.groupId);
    if (!isPlayer(state, unit.owner)) continue;
    pushAlert(state, `${UNIT_TYPES[unit.type].name} at (${unit.x}, ${unit.y}) was destroyed in action.`, 'danger');
  }
}

// WHAT A WAR ACTUALLY DOES, half two: it costs the loser its INDUSTRY.
//
// A formation standing on or beside an enemy site wrecks it every
// `CONFIG.war.raidEvery` ticks — the same cadence, and the same "adjacent
// counts as arrived" rule, as a terrorist cell reaching a factory. That is the
// only reason a government would ever sue for peace, and the only thing that
// makes taking ground worth the supply bill.
function raidEnemySites(state) {
  if (state.tick % CONFIG.war.raidEvery !== 0) return;
  if (!state.military.units.length) return;
  const wrecked = new Set();
  const byTile = new Map();
  for (const b of state.buildings) byTile.set(b.tileId, b);
  const w = state.grid.w;
  for (const unit of state.military.units) {
    const range = rangeOf(unit);
    for (let oy = -range; oy <= range; oy++) {
      for (let ox = -range; ox <= range; ox++) {
        const x = unit.x + ox;
        const y = unit.y + oy;
        if (x < 0 || y < 0 || x >= w || y >= state.grid.h) continue;
        const site = byTile.get(y * w + x);
        if (!site || wrecked.has(site.id)) continue;
        if (site.owner === unit.owner) continue;
        if (relationOf(state, unit.owner, site.owner) !== 'war') continue;
        wrecked.add(site.id);
        if (isPlayer(state, site.owner)) {
          pushAlert(state, `${BUILDINGS[site.type].name} at (${site.x}, ${site.y}) was destroyed by ${COUNTRIES[unit.owner]?.name ?? unit.owner}.`, 'danger');
        } else if (isPlayer(state, unit.owner)) {
          pushAlert(state, `Your forces wrecked a ${BUILDINGS[site.type].name} in ${COUNTRIES[site.owner]?.name ?? site.owner}.`, 'good');
        }
      }
    }
  }
  if (!wrecked.size) return;
  state.buildings = state.buildings.filter((b) => {
    if (!wrecked.has(b.id)) return true;
    const tile = state.tiles[b.tileId];
    if (tile) tile.buildingId = null;
    return false;
  });
}

// TAKING GROUND — the third thing a war does, and the only one that is
// permanent.
//
// A LAND formation standing on the soil of a country it is at war with takes the
// tile it is standing on, every `CONFIG.war.conquerEvery` ticks. Just the tile
// under it: an army has to physically occupy ground to hold it, which is what
// makes a war a march rather than a button.
//
// **Aircraft take nothing.** They overfly everything and hold nothing, which is
// why `domain` is checked rather than `range` — an aircraft parked on a tile is
// not an occupation. That is the one asymmetry in this function and it is the
// whole reason a nation still needs infantry.
//
// A tile that changes hands takes whatever is built on it (`setTileOwner`),
// because `building.owner` is also the country the site stands in. And a nation
// that loses its LAST tile is finished — see `eliminate`.
function conquerGround(state) {
  if (state.tick % CONFIG.war.conquerEvery !== 0) return;
  if (!state.military.units.length) return;
  // Ground crossed is taken as it is crossed (`advanceUnits`), so what is left
  // for this pass is the formation that is NOT marching: one that was already
  // standing on foreign soil when the war broke out, or one that has arrived and
  // stopped. The cadence is what stops that being instant.
  for (const unit of state.military.units) {
    if (unit.orderTileId != null) continue;
    takeGround(state, unit, state.tiles[unit.tileId]);
  }
}

export function hasLand(state, countryId) {
  return state.tiles.some((tile) => tile.countryId === countryId && tile.terrain !== 'water');
}

// A NATION CONQUERED OUT OF EXISTENCE. It owns no ground, so it has no industry,
// no people, no treasury and no say in anything ever again: `alive` is false,
// `canTrade` refuses it, and every decision loop in the world skips it.
//
// Everything it still held is cleared here rather than left for other systems to
// trip over — its formations disband, its contracts are torn up, its listings
// come off the book. Its BUILDINGS are not touched, because they already changed
// hands tile by tile with the ground they stand on.
// A conquered nation is not still at war with anybody, and the relation table is
// what the topbar's Standing, the Diplomacy head and all 257 rows read — so a
// `war` left standing against a country that no longer exists is a war you can
// neither fight nor end. That is exactly what happened: the annexation alert
// arrived, the people and the treasury changed hands, and the header still said
// "At war (1)" against a nation with no ground left on the map.
//
// The pair-keyed tables that hang off a relation go with it. They are sparse on
// purpose (see the note on `state.diplomacy` in CLAUDE.md), so leaving a dead
// government's rows behind is save-file weight that can never be read again.
function forgetRelations(state, countryId) {
  const d = state.diplomacy;
  if (!d) return;
  const relations = d.relations ?? {};
  for (const other of Object.keys(relations[countryId] ?? {})) {
    const row = relations[other];
    if (!row) continue;
    delete row[countryId];
    if (!Object.keys(row).length) delete relations[other];
  }
  delete relations[countryId];

  // Opinion is ASYMMETRIC and sparse, so somebody may hold a view of this
  // government without it holding one of them: every row has to be swept, not
  // only the pairs the relation table happened to know about.
  const opinion = d.opinion ?? {};
  for (const other of Object.keys(opinion)) {
    if (other === countryId) continue;
    const row = opinion[other];
    delete row[countryId];
    if (!Object.keys(row).length) delete opinion[other];
  }
  delete opinion[countryId];

  // ...and the cooldowns, which are keyed on the pair in either order.
  for (const k of Object.keys(d.history ?? {})) {
    const [a, b] = k.split('|');
    if (a === countryId || b === countryId) delete d.history[k];
  }
}

export function eliminate(state, countryId, victor = null) {
  const gov = state.countries[countryId];
  if (!gov || gov.alive === false) return false;
  // THE SPOILS. A nation conquered by another does not simply stop existing —
  // everything it had passes to whoever took it: the treasury, the people, and
  // the economy they were part of. Its INDUSTRY has already changed hands tile
  // by tile with the ground (`setTileOwner`), so what is left to move here is
  // what was never on the map.
  //
  // There is no victor when a terrorist cell took the last ground, and then
  // nothing is inherited: a cell is not a government and cannot annex anything.
  const to = victor && victor !== countryId ? state.countries[victor] : null;
  if (to) {
    to.cash += Math.max(0, gov.cash);
    to.pop = (to.pop ?? 0) + (gov.pop ?? 0);
    to.demand = (to.demand ?? 0) + (gov.demand ?? 0);
    // Anything still on its books — a site whose ground somebody else took, or
    // one the map lost track of — goes with the rest rather than lingering
    // owned by a government that no longer exists.
    for (const b of state.buildings) if (b.owner === countryId) b.owner = victor;
    noteEvent(state, 'annexed', victor, { about: countryId, qty: Math.round(Math.max(0, gov.cash)) });
    if (isPlayer(state, victor)) {
      pushAlert(state, `${COUNTRIES[countryId]?.name ?? countryId} is annexed — its treasury, people and industry are yours.`, 'good');
    }
  }
  gov.alive = false;
  gov.solvent = false;
  gov.cash = 0;
  gov.demand = 0;
  gov.pop = 0;
  gov.debt = 0;
  gov.researching = null;
  state.military.units = state.military.units.filter((u) => u.owner !== countryId);
  state.contracts = (state.contracts ?? []).filter((c) => c.seller !== countryId && c.buyer !== countryId);
  state.contractOffers = (state.contractOffers ?? []).filter((o) => o.from !== countryId);
  if (state.exchange?.listings) {
    state.exchange.listings = state.exchange.listings.filter((l) => l.from !== countryId);
  }
  if (state.diplomacy) {
    state.diplomacy.proposals = (state.diplomacy.proposals ?? [])
      .filter((p) => p.from !== countryId && p.to !== countryId);
    state.diplomacy.ultimatums = (state.diplomacy.ultimatums ?? [])
      .filter((u) => u.from !== countryId && u.to !== countryId);
  }
  forgetRelations(state, countryId);
  noteEvent(state, 'conquered', countryId);
  pushAlert(state, isPlayer(state, countryId)
    ? `${COUNTRIES[countryId]?.name ?? countryId} — your nation — has been conquered. It no longer exists.`
    : `${COUNTRIES[countryId]?.name ?? countryId} has been conquered out of existence.`,
  isPlayer(state, countryId) ? 'danger' : 'warn');
  return true;
}

// The longest reach any formation has. Read from the DATA rather than written
// down, so adding a longer-ranged unit cannot leave the combat buckets quietly
// too small to find it.
function maxRange() {
  return UNIT_IDS.reduce((most, id) => Math.max(most, UNIT_TYPES[id].range ?? 1), 1);
}

// Standing orders, walked one tile at a time. A formation covers up to `speed`
// tiles a tick — or, if it marches with a group, up to the group's slowest
// member's — which is what turns "go there" from a teleport into a journey you
// can watch and intercept.
//
// The step is greedy rather than a search: diagonal toward the goal, then the
// horizontal half, then the vertical half. There is no A* here on purpose —
// pathfinding across a million tiles for every formation on the planet is not
// affordable, and a column that walks into a coastline and stops is a legible
// outcome rather than a bug. A unit that cannot take a single step gives its
// order up rather than shuffling against the same obstacle for ever.
function advanceUnits(state) {
  const units = state.military.units;
  if (!units.length) return;
  advanceAutoConquests(state, units);
  // Group paces are worked out ONCE for the world rather than per member, for
  // the same reason depots are indexed once: a hundred grouped formations must
  // not each walk the whole army looking for their companions.
  const pace = new Map();
  for (const unit of units) {
    if (unit.groupId == null) continue;
    const speed = speedOf(unit);
    const slowest = pace.get(unit.groupId);
    if (slowest == null || speed < slowest) pace.set(unit.groupId, speed);
  }
  const w = state.grid.w;
  for (const unit of units) {
    if (unit.autoConquerCountryId) continue;
    if (unit.orderTileId == null) continue;
    const goal = state.tiles[unit.orderTileId];
    if (!goal) { unit.orderTileId = null; continue; }
    const steps = unit.groupId != null ? (pace.get(unit.groupId) ?? speedOf(unit)) : speedOf(unit);
    let moved = false;
    for (let i = 0; i < steps; i++) {
      if (unit.x === goal.x && unit.y === goal.y) break;
      const next = stepToward(state, unit, goal, w);
      if (!next) break;
      remember(unit, unit.tileId);
      unit.x = next.x;
      unit.y = next.y;
      unit.tileId = next.id;
      moved = true;
      // GROUND IS TAKEN AS IT IS CROSSED, not only where the march happens to
      // stop. An army that walked through five tiles of enemy country has been
      // in five tiles of enemy country — leaving them behind meant a unit could
      // march the length of a nation and take the one tile it was standing on
      // when the conquest cadence next came round.
      takeGround(state, unit, next);
    }
    if (unit.x === goal.x && unit.y === goal.y) { arrive(unit); continue; }
    if (!moved) { giveUp(state, unit, 'the way on is closed'); continue; }

    // MAKING PROGRESS, OR ONLY MOVING? The step rule walks round obstacles by
    // sidestepping, which is what gets a column along a coastline — and it is
    // also what lets one circle an unreachable target for ever. So the march is
    // judged on the closest it has ever come: if that has not improved in
    // `CONFIG.war.giveUpAfter` ticks, the destination is not reachable from here
    // and the order is abandoned.
    //
    // The case is real and ordinary: the far side of Turkey is an ISLAND, and a
    // rifleman ordered there walked the length of the country and then shuffled
    // on the beach opposite it forever.
    const away = Math.max(Math.abs(goal.x - unit.x), Math.abs(goal.y - unit.y));
    if (unit.closest == null || away < unit.closest) { unit.closest = away; unit.stalled = 0; }
    else if ((unit.stalled = (unit.stalled ?? 0) + 1) > CONFIG.war.giveUpAfter) {
      // Remembered, so the government that ordered it does not send the same
      // formation at the same unreachable place on its very next decision.
      unit.unreachable = goal.id;
      giveUp(state, unit, 'there is no way through to it');
    }
  }
}

// This is still a real march: every selected formation moves only ONE tile per
// tick, and `takeGround` records each tile it crosses. Its target refreshes
// after capture, so it visits all reachable land rather than stopping once.
function advanceAutoConquests(state, units) {
  for (const unit of units) {
    let countryId = unit.autoConquerCountryId;
    if (!countryId) continue;
    // FINISHING ONE ENEMY IS NOT FINISHING THE WAR. A campaign whose target has
    // been annexed, or has made peace, moves on to the next enemy that still
    // holds land rather than ending — otherwise the last tile of a country
    // silently stood the whole army down and the war carried on without it.
    if (!canAutoConquer(state, unit, countryId).ok) {
      const next = pickCampaignTarget(state, unit);
      if (!next.ok) { stopAutoConquest(state, unit, next.reason); continue; }
      countryId = unit.autoConquerCountryId = next.countryId;
      unit.autoConquerTargetId = null;
      unit.autoConquerSkipped = [];
      unit.autoConquerClosest = null;
      unit.autoConquerStalled = 0;
    }
    let goal = state.tiles[unit.autoConquerTargetId];
    if (!goal || goal.countryId !== countryId || goal.terrain === 'water') {
      goal = nearestAutoConquestTile(state, unit, countryId);
      unit.autoConquerTargetId = goal?.id ?? null;
      unit.autoConquerClosest = goal ? Math.max(Math.abs(goal.x - unit.x), Math.abs(goal.y - unit.y)) : null;
      unit.autoConquerStalled = 0;
      unit.trail = [];
      unit.fromX = unit.x;
      unit.fromY = unit.y;
    }
    if (!goal) { stopAutoConquest(state, unit, 'no reachable enemy land remains'); continue; }
    if (unit.tileId === goal.id) {
      takeGround(state, unit, goal);
      unit.autoConquerTargetId = null;
      continue;
    }
    const next = stepToward(state, unit, goal, state.grid.w);
    if (!next) {
      unit.autoConquerSkipped = [...new Set([...(unit.autoConquerSkipped ?? []), goal.id])];
      unit.autoConquerTargetId = null;
      continue;
    }
    remember(unit, unit.tileId);
    unit.x = next.x;
    unit.y = next.y;
    unit.tileId = next.id;
    takeGround(state, unit, next);
    if (next.id === goal.id) {
      unit.autoConquerTargetId = null;
      continue;
    }
    const away = Math.max(Math.abs(goal.x - unit.x), Math.abs(goal.y - unit.y));
    if (away < (unit.autoConquerClosest ?? Infinity)) {
      unit.autoConquerClosest = away;
      unit.autoConquerStalled = 0;
    } else if ((unit.autoConquerStalled = (unit.autoConquerStalled ?? 0) + 1) > CONFIG.war.giveUpAfter) {
      unit.autoConquerSkipped = [...new Set([...(unit.autoConquerSkipped ?? []), goal.id])];
      unit.autoConquerTargetId = null;
    }
  }
}

// BOTH OF THESE ASK "WHERE IS THAT COUNTRY", AND BOTH GO THROUGH `landOf`.
//
// They walked `state.tiles` — a million of them — once per formation per tick,
// which was affordable only while a campaign was a rare tidying-up order for a
// war already won. It is an ordinary order now, and a whole army may be on one,
// so the answer comes out of the index `stateIndustry` and `stateMilitary`
// already pay for: it is rebuilt when a border moves and shared by everything
// that asks, rather than rescanned per unit.
function nearestAutoConquestTile(state, unit, countryId) {
  const skipped = new Set(unit.autoConquerSkipped ?? []);
  let nearest = null;
  for (const tile of landOf(state, countryId).all) {
    if (tile.terrain === 'water' || skipped.has(tile.id)) continue;
    if (!canMilitaryEnter(state, unit, tile)) continue;
    const distance = Math.max(Math.abs(tile.x - unit.x), Math.abs(tile.y - unit.y));
    if (!nearest || distance < nearest.distance || (distance === nearest.distance && tile.id < nearest.tile.id)) nearest = { tile, distance };
  }
  return nearest?.tile ?? null;
}

function nearestEnemyLandDistance(state, unit, countryId) {
  let nearest = Infinity;
  for (const tile of landOf(state, countryId).all) {
    if (tile.terrain !== 'water') nearest = Math.min(nearest, Math.max(Math.abs(tile.x - unit.x), Math.abs(tile.y - unit.y)));
  }
  return nearest;
}

// Calling a campaign off. It is the SAME function whether the sweep ran out of
// ground or you pressed the button a second time, so a stopped formation is
// left in exactly one state either way.
export function stopAutoConquest(state, unit, why, announce = true) {
  const countryId = unit.autoConquerCountryId;
  unit.autoConquerCountryId = null;
  unit.autoConquerTargetId = null;
  unit.autoConquerSkipped = null;
  unit.autoConquerClosest = null;
  unit.autoConquerStalled = null;
  if (announce && isPlayer(state, unit.owner)) pushAlert(state, `${UNIT_TYPES[unit.type]?.name ?? 'Formation'} ended its campaign against ${COUNTRIES[countryId]?.name ?? countryId} — ${why}.`, 'info');
}

// A march that is over, one way or the other. The progress figures are cleared
// with the order so the next one is judged on its own.
function arrive(unit) {
  unit.orderTileId = null;
  unit.closest = null;
  unit.stalled = 0;
}

function giveUp(state, unit, why) {
  arrive(unit);
  if (!isPlayer(state, unit.owner)) return;
  pushAlert(state, `${UNIT_TYPES[unit.type]?.name ?? 'Formation'} halted at (${unit.x}, ${unit.y}) — ${why}.`, 'warn');
}

// One tile toward the goal, or null if every way forward is shut to this
// formation. Water for a land unit and neutral foreign soil for anybody are
// both walls, and they are the same wall: `canMilitaryEnter`.
//
// It considers ALL EIGHT neighbours and takes the one that ends up nearest the
// goal, rather than trying three fixed offsets in a fixed order. The fixed-order
// version could only go straight at a thing: a column marching across Turkey
// gave up two tiles short of its destination because the three offsets it was
// willing to try all happened to be blocked, while a step to the side would have
// walked round the obstacle in one move.
//
// A SIDESTEP — a move that does not get closer — is allowed when nothing gets
// closer, which is what carries a march along a coastline or round a corner.
// Backtracking onto the tile it just left is not, or the two would trade places
// for ever. That is a local rule, not a pathfinder: a deep concave bay will
// still defeat it, and when it does the order is dropped and said so, which is
// an honest answer rather than a unit shuffling on the spot.
const NEIGHBOURS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

function stepToward(state, unit, goal, w) {
  let best = null;
  let fallback = null;
  for (const [ox, oy] of NEIGHBOURS) {
    const x = unit.x + ox;
    const y = unit.y + oy;
    if (x < 0 || y < 0 || x >= w || y >= state.grid.h) continue;
    const tile = state.tiles[y * w + x];
    if (!tile || !canMilitaryEnter(state, unit, tile)) continue;
    const gx = Math.abs(goal.x - x);
    const gy = Math.abs(goal.y - y);
    // TWO keys, and the second one is what makes a march look like a march.
    //
    // Distance on this grid is CHEBYSHEV — a diagonal costs the same as a
    // straight step — so heading for a goal 65 east and 40 south, the moves
    // east, north-east and south-east all reduce it by exactly one and tie.
    // Ties were settled by the order of `NEIGHBOURS`, which put north-east
    // first, so a column crossing Turkey drifted up to the northern coast and
    // ran along it: technically the same number of steps, visibly wrong.
    // Breaking the tie on the Manhattan sum picks the move that closes BOTH
    // axes, which is the diagonal-then-straight line a person would draw.
    const dist = Math.max(gx, gy);
    // ...and a THIRD key: how far this tile sits off the straight line from
    // where the march began to where it is going. Chebyshev alone leaves a whole
    // family of equally-short routes, and the tidiest-sounding tie-break —
    // closing both axes first — walks the diagonal to exhaustion and then turns,
    // which reads as a dog-leg rather than a march. Measuring the deviation from
    // the sight-line instead spreads the diagonal steps evenly along it, which
    // is the line somebody would draw with a ruler.
    const cross = unit.fromX == null ? 0
      : Math.abs((goal.x - unit.fromX) * (y - unit.fromY) - (goal.y - unit.fromY) * (x - unit.fromX));
    const line = gx + gy;
    // Somewhere it has been in the last few steps. Kept out of the running so a
    // column walking round an obstacle does not immediately walk back into it —
    // this is what replaces "never move away from the goal", which could not get
    // off a peninsula at all.
    if (unit.trail?.includes(tile.id)) {
      if (!fallback || better(dist, cross, line, fallback)) fallback = { tile, dist, cross, line };
      continue;
    }
    if (!best || better(dist, cross, line, best)) best = { tile, dist, cross, line };
  }
  // Walking BACKWARDS is allowed when it is the only way on. A formation on a
  // coastal spit with the enemy to the east and land only to the west has to be
  // able to go west: refusing that is what pinned Turkey's army on the Black Sea
  // coast for a whole war, giving up on the first tick of every order it was
  // given. The trail is what stops it becoming a shuffle, and `giveUpAfter`
  // still ends a march that is getting nowhere.
  return (best ?? fallback)?.tile ?? null;
}

// Nearest to the goal first; among equally near tiles, the one closest to the
// sight-line the march is following; and only then the one that closes both axes.
function better(dist, cross, line, than) {
  if (dist !== than.dist) return dist < than.dist;
  if (cross !== than.cross) return cross < than.cross;
  return line < than.line;
}

// The last few tiles a formation stood on. Short on purpose: long enough to walk
// out of a bay or round a headland, short enough that it will re-cross its own
// route on a long march rather than painting itself into a corner.
const TRAIL = 12;

function remember(unit, tileId) {
  unit.trail = unit.trail ?? [];
  unit.trail.push(tileId);
  if (unit.trail.length > TRAIL) unit.trail.shift();
}

// A tile a LAND formation has just occupied, during a war with whoever owns it.
// Shared by the march and by `conquerGround`, so ground taken in passing and
// ground taken by standing still go through exactly one rule — including the
// part that matters most: an aircraft takes nothing, ever.
function takeGround(state, unit, tile) {
  if ((UNIT_TYPES[unit.type]?.domain ?? unit.domain) !== 'land') return false;
  if (!tile || !tile.countryId || tile.countryId === unit.owner) return false;
  if (relationOf(state, unit.owner, tile.countryId) !== 'war') return false;
  const from = tile.countryId;
  if (!setTileOwner(state, tile, unit.owner)) return false;
  noteEvent(state, 'conquest', unit.owner, { about: from, qty: 1 });
  if (isPlayer(state, from)) {
    pushAlert(state, `${COUNTRIES[unit.owner]?.name ?? unit.owner} has taken ground at (${tile.x}, ${tile.y}).`, 'danger');
  }
  // Taken by an ARMY, so there is a victor and it inherits everything.
  if (!hasLand(state, from)) eliminate(state, from, unit.owner);
  return true;
}

// What a cell is MADE of, from its rifleman count. Armoured cars are one per
// `carsPer` riflemen, so "fewer cars than infantry" holds at every size, and
// there is deliberately no third entry: a cell cannot field a tank, an aircraft
// or a gun, because it has no industry and no government behind it. Unlike a
// standing army, this force never grows past what it spawned with.
export function terroristForce(active) {
  // Whole men. A cell takes fractional losses now (`resolveTerrorCombat` wears
  // it down rather than clearing it in one stroke), and a third of a rifleman
  // is an artefact of the arithmetic rather than anything the world contains —
  // so the count is floored, and a cell that floors to nobody is finished.
  const infantry = Math.max(0, Math.floor(active?.infantry ?? 0));
  return {
    infantry,
    armoredCar: Math.floor(infantry / CONFIG.terrorism.carsPer),
  };
}

export function terroristStrength(active) {
  const force = terroristForce(active);
  return force.infantry * UNIT_TYPES.infantry.strength
    + force.armoredCar * UNIT_TYPES.armoredCar.strength;
}

export function defeatTerrorists(state) {
  ensureMilitary(state);
  if (!state.terrorism.active) return false;
  // Everything the cell was holding goes back to whoever it was taken FROM,
  // never to whoever did the clearing. Liberating is not annexing.
  liberateHeldGround(state);
  state.terrorism.active = null;
  state.terrorism.defeated = (state.terrorism.defeated ?? 0) + 1;
  state.terrorism.nextSpawnTick = state.tick + CONFIG.terrorism.cooldown;
  // The next cell has not been chosen yet, so any standing warning is stale.
  state.terrorism.warning = null;
  return true;
}

// A FORMATION COSTS NOTHING TO KEEP.
//
// It was a running supply bill once, and that is gone: a unit draws its `cost`
// out of the warehouses on the tick it is raised and never draws anything
// again. An army is capital, bought in goods, and the decision about whether
// you can afford one is taken once — when you raise it — rather than every
// tick for the rest of the game.
//
// What is left of the old supply pass is REORGANISATION: a formation that has
// been shot at and is no longer in contact makes its losses good over time, at
// `RECOVERY` a tick. One still under fire does not, which is what keeps a war
// decisive — see `resolveWarCombat`. Nothing here reads a warehouse, so nothing
// here is a cost.
function reorganise(state) {
  for (const unit of state.military.units) {
    const def = UNIT_TYPES[unit.type];
    if (!def || unit.engaged) continue;
    if (unit.strength < def.strength) unit.strength = Math.min(def.strength, unit.strength + RECOVERY);
  }
}

function allowedLand(state, owner, countryId) {
  if (!countryId) return true;
  if (countryId === owner) return true;
  const relation = relationOf(state, owner, countryId);
  return relation === 'alliance' || relation === 'access' || relation === 'war';
}

function ensureMilitary(state) {
  if (!state.military) state.military = { units: [], nextUnitId: 1, nextGroupId: 1 };
  if (state.military.nextGroupId == null) state.military.nextGroupId = 1;
  if (!state.terrorism) state.terrorism = { active: null, warning: null, nextSpawnTick: state.tick + CONFIG.terrorism.cooldown, defeated: 0 };
  if (state.terrorism.warning === undefined) state.terrorism.warning = null;
  if (!state.diplomacy) state.diplomacy = { relations: {}, lastWarAt: -1 };
}

// A CELL IS ANNOUNCED BEFORE IT ARRIVES.
//
// `CONFIG.terrorism.warnBefore` ticks before the spawn, the ground is chosen and
// written down as `state.terrorism.warning` — country, tile and the tick it will
// appear on — and the red card over the map counts it down. That is the whole
// point of the mechanic being slow: a cell you cannot see coming is an ambush,
// and one you can is a problem you get to move an army toward first.
//
// The choice is seeded on `nextSpawnTick` rather than on the CURRENT tick, which
// matters: it has to give the same answer every tick between the warning and the
// spawn, or the camp would wander around the map while the countdown ran.
function warnTerrorists(state) {
  if (state.terrorism.active || state.terrorism.warning) return;
  const { warnBefore } = CONFIG.terrorism;
  if (state.tick < state.terrorism.nextSpawnTick - warnBefore) return;
  const countries = COUNTRY_IDS.filter((id) => state.countries[id]?.solvent);
  if (!countries.length) return;
  const at = state.terrorism.nextSpawnTick;
  const countryId = countries[(state.seed + at + (state.terrorism.defeated ?? 0) * 17) % countries.length];
  const tiles = state.tiles.filter((tile) => tile.countryId === countryId && tile.terrain !== 'water');
  if (!tiles.length) return;
  const tile = tiles[(state.seed + at * 13) % tiles.length];
  state.terrorism.warning = {
    countryId, tileId: tile.id, x: tile.x, y: tile.y, at, warnedAt: state.tick,
    name: TERRORIST_NAMES[(state.terrorism.defeated ?? 0) % TERRORIST_NAMES.length],
  };
  pushAlert(state, `Intelligence: a ${state.terrorism.warning.name.toLowerCase()} is forming in `
    + `${COUNTRIES[countryId]?.name ?? countryId} — expected in ${warnBefore} ticks.`, 'warn');
}

// How long until the cell that has been announced actually appears, or null if
// nothing has been. The red card reads it every render.
export function ticksToTerror(state) {
  const warning = state.terrorism?.warning;
  return warning ? Math.max(0, warning.at - state.tick) : null;
}

function spawnTerrorists(state) {
  if (state.terrorism.active || state.tick < state.terrorism.nextSpawnTick) return;
  // It appears exactly where it was announced. If the warning is somehow
  // missing — an old save, a hand-built state — one is made on the spot and the
  // spawn simply waits for the next tick, so there is no path to a cell nobody
  // was told about.
  if (!state.terrorism.warning) { warnTerrorists(state); return; }
  const { countryId, tileId, x, y, name } = state.terrorism.warning;
  const tile = state.tiles[tileId];
  if (!tile) { state.terrorism.warning = null; return; }
  const active = {
    id: `terror-${state.tick}`,
    name,
    countryId,
    tileId,
    x,
    y,
    // Irregulars, counted in riflemen. Armoured cars are derived from this
    // (`terroristForce`) rather than stored, so the two can never disagree.
    // Fixed at spawn — a cell that grew stronger the longer you ignored it
    // would be a losing condition, not a problem you go and deal with.
    infantry: CONFIG.terrorism.startInfantry,
    spawnedAt: state.tick,
    movedAt: state.tick,
    // The site it is currently walking toward, re-picked once it is reached or
    // destroyed. `null` until the first move tick chooses one.
    targetId: null,
    destroyed: 0,
  };
  active.strength = terroristStrength(active);
  state.terrorism.active = active;
  noteEvent(state, 'terror', countryId);
  state.terrorism.warning = null;
  // The red card over the map is driven from `terrorism.active` and stands
  // until the presence is gone; this is the one-off "it just happened" line
  // beside it, which expires like every other message.
  pushAlert(state, `${active.name} reported in ${COUNTRIES[countryId]?.name ?? countryId}.`, 'danger');
}

// A cell has no economy. It builds nothing, buys nothing and sells nothing, and
// it never grows past what it spawned with — the only thing it does is CRAWL
// toward whatever it is going to wreck next.
//
// `moveEvery` is deliberately long and `moveTiles` deliberately short
// (`CONFIG.terrorism`): the point of the mechanic is a slow-moving problem you
// go and deal with, not a fire that outruns you. It also never leaves the
// country it appeared in, because its targets are all drawn from that one
// nation's buildings.
function runTerrorists(state) {
  const active = state.terrorism.active;
  if (!active) return;
  const { moveEvery, moveTiles } = CONFIG.terrorism;
  if (state.tick - active.movedAt < moveEvery) return;
  active.movedAt = state.tick;

  // Keep the current target if it is still standing; otherwise pick the
  // nearest site of the host nation. Nearest rather than random, so the cell
  // is always working toward something and closing the distance is visible.
  let target = active.targetId != null
    ? state.buildings.find((b) => b.id === active.targetId && b.owner === active.countryId)
    : null;
  if (!target) {
    target = nearestBuilding(state, active);
    active.targetId = target?.id ?? null;
  }
  if (!target) return;

  for (let i = 0; i < moveTiles && (active.x !== target.x || active.y !== target.y); i++) {
    if (active.x !== target.x) active.x += Math.sign(target.x - active.x);
    if (active.y !== target.y) active.y += Math.sign(target.y - active.y);
  }
  active.tileId = active.y * state.grid.w + active.x;
  // The ground it is standing on is now HELD. A cell is not a government and
  // cannot own anything, so the tile falls out of its country entirely — and
  // whose it WAS is written down, because that is who gets it back.
  seizeForCell(state, active, state.tiles[active.tileId]);

  // Adjacent counts as arrived — a camp does not have to stand on the exact
  // tile it is raiding.
  if (Math.max(Math.abs(active.x - target.x), Math.abs(active.y - target.y)) > 1) return;
  state.buildings = state.buildings.filter((b) => b.id !== target.id);
  const tile = state.tiles[target.tileId];
  if (tile) tile.buildingId = null;
  // A wrecked site's ground is taken too — that is what makes a cell a loss of
  // territory rather than only a loss of capital.
  seizeForCell(state, active, tile);
  active.destroyed++;
  active.targetId = null;
  if (isPlayer(state, target.owner)) {
    pushAlert(state, `${active.name} destroyed your ${BUILDINGS[target.type].name} at (${target.x}, ${target.y}).`, 'danger');
  }
}

// Ground a cell has taken. `state.occupied` remembers whose it was, and that is
// the whole mechanism behind "liberated land goes home": the cell holds it, and
// whoever clears the cell hands it back rather than keeping it.
//
// Held ground is `countryId: null` — genuinely nobody's — so its former owner
// cannot build on it, sell from it, or count it as land while the cell sits
// there. A nation whose LAST tile is seized is finished exactly as if an army
// had taken it.
function seizeForCell(state, active, tile) {
  if (!tile || !tile.countryId || tile.terrain === 'water') return;
  const from = tile.countryId;
  state.occupied ??= {};
  state.occupied[tile.id] = from;
  setTileOwner(state, tile, null);
  noteEvent(state, 'seized', from, { qty: 1 });
  if (isPlayer(state, from)) {
    pushAlert(state, `${active.name} has taken ground at (${tile.x}, ${tile.y}).`, 'danger');
  }
  if (!hasLand(state, from)) eliminate(state, from);
}

// ...and giving it back. Whoever destroys the cell LIBERATES the ground rather
// than annexing it: every tile goes to the country it was taken from, which is
// the rule that makes going after a cell in a neighbour's territory an act of
// alliance rather than a land grab.
//
// A nation that was eliminated while the cell held its last ground comes back —
// it exists again the moment it has soil again, which is the honest reading of
// "occupied" as against "conquered".
function liberateHeldGround(state) {
  const held = state.occupied ?? {};
  const ids = Object.keys(held);
  if (!ids.length) return;
  const restored = new Set();
  for (const tileId of ids) {
    const tile = state.tiles[Number(tileId)];
    const owner = held[tileId];
    if (tile && owner && state.countries[owner]) {
      setTileOwner(state, tile, owner);
      restored.add(owner);
    }
  }
  state.occupied = {};
  for (const id of restored) revive(state, id);
}

// A government that was conquered but has land again. Only ever reached by
// liberation: ground taken by an ARMY stays taken.
function revive(state, countryId) {
  const gov = state.countries[countryId];
  if (!gov || gov.alive !== false || !hasLand(state, countryId)) return;
  gov.alive = true;
  gov.demand = Math.max(1, COUNTRIES[countryId]?.demand ?? 1);
  gov.pop = Math.max(0.1, COUNTRIES[countryId]?.pop ?? 1);
  gov.solvent = true;
  noteEvent(state, 'restored', countryId);
}

function nearestBuilding(state, active) {
  let best = null;
  let bestAway = Infinity;
  for (const b of state.buildings) {
    if (b.owner !== active.countryId) continue;
    const away = Math.max(Math.abs(b.x - active.x), Math.abs(b.y - active.y));
    if (away >= bestAway) continue;
    bestAway = away;
    best = b;
  }
  return best;
}

// FIGHTING THE CELL IS A FIGHT, not a threshold.
//
// Everything in REACH of the camp is engaged: everything but artillery has to be
// standing on it (`range` 1 is the ring it can touch, and the camp is inside
// it), and a gun battery three tiles away is shelling it. Both sides then wear
// each other down at `CONFIG.war.damage`, off the SAME snapshot, exactly as two
// armies do in `resolveWarCombat` — one combat rule in this game, not two.
//
// It used to be all-or-nothing: a government whose strength in reach matched the
// cell cleared it instantly, and anything less did nothing whatever. That is
// measurably where the mechanic broke. A cell is 46 strength and almost no
// nation on earth fields that in one place, so what actually happened was a lone
// formation marching onto the camp and STANDING there for two thousand ticks —
// taking no losses, inflicting none — while the cell walked off and wrecked
// every factory its host owned. Attrition fixes both halves: a partial force
// grinds a cell down over time instead of being ignored, and one that is badly
// outmatched dies, which is feedback rather than a stalemate.
//
// The cell loses MEN rather than an abstract pool, because `terroristForce`
// derives its armoured cars from the rifleman count — damage has to land on the
// thing the rest is derived from, or the two would disagree. A weakened cell is
// therefore visibly smaller on the red card, which is the honest picture.
//
// Reaching ACROSS a border is still governed by the same access rule as walking
// over one: you cannot shell a camp in a neutral country from your own side of
// the line. A unit already standing on the camp passed that test to get there.
function resolveTerrorCombat(state) {
  const active = state.terrorism.active;
  if (!active || !state.military.units.length) return;
  const camp = state.tiles[active.tileId];
  const engaged = [];
  const byOwner = new Map();
  for (const u of state.military.units) {
    const away = Math.max(Math.abs(u.x - active.x), Math.abs(u.y - active.y));
    if (away > rangeOf(u)) continue;
    if (camp && !canMilitaryEnter(state, u, camp)) continue;
    engaged.push(u);
    byOwner.set(u.owner, (byOwner.get(u.owner) ?? 0) + u.strength);
  }
  if (!engaged.length) return;

  const cellStrength = terroristStrength(active);
  const facing = engaged.reduce((sum, u) => sum + u.strength, 0);
  if (cellStrength <= 0 || facing <= 0) return;

  // Both sides fire off the same snapshot, so who is listed first cannot decide
  // the fight — the determinism argument that runs through the whole pipeline.
  const dealt = facing * CONFIG.war.damage;
  const taken = cellStrength * CONFIG.war.damage;

  active.infantry = Math.max(0, active.infantry * (1 - Math.min(1, dealt / cellStrength)));
  active.strength = terroristStrength(active);

  const lost = [];
  for (const u of engaged) {
    // In contact, so it makes no losses good this tick — the same rule a war
    // follows, and `reorganise` reads it next tick.
    u.engaged = true;
    u.strength -= taken * (u.strength / facing);
    if (u.strength <= (UNIT_TYPES[u.type]?.strength ?? 1) * CONFIG.war.breakAt) lost.push(u);
  }
  if (lost.length) {
    state.military.units = state.military.units.filter((u) => !lost.includes(u));
    for (const u of lost) {
      if (u.groupId != null) dissolveIfAlone(state, u.groupId);
      if (!isPlayer(state, u.owner)) continue;
      pushAlert(state, `${UNIT_TYPES[u.type].name} was destroyed fighting ${active.name}.`, 'danger');
    }
  }

  // A cell with no riflemen left is finished. The bounty goes to whoever had
  // the most strength in reach when it broke — real money, for the same reason
  // the clearing fund's fee is real.
  if (terroristForce(active).infantry >= 1) return;
  const winner = [...byOwner.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const bounty = CONFIG.terrorism.bounty;
  const name = active.name;
  if (winner && state.countries[winner]) state.countries[winner].cash += bounty;
  // WHO cleared it, which is the one piece of world news most worth reading.
  noteEvent(state, 'terrorGone', winner ?? active.countryId, { about: active.countryId, qty: bounty });
  defeatTerrorists(state);
  if (winner && isPlayer(state, winner)) {
    pushAlert(state, `${name} destroyed — ${money(bounty)} bounty paid to the treasury.`, 'good');
  }
}

function money(value) {
  return value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(2)}M` : `$${Math.round(value).toLocaleString('en-US')}`;
}
