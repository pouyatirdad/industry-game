import { BUILDINGS } from '../data/buildings.js';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities.js';
import { COUNTRIES } from '../data/countries.js';
import { haulShare } from '../data/geography.js';
import { placeForCountry, provinceForTile } from '../data/places.js';
import { buildingOnTile, warehouseUsed, siteWages, countryDeposits, WATER_TERRAINS,
  ownerName, ownerColor, isPlayer } from '../core/state.js';
import { warehousesServing } from '../systems/logistics.js';
import { UNIT_TYPES, unitOnTile, groupMembers, groupSpeed } from '../systems/military.js';
import { money, num, price, pct, html } from './format.js';

const STATUS_LABEL = {
  running: 'Running',
  starved: 'Starved',
  blocked: 'Output full',
  unstaffed: 'Unstaffed',
  store: 'Storing',
  idle: 'Idle',
};

const TERRAIN_LABEL = {
  plain: 'Plains', water: 'Ocean', desert: 'Desert',
  hills: 'Hills', coalfield: 'Coalfield', oilfield: 'Oilfield', gasfield: 'Gasfield',
  copperbelt: 'Copperbelt', bauxite: 'Bauxite ridge', quarry: 'Limestone quarry',
  farmland: 'Farmland', forest: 'Forest',
  offshoreOil: 'Offshore oilfield', offshoreGas: 'Offshore gasfield',
  fishery: 'Fishing grounds',
};

const DEPOSIT_LABEL = {
  oilfield: 'oil', gasfield: 'gas', copperbelt: 'copper', bauxite: 'bauxite',
  hills: 'iron ore', coalfield: 'coal', forest: 'timber', farmland: 'farmland',
  quarry: 'limestone', desert: 'desert',
  offshoreOil: 'offshore oil', offshoreGas: 'offshore gas', fishery: 'fisheries',
};

export function updateInspector(host, ctx) {
  const { state, ui } = ctx;
  const tile = ui.selectedTileId == null ? null : state.tiles[ui.selectedTileId];
  const building = tile ? buildingOnTile(state, tile) : null;
  // A unit and a building can never share a tile (both `canBuild` and
  // `canDeployUnit` refuse occupied ground), so this is an either/or, not a
  // priority order.
  const unit = tile && !building ? unitOnTile(state, tile.id) : null;
  const mine = tile ? isPlayer(state, tile.countryId) : false;
  // Who this formation marches with. The SIZE is what the panel says, so the
  // size is what the signature carries — a companion joining or standing down
  // leaves `groupId` untouched and would otherwise never repaint.
  const group = unit?.groupId != null ? groupMembers(state, unit.groupId) : [];

  const sig = tile
    ? [tile.id, tile.countryId ?? '', mine ? 'm' : '',
       building?.owner ?? '', building?.status, building?.progress,
       JSON.stringify(building?.input), JSON.stringify(building?.output),
       JSON.stringify(building?.store),
       unit?.id ?? '', unit?.strength.toFixed(1) ?? '', unit?.engaged,
       // A formation's ORDER and its GROUP both change what this panel says, so
       // both are in the signature: a marching column whose destination is not
       // here would otherwise never repaint.
       unit?.orderTileId ?? '', unit?.groupId ?? '', group.length,
       ui.moveUnit === unit?.id, ui.groupUnit === unit?.id].join('|')
    : 'none';
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;

  if (!tile) {
    host.replaceChildren(html('<p class="muted">Click a tile to inspect it.</p>'));
    return;
  }

  host.replaceChildren(building
    ? renderBuilding(state, tile, building)
    : unit
      ? renderUnit(state, tile, unit, group, ctx)
      : renderLand(state, tile, mine));
}

