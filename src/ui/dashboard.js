import { CONFIG } from '../core/config.js';
import { BUILDINGS, BUILDING_IDS } from '../data/buildings.js';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities.js';
import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { distanceBetween, MAX_DISTANCE } from '../data/geography.js';
import { TECHS } from '../data/technology.js';
import { projectedWages, ownerName, ownFlows, knowsTech } from '../core/state.js';
import { depotsByOwner } from '../systems/logistics.js';
import { UNIT_TYPES, UNIT_IDS, unitAffordable, unitsOf } from '../systems/military.js';
import { updateContracts } from './contracts.js';
import { money, moneyShort, num, qtyShort, pct, setAttr, setText, setToggle, html } from './format.js';

const BUILD_VIEWS = [
  { id: 'basic', label: 'Basic' },
  { id: 'extract', label: 'Extract' },
  { id: 'power', label: 'Power' },
  { id: 'process', label: 'Tier 1' },
  { id: 'assembly', label: 'Tier 2+' },
  { id: 'logistics', label: 'Logistics' },
  { id: 'military', label: 'Military' },
];

const BUILD_CATEGORY = {
  warehouse: 'logistics',
  coalPlant: 'power',
  gasPlant: 'power',
  nuclearPlant: 'power',
  refinery: 'process',
  steelMill: 'process',
  copperSmelter: 'process',
  aluminiumPlant: 'process',
  cementWorks: 'process',
  sawmill: 'process',
  paperMill: 'process',
  glassworks: 'process',
  chemicalWorks: 'process',
  plasticsPlant: 'process',
  fertiliserPlant: 'process',
  foodPlant: 'basic',
  cannery: 'basic',
  machineWorks: 'assembly',
  electronicsPlant: 'assembly',
  batteryPlant: 'assembly',
  semiconductorFab: 'assembly',
  vehiclePlant: 'assembly',
  shipyard: 'assembly',
  aircraftPlant: 'assembly',
};

export function mountDashboard(refs, ctx) {
  refs.buildTabs.replaceChildren(...BUILD_VIEWS.map((view) => {
    const btn = html(`<button type="button" class="build-tab" data-view="${view.id}">${view.label}</button>`);
    btn.addEventListener('click', () => ctx.onBuildView(view.id));
    return btn;
  }));

  refs.speeds.replaceChildren(...CONFIG.speeds.map((speed) => {
    const btn = html(`<button type="button" class="speed" data-speed="${speed}">${speed}x</button>`);
    btn.addEventListener('click', () => ctx.onSpeed(speed));
    return btn;
  }));

  // Industries first, then the five FORMATIONS, which sit in the same dock and
  // are picked up the same way. A unit is not a building — no site is laid, no
  // treasury is charged, and the batch it costs comes out of the warehouses —
  // so it carries `data-unit` rather than `data-type`, and every place that
  // walks this menu branches on which one it is.
  const industries = BUILDING_IDS.map((id) => {
    const def = BUILDINGS[id];
    // Two compact rows per industry: name/cost first, recipe/status second.
    // The full story is still on the tooltip, written in updateDashboard
    // because wages depend on which nation you govern.
    const item = html(`
      <button type="button" class="build" data-type="${id}">
        <span class="build__top">
          <span class="build__glyph">${def.glyph}</span>
          <span class="build__name">${def.name}</span>
          <b class="build__cost"></b>
        </span>
        <span class="build__recipe">${recipeLine(def)}</span>
      </button>`);
    item.addEventListener('click', () => ctx.onSelectTool(id));
    return item;
  });
  const formations = UNIT_IDS.map((id) => {
    const def = UNIT_TYPES[id];
    const item = html(`
      <button type="button" class="build build--unit" data-unit="${id}">
        <span class="build__top">
          <span class="build__glyph">${def.glyph}</span>
          <span class="build__name">${def.name}</span>
          <b class="build__cost"></b>
        </span>
        <span class="build__recipe">${bagLine(def.cost)} &rarr; ${bagLine(def.upkeep)}/t</span>
      </button>`);
    item.addEventListener('click', () => ctx.onSelectUnit(id));
    return item;
  });
  refs.buildMenu.replaceChildren(...industries, ...formations);

  refs.countries.replaceChildren(...COUNTRY_IDS.map((id) => {
    const c = COUNTRIES[id];
    const row = html(`
      <button type="button" class="country" data-country="${id}">
        <i class="country__swatch" style="--swatch:${c.color}"></i>
        <span class="country__name">${c.name}</span>
        <span class="country__meta"></span>
      </button>`);
    row.addEventListener('click', () => ctx.onFocusCountry(id));
    return row;
  }));

  refs.homeSelect.replaceChildren(...COUNTRY_IDS.map((id) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = COUNTRIES[id].name;
    return opt;
  }));
  refs.homeSelect.value = ctx.state.home;

  refs.pause.addEventListener('click', ctx.onTogglePause);
  refs.save.addEventListener('click', ctx.onSave);
  refs.load.addEventListener('click', ctx.onLoad);
  refs.reset.addEventListener('click', ctx.onReset);
}

