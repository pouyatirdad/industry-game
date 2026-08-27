import { CONFIG } from '../core/config.js';
import { BUILDINGS, BUILDING_IDS } from '../data/buildings.js';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities.js';
import { COUNTRIES, COUNTRY_IDS, pactCost } from '../data/countries.js';
import { distanceBetween, MAX_DISTANCE } from '../data/geography.js';
import { projectedWages, warehouseStock, appetite, hasPact, ownerName, ownFlows } from '../core/state.js';
import { supplyRatio } from '../systems/domestic.js';
import { offerLeft } from '../systems/diplomacy.js';
import { money, moneyShort, num, price, priceShort, qtyShort, pct, setAttr, setText, setToggle, html } from './format.js';

export function mountDashboard(refs, ctx) {
  refs.speeds.replaceChildren(...CONFIG.speeds.map((speed) => {
    const btn = html(`<button type="button" class="speed" data-speed="${speed}">${speed}x</button>`);
    btn.addEventListener('click', () => ctx.onSpeed(speed));
    return btn;
  }));

  refs.buildMenu.replaceChildren(...BUILDING_IDS.map((id) => {
    const def = BUILDINGS[id];
    // One line per industry: twenty-two of them have to fit a column you can
    // take in at a glance. The recipe unfolds only for the tool in your hand,
    // and the full story is on the tooltip, written in updateDashboard because
    // wages depend on which nation you govern.
    const item = html(`
      <button type="button" class="build" data-type="${id}">
        <span class="build__glyph">${def.glyph}</span>
        <span class="build__name">${def.name}</span>
        <b class="build__cost"></b>
        <span class="build__recipe">${recipeLine(def)}</span>
      </button>`);
    item.addEventListener('click', () => ctx.onSelectTool(id));
    return item;
  }));

  refs.zoom.replaceChildren(...CONFIG.zoomLevels.map((px, index) => {
    const btn = html(`<button type="button" class="speed" data-zoom="${index}">${px}px</button>`);
    btn.addEventListener('click', () => ctx.onZoom(index));
    return btn;
  }));

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

  const countryOptions = () => COUNTRY_IDS.map((id) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = COUNTRIES[id].name;
    return opt;
  });

  refs.homeSelect.replaceChildren(...countryOptions());
  refs.homeSelect.value = ctx.state.home;

  // Prices are per nation, so the market panel is always a view of ONE market.
  refs.marketCountry.replaceChildren(...countryOptions());
  refs.marketCountry.value = ctx.ui.marketCountry;
  refs.marketCountry.addEventListener('change', () => ctx.onMarketCountry(refs.marketCountry.value));

  refs.market.replaceChildren(...COMMODITY_IDS.map((id) => {
    const def = COMMODITIES[id];
    const row = html(`
      <tr data-commodity="${id}">
        <th scope="row"><i class="swatch" style="--swatch:${def.color}"></i>${def.name}</th>
        <td class="market__price"></td>
        <td class="market__drift"></td>
        <td class="market__demand"></td>
        <td class="market__met"></td>
        <td class="market__stock"></td>
        <td><button type="button" class="flag flag--out" title="Offer the surplus abroad">↗</button></td>
        <td><button type="button" class="flag flag--in" title="Buy from abroad — what your people are short of, and what your factories need">↙</button></td>
      </tr>`);
    row.querySelector('.flag--out').addEventListener('click', () => ctx.onToggleExport(id));
    row.querySelector('.flag--in').addEventListener('click', () => ctx.onToggleImport(id));
    return row;
  }));

  refs.pause.addEventListener('click', ctx.onTogglePause);
  refs.save.addEventListener('click', ctx.onSave);
  refs.load.addEventListener('click', ctx.onLoad);
  refs.reset.addEventListener('click', ctx.onReset);
}