function renderUnit(state, tile, unit, group, ctx) {
  const def = UNIT_TYPES[unit.type];
  const mine = isPlayer(state, unit.owner);
  const moving = ctx.ui.moveUnit === unit.id;
  const grouping = ctx.ui.groupUnit === unit.id;
  const owner = `<p class="owner" style="--swatch:${ownerColor(unit.owner)}">
      <i class="swatch"></i>${mine ? 'Yours' : ownerName(unit.owner)}
    </p>`;
  // A group MARCHES at its slowest member, so that — not this formation's own
  // speed — is the figure that answers "when does it get there".
  const pace = group.length ? groupSpeed(state, unit.groupId) : def.speed;
  const goal = unit.orderTileId != null ? state.tiles[unit.orderTileId] : null;
  const away = goal ? Math.max(Math.abs(goal.x - unit.x), Math.abs(goal.y - unit.y)) : 0;
  const el = html(`
    <div class="inspect">
      <h3>${def.glyph} ${def.name}</h3>
      ${owner}
      <p class="muted">Tile (${tile.x}, ${tile.y}) &middot; strength ${unit.strength.toFixed(1)} / ${def.strength}</p>
      <p class="muted">${pace} tile${pace === 1 ? '' : 's'} a tick${group.length && pace !== def.speed ? ` <span class="muted">(its own ${def.speed}, held to the group's slowest)</span>` : ''}
        &middot; strikes ${def.range} tile${def.range === 1 ? '' : 's'} out</p>
      <p class="status" data-status="${unit.engaged ? 'starved' : 'running'}">${unit.engaged
        ? 'In contact — taking losses and making none good'
        : unit.strength < def.strength ? 'Out of contact — making its losses good' : 'At full strength'}</p>
      ${goal ? `<p class="muted">Marching for (${goal.x}, ${goal.y}) &mdash; ${away} tile${away === 1 ? '' : 's'} to go, about ${Math.max(1, Math.ceil(away / Math.max(1, pace)))} tick${Math.max(1, Math.ceil(away / Math.max(1, pace))) === 1 ? '' : 's'}.</p>` : ''}
      ${group.length ? `<p class="muted">Grouped with ${group.length - 1} other${group.length === 2 ? '' : 's'}: ${group
        .map((u) => `${UNIT_TYPES[u.type].glyph} ${UNIT_TYPES[u.type].name}`).join(', ')}. An order to any of them is an order to all.</p>` : ''}
      ${mine ? `
        <p class="muted">Raised for ${Object.entries(def.cost).map(([id, qty]) => `${qty} ${COMMODITIES[id].name}`).join(' + ')} out of your warehouses. It costs nothing to keep — an army is capital, not a subscription.</p>
        <div class="inspect__actions">
          <button type="button" class="unit-move" data-active="${moving}" title="Order this formation somewhere (M)">${moving ? 'Click a tile to move…' : group.length ? 'Move group' : 'Move'}</button>
          <button type="button" class="unit-group" data-active="${grouping}">${grouping ? 'Click a formation to add…' : 'Group'}</button>
          ${group.length ? '<button type="button" class="unit-ungroup">Leave group</button>' : ''}
          <button type="button" class="unit-standdown">Stand down</button>
        </div>
        <p class="muted">${def.domain === 'air'
          ? 'Aircraft group only with aircraft.'
          : 'Land formations group with land formations; aircraft keep to their own.'}</p>` : ''}
    </div>`);
  if (mine) {
    el.querySelector('.unit-move').addEventListener('click', () => ctx.onMoveUnit(moving ? null : unit.id));
    el.querySelector('.unit-group').addEventListener('click', () => ctx.onGroupUnit(unit.id));
    el.querySelector('.unit-ungroup')?.addEventListener('click', () => ctx.onUngroupUnit(unit.id));
    el.querySelector('.unit-standdown').addEventListener('click', () => ctx.onStandDownUnit(unit.id));
  }
  return el;
}

function renderLand(state, tile, mine) {
  // Open sea belongs to nobody; sea within reach of a coast is somebody's, and
  // that is what makes offshore deposits licensable. An offshore deposit is
  // still sea, so it comes through here rather than being called somebody's
  // soil.
  if (tile.terrain === 'water' || WATER_TERRAINS.includes(tile.terrain)) {
    const c = tile.countryId ? COUNTRIES[tile.countryId] : null;
    const place = tile.countryId ? placeForCountry(tile.countryId) : null;
    const what = TERRAIN_LABEL[tile.terrain] ?? tile.terrain;
    return html(`
      <div class="inspect">
        <h3>${c ? `${what} &mdash; ${c.name} waters` : 'International waters'}</h3>
        ${place ? `<p class="muted">${provinceForTile(tile) ?? place.province} &middot; ${place.city}</p>` : ''}
        <p class="muted">Tile (${tile.x}, ${tile.y})${mine ? ' &middot; your own waters' : ''}</p>
        <p>${c
          ? 'Territorial sea. Offshore oil, gas and fisheries here belong to that nation alone.'
          : 'Beyond any territorial claim — nothing can be built here.'}</p>
      </div>`);
  }
  if (!tile.countryId) {
    return html(`
      <div class="inspect">
        <h3>Unclaimed territory</h3>
        <p class="muted">Tile (${tile.x}, ${tile.y})</p>
        <p>No government here, so no industry either.</p>
      </div>`);
  }

  const c = COUNTRIES[tile.countryId];
  const place = placeForCountry(tile.countryId);
  const gov = state.countries[tile.countryId];
  const deposits = countryDeposits(state, tile.countryId);
  const found = Object.entries(deposits)
    .filter(([terrain]) => DEPOSIT_LABEL[terrain])
    .sort((a, b) => b[1] - a[1])
    .map(([terrain, n]) => `${num(n)} ${DEPOSIT_LABEL[terrain]}`)
    .join(', ');

  if (mine) {
    const served = warehousesServing(state, tile.x, tile.y, state.home).length;
    return html(`
      <div class="inspect">
        <h3>${TERRAIN_LABEL[tile.terrain] ?? tile.terrain} &mdash; ${c.name}</h3>
        <p class="muted">${provinceForTile(tile) ?? place.province} &middot; ${place.city}</p>
        <p class="muted">Your own soil &middot; tile (${tile.x}, ${tile.y})</p>
        <p class="muted">National deposits: ${found || 'none'}</p>
        <p class="muted">${served ? `Served by ${served} warehouse${served > 1 ? 's' : ''}.` : '⚠ No warehouse in range — nothing built here could move its goods.'}</p>
      </div>`);
  }

  return html(`
    <div class="inspect">
      <h3>${TERRAIN_LABEL[tile.terrain] ?? tile.terrain} &mdash; ${c.name}</h3>
      <p class="muted">${provinceForTile(tile) ?? place.province} &middot; ${place.city}</p>
      <p class="muted">Foreign soil &middot; tile (${tile.x}, ${tile.y})</p>
      <dl class="facts">
        <div><dt>Economy</dt><dd>${gov.demand.toFixed(1)}</dd></div>
        <div><dt>Demand met</dt><dd>${pct(gov.supply)}</dd></div>
        <div><dt>Population</dt><dd>${gov.pop >= 10 ? Math.round(gov.pop) : (gov.pop ?? c.pop).toFixed(1)}m</dd></div>
        <div><dt>Freight</dt><dd>${pct(haulShare(state.home, tile.countryId))} of a world haul</dd></div>
      </dl>
      <p class="muted">National deposits: ${found || 'none'}</p>
      <p class="muted">Foreign soil, so nothing of yours can stand here — but its
        market is open like every other. Post terms it will take, or take its own.</p>
      ${topPrices(state, tile.countryId)}
    </div>`);
}

// What this market pays best relative to your own — the one question worth
// asking about a foreign country you can already trade with.
function topPrices(state, countryId) {
  const here = state.markets[countryId];
  const home = state.markets[state.home];
  const rows = COMMODITY_IDS
    .map((id) => ({ id, gap: here[id].price - home[id].price, price: here[id].price }))
    .filter((row) => row.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 4);
  if (!rows.length) return '<p class="muted">Nothing here fetches more than it does at home.</p>';
  return `<div class="bag"><h4>Pays more than home</h4><ul>${rows
    .map((row) => `<li><span>${COMMODITIES[row.id].name}</span><b>${price(row.price)} <span class="muted">+${price(row.gap)}</span></b></li>`)
    .join('')}</ul></div>`;
}

function renderBuilding(state, tile, building) {
  const def = BUILDINGS[building.type];
  const served = warehousesServing(state, building.x, building.y, building.owner).length;
  const shortage = building.shortage?.length
    ? `: needs ${building.shortage.map((id) => COMMODITIES[id].name).join(' + ')}`
    : '';

  const mine = isPlayer(state, building.owner);
  const owner = `<p class="owner" style="--swatch:${ownerColor(building.owner)}">
      <i class="swatch"></i>${mine ? 'Yours' : ownerName(building.owner)}
    </p>`;

  return html(`
    <div class="inspect">
      <h3>${def.glyph} ${def.name}</h3>
      ${owner}
      <p class="muted">Tile (${building.x}, ${building.y}) &middot; ${money(siteWages(building))}/tick wages here</p>
      <p class="status" data-status="${building.status}">${STATUS_LABEL[building.status] ?? building.status}${shortage}</p>
      ${def.recipe && def.recipe.ticks > 1 ? `<p class="muted">Job ${building.progress}/${def.recipe.ticks} ticks</p>` : ''}
      ${building.store ? bag('Stored', building.store, `${num(warehouseUsed(building))} / ${num(def.capacity)}`) : ''}
      ${building.input ? bag('Inputs', building.input) : ''}
      ${building.output ? bag('Awaiting pickup', building.output) : ''}
      <p class="muted">${served ? `Linked to ${served} warehouse${served > 1 ? 's' : ''}.` : '⚠ No warehouse in range — goods cannot move.'}</p>
    </div>`);
}

function bag(title, contents, suffix = '') {
  const rows = Object.entries(contents)
    .filter(([, qty]) => qty > 0.5)
    .map(([id, qty]) => `<li><span>${COMMODITIES[id].name}</span><b>${num(qty)}</b></li>`)
    .join('');
  const head = suffix ? `${title} <span class="muted">${suffix}</span>` : title;
  return `<div class="bag"><h4>${head}</h4>${rows ? `<ul>${rows}</ul>` : '<p class="muted">empty</p>'}</div>`;
}