export function updateDashboard(refs, ctx) {
  const { state, ui } = ctx;
  const me = state.countries[state.home];
  const wages = projectedWages(state);
  // Everything that crossed a border, contracted and spot alike — the topbar
  // figure has to be the whole trade balance or it stops meaning anything the
  // moment you sign your first contract.
  const balance = tradeBalance(me);

  setText(refs.cash, money(me.cash));
  setToggle(refs.cash, 'is-negative', me.cash < 0);
  setText(refs.net, `${me.report.net >= 0 ? '+' : ''}${money(me.report.net)}`);
  setToggle(refs.net, 'is-negative', me.report.net < 0);
  setText(refs.wages, `${money(wages)}/tick`);
  setText(refs.trade, `${balance >= 0 ? '+' : ''}${money(balance)}`);
  setToggle(refs.trade, 'is-negative', balance < 0);
  setText(refs.supply, pct(me.supply));
  setToggle(refs.supply, 'is-negative', me.supply < CONFIG.growth.pivot);
  setText(refs.demand, `${me.demand.toFixed(1)} / ${COUNTRIES[state.home].demand}`);
  setToggle(refs.demand, 'is-negative', me.demand < COUNTRIES[state.home].demand);
  setText(refs.tick, num(state.tick));
  setText(refs.pause, state.paused ? '▶ Run' : '❚❚ Pause');

  updateNationCard(refs, ctx, me, wages);

  for (const btn of refs.speeds.children) {
    setAttr(btn, 'data-active', Number(btn.dataset.speed) === state.speed ? 'true' : null);
  }
  // Zoom is the wheel now, so the only thing left to say about it is where it
  // currently stands.
  setText(refs.zoomLabel, `${CONFIG.zoomLevels[ui.zoom] ?? 1}px`);

  const mul = COUNTRIES[state.home].wageMul;
  // The depot index once for the whole dock rather than once per formation:
  // five units asking `unitAffordable` for themselves would be five scans of
  // every building in the world, every render.
  const depots = depotsByOwner(state).get(state.home) ?? [];
  const fielded = new Map();
  for (const unit of unitsOf(state, state.home)) {
    fielded.set(unit.type, (fielded.get(unit.type) ?? 0) + 1);
  }
  for (const btn of refs.buildMenu.children) {
    if (btn.dataset.unit) { updateUnitBox(btn, ctx, depots, fielded); continue; }
    const def = BUILDINGS[btn.dataset.type];
    const category = buildCategory(btn.dataset.type, def);
    setAttr(btn, 'hidden', category === ui.buildView ? null : '');
    const wages = money(Math.round(def.wages * mul));
    // An industry you have not learned is still listed, greyed, with the tech it
    // wants written on it — a build menu that hid what you cannot build yet
    // would never tell you what research is FOR.
    const locked = def.tech && !knowsTech(state, state.home, def.tech);
    setText(btn.querySelector('.build__cost'), locked ? '🔒' : moneyShort(def.cost));
    setAttr(btn, 'title', locked
      ? `${def.name} — needs ${TECHS[def.tech].name}, which you have not researched. ${def.blurb}`
      : `${def.name} — ${plainRecipe(def)}. ${money(def.cost)} to build, ${wages}/tick wages. ${def.blurb}`);
    setAttr(btn, 'data-locked', locked ? 'true' : null);
    setAttr(btn, 'data-active', ui.tool === btn.dataset.type ? 'true' : null);
    setAttr(btn, 'data-affordable', !locked && me.cash >= def.cost ? 'true' : 'false');
  }
  for (const btn of refs.buildTabs.children) {
    setAttr(btn, 'data-active', btn.dataset.view === ui.buildView ? 'true' : null);
  }
}