export function updateDashboard(refs, ctx) {
  const { state, ui } = ctx;
  const me = state.countries[state.home];
  const wages = projectedWages(state);
  const balance = me.report.exports - me.report.imports;

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
  for (const btn of refs.zoom.children) {
    setAttr(btn, 'data-active', Number(btn.dataset.zoom) === ui.zoom ? 'true' : null);
  }

  const mul = COUNTRIES[state.home].wageMul;
  for (const btn of refs.buildMenu.children) {
    const def = BUILDINGS[btn.dataset.type];
    const wages = money(Math.round(def.wages * mul));
    setText(btn.querySelector('.build__cost'), moneyShort(def.cost));
    setAttr(btn, 'title', `${def.name} — ${plainRecipe(def)}. ${money(def.cost)} to build, ${wages}/tick wages. ${def.blurb}`);
    setAttr(btn, 'data-active', ui.tool === btn.dataset.type ? 'true' : null);
    setAttr(btn, 'data-affordable', me.cash >= def.cost ? 'true' : 'false');
  }

}

// The panes below are driven by whichever tab is on screen rather than by every
// render: a hidden pane cannot be read, so repainting it is work nobody sees.
export function updateResources(refs, ctx) {
  updateMarket(refs, ctx);
}

export function updateTrade(refs, ctx) {
  updateTradeHead(refs, ctx);
  updateOffers(refs, ctx);
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
  let feedstock = 0;
  for (const id of COMMODITY_IDS) {
    const line = book[id];
    if (!line) continue;
    out += line.exported;
    inn += line.imported;
    earned += line.earned;
    paid += line.paid;
    feedstock += line.feedstock;
  }
  const partners = COUNTRY_IDS.filter((id) => id !== state.home && hasPact(state, id)).length;
  const balance = me.report.exports - me.report.imports;
  // How much of the game the grouped deal list below actually covers, so a route
  // worth "+$780" reads as a rate rather than as a total out of nowhere.
  const kept = ownFlows(state);
  const deals = kept.length;
  const window = deals ? state.tick - kept[0].tick + 1 : 0;

  const sig = [Math.round(out), Math.round(inn), Math.round(earned), Math.round(paid),
    Math.round(feedstock), partners, balance, deals, window].join('|');
  if (refs.tradeHead.dataset.sig === sig) return;
  refs.tradeHead.dataset.sig = sig;

  refs.tradeHead.replaceChildren(html(`
    <dl class="facts facts--four">
      <div><dt>Shipped out</dt><dd>${qtyShort(out)} <span class="muted">${money(earned)}</span></dd></div>
      <div><dt>Bought in</dt><dd>${qtyShort(inn)} <span class="muted">${money(paid)}</span></dd></div>
      <div><dt>Balance / tick</dt><dd class="${balance < 0 ? 'is-negative' : ''}">${balance >= 0 ? '+' : ''}${money(balance)}</dd></div>
      <div><dt>Markets open</dt><dd>${num(partners)} / ${COUNTRY_IDS.length - 1}</dd></div>
      <div><dt title="Imports that went to your factories rather than your people">For industry</dt><dd>${qtyShort(feedstock)} <span class="muted">units in</span></dd></div>
      <div><dt title="How many deals the list below covers, and how many ticks that is">Deals below</dt><dd>${num(deals)} <span class="muted">/ ${num(window)}t</span></dd></div>
    </dl>`));
}