// A formation box: how many of these you have standing, what it costs to raise
// one, and whether the warehouses can actually pay for it right now. There is
// no lock and no money figure — a unit is gated by SUPPLIES, not by treasury or
// technology, which is the whole difference between it and an industry.
function updateUnitBox(btn, ctx, depots, fielded) {
  const { state, ui } = ctx;
  const id = btn.dataset.unit;
  const def = UNIT_TYPES[id];
  const standing = fielded.get(id) ?? 0;
  const affordable = unitAffordable(state, state.home, id, depots);
  setAttr(btn, 'hidden', ui.buildView === 'military' ? null : '');
  setText(btn.querySelector('.build__cost'), standing ? `×${standing}` : '');
  setAttr(btn, 'title', `${def.name} — raise for ${bagLine(def.cost)}, then ${bagLine(def.upkeep)} every tick for as long as it stands.`
    + ` ${standing ? `${standing} in the field. ` : ''}Pick it up and click your own ground. ${def.blurb}`);
  setAttr(btn, 'data-active', ui.unit === id ? 'true' : null);
  setAttr(btn, 'data-affordable', affordable ? 'true' : 'false');
}

export function buildCategory(type, def = BUILDINGS[type]) {
  // A formation has no building definition at all, and it always sits with the
  // military tools.
  if (!def) return UNIT_TYPES[type] ? 'military' : 'basic';
  if (def.category) return def.category;
  if (!def.recipe) return 'logistics';
  if (!Object.keys(def.recipe.in).length) return type === 'farm' || type === 'fishingFleet' ? 'basic' : 'extract';
  return BUILD_CATEGORY[type] ?? 'process';
}

export function updateTrade(refs, ctx) {
  updateTradeHead(refs, ctx);
  updateContracts(refs, ctx);
  updateFlows(refs, ctx);
  updateTradeGoods(refs, ctx);
  updateCountries(refs, ctx);
}

// What your trade actually amounts to, which the deal list on its own never
// answered: how much is moving, in which direction, and with how many partners.
function updateTradeHead(refs, ctx) {
  const { state } = ctx;
  const me = state.countries[state.home];
  const book = state.ledger?.total ?? {};
  let out = 0;
  let inn = 0;
  let earned = 0;
  let paid = 0;
  let fees = 0;
  for (const id of COMMODITY_IDS) {
    const line = book[id];
    if (!line) continue;
    out += line.exported;
    inn += line.imported;
    earned += line.earned;
    paid += line.paid;

  }
  const partners = new Set((state.contracts ?? [])
    .filter((c) => c.seller === state.home || c.buyer === state.home)
    .map((c) => (c.seller === state.home ? c.buyer : c.seller))).size;
  const balance = tradeBalance(me);
  // How much of the game the grouped deal list below actually covers, so a route
  // worth "+$780" reads as a rate rather than as a total out of nowhere.
  const kept = ownFlows(state);
  const deals = kept.length;
  const window = deals ? state.tick - kept[0].tick + 1 : 0;

  fees = Math.round(me.report.fees ?? 0);
  const sig = [Math.round(out), Math.round(inn), Math.round(earned), Math.round(paid),
    Math.round(fees), partners, balance, deals, window].join('|');
  if (refs.tradeHead.dataset.sig === sig) return;
  refs.tradeHead.dataset.sig = sig;

  refs.tradeHead.replaceChildren(html(`
    <dl class="facts facts--four">
      <div><dt>Shipped out</dt><dd>${qtyShort(out)} <span class="muted">${money(earned)}</span></dd></div>
      <div><dt>Bought in</dt><dd>${qtyShort(inn)} <span class="muted">${money(paid)}</span></dd></div>
      <div><dt>Balance / tick</dt><dd class="${balance < 0 ? 'is-negative' : ''}">${balance >= 0 ? '+' : ''}${money(balance)}</dd></div>
      <div><dt title="Nations you currently hold a contract with">Partners</dt><dd>${num(partners)} / ${COUNTRY_IDS.length - 1}</dd></div>
      <div><dt title="What the exchange charged you for clearing this tick">Clearing fee</dt><dd>${money(fees)} <span class="muted">/tick</span></dd></div>
      <div><dt title="How many deals the list below covers, and how many ticks that is">Deals below</dt><dd>${num(deals)} <span class="muted">/ ${num(window)}t</span></dd></div>
    </dl>`));
}

// Which commodities your trade actually consists of. The deal list answers
// "what just happened"; this answers "what am I in the business of".
function updateTradeGoods(refs, ctx) {
  const { state } = ctx;
  const book = state.ledger?.total ?? {};
  const rows = COMMODITY_IDS
    .map((id) => ({ id, ...(book[id] ?? {}) }))
    .filter((row) => (row.exported ?? 0) > 0.5 || (row.imported ?? 0) > 0.5)
    .sort((a, b) => (b.earned + b.paid) - (a.earned + a.paid))
    .slice(0, 10);

  const sig = rows.map((r) => `${r.id}${Math.round(r.earned)}${Math.round(r.paid)}`).join('|');
  if (refs.tradeGoods.dataset.sig === sig) return;
  refs.tradeGoods.dataset.sig = sig;

  if (!rows.length) {
    refs.tradeGoods.replaceChildren(html('<tr><td colspan="6" class="muted">Nothing has crossed a border yet.</td></tr>'));
    return;
  }
  refs.tradeGoods.replaceChildren(...rows.map((row) => {
    const def = COMMODITIES[row.id];
    const net = row.earned - row.paid;
    return html(`
      <tr>
        <th scope="row"><i class="swatch" style="--swatch:${def.color}"></i>${def.name}</th>
        <td>${qtyShort(row.exported)}</td>
        <td>${moneyShort(row.earned)}</td>
        <td>${qtyShort(row.imported)}</td>
        <td>${moneyShort(row.paid)}</td>
        <td class="${net < 0 ? 'is-negative' : 'good-text'}">${net >= 0 ? '+' : '-'}${moneyShort(Math.abs(net))}</td>
      </tr>`);
  }));
}

function updateNationCard(refs, ctx, me, wages) {
  const { state } = ctx;
  const def = COUNTRIES[state.home];
  const sites = state.buildings.reduce((n, b) => n + (b.owner === state.home ? 1 : 0), 0);
  const contracts = (state.contracts ?? []).reduce((n, c) =>
    n + (c.seller === state.home || c.buyer === state.home ? 1 : 0), 0);
  // Rebuilt only when something on it actually changed — this panel is cheap,
  // but it is repainted every tick and the meter animates if it churns.
  const sig = [state.home, Math.round(me.cash), me.report.net, wages, sites, contracts,
               me.demand.toFixed(2), me.supply.toFixed(3)].join('|');
  if (refs.nationCard.dataset.sig === sig) return;
  refs.nationCard.dataset.sig = sig;

  setText(refs.nationName, def.name);
  const grows = me.supply >= CONFIG.growth.pivot;
  refs.nationCard.replaceChildren(html(`
    <div>
      <div class="meter" title="Share of what your people want that is actually reaching them">
        <div class="meter__bar" style="--fill:${Math.min(100, Math.round(me.supply * 100))}%" data-good="${grows}"></div>
        <span class="meter__label">${pct(me.supply)} of demand met &middot; economy ${grows ? 'growing' : 'shrinking'}</span>
      </div>
      <dl class="facts">
        <div><dt>Wages</dt><dd>&times;${def.wageMul.toFixed(2)}</dd></div>
        <div><dt>Sites</dt><dd>${num(sites)}</dd></div>
      </dl>
    </div>`));
}

function updateCountries(refs, ctx) {
  const { state } = ctx;
  const sites = new Map();
  for (const b of state.buildings) sites.set(b.owner, (sites.get(b.owner) ?? 0) + 1);
  const partners = new Set();
  for (const c of state.contracts ?? []) {
    if (c.seller === state.home) partners.add(c.buyer);
    if (c.buyer === state.home) partners.add(c.seller);
  }

  for (const row of refs.countries.children) {
    const id = row.dataset.country;
    const c = COUNTRIES[id];
    const gov = state.countries[id];
    const home = id === state.home;
    const dealing = partners.has(id);
    setAttr(row, 'data-open', String(home || dealing));
    setAttr(row, 'data-home', home ? 'true' : null);
    row.title = home
      ? 'Your own nation.'
      : `${c.name} — wages ×${c.wageMul.toFixed(2)}, ${Math.round(haul(state.home, id) * 100)}% of a world haul away. Its market is open like every other: post terms on the exchange, or take its own.`;
    setText(row.querySelector('.country__meta'), home
      ? `home · ${num(sites.get(id) ?? 0)} sites`
      : `${dealing ? 'under contract · ' : ''}${gov.demand.toFixed(1)} econ · ${num(sites.get(id) ?? 0)} sites`);
  }
}

// Every contract settlement, in and out. There is nothing else: a contract is
// the only way anything crosses a border.
export function tradeBalance(country) {
  return country.report.exports - country.report.imports;
}

function haul(a, b) {
  return MAX_DISTANCE ? distanceBetween(a, b) / MAX_DISTANCE : 0;
}