// Pacts the other governments have offered YOU. They pay, because they are the
// ones asking — so an offer is money as well as a market.
function updateOffers(refs, ctx) {
  const { state } = ctx;
  const offers = state.offers ?? [];
  const sig = offers.map((o) => `${o.from}${o.fee}${offerLeft(state, o)}`).join('|');
  if (refs.offers.dataset.sig === sig) return;
  refs.offers.dataset.sig = sig;

  if (!offers.length) {
    refs.offers.replaceChildren(html('<p class="muted hint--tight">Nobody is asking just now. A nation with goods it cannot place at home, or people it cannot feed, will come to you.</p>'));
    return;
  }
  refs.offers.replaceChildren(...offers.map((offer) => {
    const c = COUNTRIES[offer.from];
    const node = html(`
      <div class="offer">
        <div class="offer__who">
          <i class="country__swatch" style="--swatch:${c.color}"></i>
          <span class="offer__name">${c.name}</span>
          <b class="offer__fee">+${money(offer.fee)}</b>
        </div>
        <p class="offer__note muted">Wants your market &middot; lapses in ${num(offerLeft(state, offer))} ticks</p>
        <div class="offer__act">
          <button type="button" class="primary offer__yes">Accept</button>
          <button type="button" class="offer__no">Decline</button>
        </div>
      </div>`);
    node.querySelector('.offer__yes').addEventListener('click', () => ctx.onAcceptOffer(offer.from));
    node.querySelector('.offer__no').addEventListener('click', () => ctx.onDeclineOffer(offer.from));
    return node;
  }));
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
  const pacts = COUNTRY_IDS.filter((id) => id !== state.home && hasPact(state, id)).length;
  // Rebuilt only when something on it actually changed — this panel is cheap,
  // but it is repainted every tick and the meter animates if it churns.
  const sig = [state.home, Math.round(me.cash), me.report.net, wages, sites, pacts,
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

  for (const row of refs.countries.children) {
    const id = row.dataset.country;
    const c = COUNTRIES[id];
    const gov = state.countries[id];
    const home = id === state.home;
    const pact = hasPact(state, id);
    setAttr(row, 'data-open', String(home || pact));
    setAttr(row, 'data-home', home ? 'true' : null);
    row.title = home
      ? 'Your own nation.'
      : `${c.name} — wages ×${c.wageMul.toFixed(2)}, ${Math.round(haul(state.home, id) * 100)}% of a world haul away, pact ${money(pactCost(id))}`;
    setText(row.querySelector('.country__meta'), home
      ? `home · ${num(sites.get(id) ?? 0)} sites`
      : pact
        ? `pact · ${gov.demand.toFixed(1)} econ · ${num(sites.get(id) ?? 0)} sites`
        : `no pact · ${money(pactCost(id))}`);
  }
}

function haul(a, b) {
  return MAX_DISTANCE ? distanceBetween(a, b) / MAX_DISTANCE : 0;
}

function updateMarket(refs, ctx) {
  const { state, ui } = ctx;
  const where = ui.marketCountry;
  const market = state.markets[where];
  const mine = where === state.home;

  setText(refs.marketNote, mine
    ? 'Your own market: prices fall as you supply your people, and rise when you do not.'
    : `${COUNTRIES[where].name} — ${hasPact(state, where) ? 'pact signed, you may trade here' : 'no pact: you cannot trade here yet'}.`);

  for (const row of refs.market.children) {
    const id = row.dataset.commodity;
    const def = COMMODITIES[id];
    const line = market[id];
    const drift = Math.round(((line.price - def.basePrice) / def.basePrice) * 100);
    setText(row.querySelector('.market__price'), priceShort(line.price));
    setText(row.querySelector('.market__drift'), `${drift > 0 ? '▲' : drift < 0 ? '▼' : '·'}${Math.abs(drift)}%`);
    setAttr(row.querySelector('.market__drift'), 'data-dir', drift > 0 ? 'up' : drift < 0 ? 'down' : 'flat');
    setText(row.querySelector('.market__demand'), appetite(state, where, id).toFixed(1));

    const met = supplyRatio(state, where, id);
    setText(row.querySelector('.market__met'), pct(met));
    setAttr(row.querySelector('.market__met'), 'data-short', met < 1 ? 'true' : 'false');
    setText(row.querySelector('.market__stock'), qtyShort(warehouseStock(state, id)));

    // The flags are always YOUR policy, whichever market is on screen.
    const out = row.querySelector('.flag--out');
    const inn = row.querySelector('.flag--in');
    setAttr(out, 'data-on', state.exports[id] ? 'true' : 'false');
    setAttr(inn, 'data-on', state.imports[id] ? 'true' : 'false');
  }
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
    // A cargo bought for your own factories is a different thing from one your
    // people ate, and it is the only way to see the feedstock channel working.
    const feed = !r.out && r.kind === 'industry';
    return html(`
      <li class="flow" data-dir="${r.out ? 'out' : 'in'}">
        <span class="flow__arrow">${r.out ? '↗' : '↙'}</span>
        <span class="flow__what">${qtyShort(r.qty)} ${COMMODITIES[r.commodity].name}${feed ? ' <span class="flow__tag">factories</span>' : ''}</span>
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

function recipeLine(def) {
  if (!def.recipe) return `stores goods &middot; radius ${def.radius}`;
  const side = (bag) => Object.entries(bag).map(([id, qty]) => `${qty} ${COMMODITIES[id].name}`).join(' + ');
  const inputs = Object.keys(def.recipe.in).length ? side(def.recipe.in) : '&mdash;';
  return `${inputs} &rarr; ${side(def.recipe.out)} / ${def.recipe.ticks}t`;
}