function updateFlows(refs, ctx) {
  const { state } = ctx;
  // Your own deals, kept in their own list by `recordFlow`. Filtering the world
  // list — which is what this used to do — showed a handful of deals and hid the
  // rest, because forty-five governments trading with each other fill that list
  // in a tick or two.
  //
  // ...and they are GROUPED, because the same cargo goes to the same partner
  // every tick: sixty raw lines were the same four routes written fifteen times
  // over, which answered "what just happened" and never "how much am I moving,
  // and with whom".
  const routes = new Map();
  for (const f of ownFlows(state)) {
    const out = f.from === state.home;
    const other = out ? f.to : f.from;
    const key = `${out ? 'out' : 'in'}|${other}|${f.commodity}|${f.kind ?? 'people'}`;
    const row = routes.get(key)
      ?? { out, other, commodity: f.commodity, kind: f.kind ?? 'people', qty: 0, value: 0, deals: 0, last: 0 };
    row.qty += f.qty;
    row.value += f.value;
    row.deals++;
    row.last = Math.max(row.last, f.tick);
    routes.set(key, row);
  }
  const rows = [...routes.values()].sort((a, b) => b.value - a.value).slice(0, 12);

  const sig = rows.map((r) => `${r.out}${r.other}${r.commodity}${r.deals}${Math.round(r.value)}`).join('|');
  if (refs.flows.dataset.sig === sig) return;
  refs.flows.dataset.sig = sig;

  if (!rows.length) {
    refs.flows.replaceChildren(html('<li class="muted">No trade yet. Produce past what your own people eat, and the surplus goes looking for a buyer.</li>'));
    return;
  }
  refs.flows.replaceChildren(...rows.map((r) => {
    // Whether the exchange found this route for you or you wrote it by name.
    // Both are contracts; only one of them was your idea.
    const feed = !r.out && r.kind === 'contract';
    return html(`
      <li class="flow" data-dir="${r.out ? 'out' : 'in'}">
        <span class="flow__arrow">${r.out ? '↗' : '↙'}</span>
        <span class="flow__what">${qtyShort(r.qty)} ${COMMODITIES[r.commodity].name}${feed ? ' <span class="flow__tag">contract</span>' : ''}</span>
        <span class="flow__who">${r.out ? 'to' : 'from'} ${ownerName(r.other)} <span class="flow__tick">&times;${num(r.deals)}</span></span>
        <b class="flow__value">${r.out ? '+' : '-'}${money(r.value)}</b>
      </li>`);
  }));
}

// Messages clear themselves after CONFIG.alertTtlMs (main.js sweeps them on a
// timer, so they go whether or not the game is running). Each one animates for
// exactly that long, which is what makes an alert readable as "this just
// happened" rather than as a log line that has always been there.
export function updateAlerts(host, ctx) {
  const { state } = ctx;
  const sig = state.alerts.map((a) => `${a.text}#${a.count}#${a.at ?? 0}`).join('|');
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  host.replaceChildren(...state.alerts.map((alert) => {
    const li = html(`<li class="alert" data-kind="${alert.kind}"><span class="alert__text"></span><button type="button" class="alert__close" title="Dismiss">&times;</button></li>`);
    li.style.setProperty('--ttl', `${CONFIG.alertTtlMs}ms`);
    li.querySelector('.alert__text').textContent = alert.count > 1 ? `${alert.text} x${alert.count}` : alert.text;
    li.querySelector('.alert__close').addEventListener('click', () => ctx.onDismissAlert(alert));
    return li;
  }));
}

// The tooltip is plain text, so it cannot carry the entities the row markup uses.
function plainRecipe(def) {
  if (!def.recipe) return `stores goods, radius ${def.radius}`;
  const side = (bag) => Object.entries(bag).map(([id, qty]) => `${qty} ${COMMODITIES[id].name}`).join(' + ');
  const inputs = Object.keys(def.recipe.in).length ? side(def.recipe.in) : 'nothing';
  return `${inputs} -> ${side(def.recipe.out)} every ${def.recipe.ticks}t`;
}

// A unit has no recipe — it has a batch it costs and a bill it runs up — so the
// two sides of its box are the same bag written twice, at two scales.
function bagLine(bag) {
  return Object.entries(bag).map(([id, qty]) => `${qty} ${COMMODITIES[id].name}`).join(' + ');
}

function recipeLine(def) {
  if (!def.recipe) return `stores goods &middot; radius ${def.radius}`;
  const side = (bag) => Object.entries(bag).map(([id, qty]) => `${qty} ${COMMODITIES[id].name}`).join(' + ');
  const inputs = Object.keys(def.recipe.in).length ? side(def.recipe.in) : '&mdash;';
  return `${inputs} &rarr; ${side(def.recipe.out)} / ${def.recipe.ticks}t`;
}
