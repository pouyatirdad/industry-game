import { BUILDINGS } from '../data/buildings.js';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities.js';
import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { warehouseStock, appetite, spareRates } from '../core/state.js';
import { supplyRatio } from '../systems/domestic.js';
import { num, pct, priceShort, qtyShort, setAttr, setText, html } from './format.js';

// THE COMMODITY BOOK — one table, one line a commodity.
//
// Prices and Goods used to be two tabs, and then two tables stacked in one
// pane, which meant the price of coal was in one place and what you were doing
// with coal was in another. They are the same thirty-four rows in the same
// order, so they are now the same table: the first group of columns is the
// market named in the header (which may be any nation on earth), the second is
// your own book, and the trade flags at the end are your policy.
//
// The treasury only ever shows money and the exchange only ever shows listings.
// This is the only place that shows GOODS.
const VIEWS = [
  { id: 'tick', label: 'Per tick', title: 'The tick that just ran.' },
  { id: 'total', label: 'This game', title: 'Everything since the game began.' },
];

export function mountResources(refs, ctx) {
  const countryOptions = () => COUNTRY_IDS.map((id) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = COUNTRIES[id].name;
    return opt;
  });

  // Prices are per nation, so the market half is always a view of ONE market.
  refs.pricesCountry.replaceChildren(...countryOptions());
  refs.pricesCountry.value = ctx.ui.marketCountry;
  refs.pricesCountry.addEventListener('change', () => ctx.onMarketCountry(refs.pricesCountry.value));

  refs.allSellOn.addEventListener('click', () => ctx.onSetAllExports(true));
  refs.allSellOff.addEventListener('click', () => ctx.onSetAllExports(false));
  refs.allBuyOn.addEventListener('click', () => ctx.onSetAllImports(true));
  refs.allBuyOff.addEventListener('click', () => ctx.onSetAllImports(false));

  refs.pricesView.replaceChildren(...VIEWS.map((view) => {
    const btn = html(`<button type="button" class="speed" data-view="${view.id}">${view.label}</button>`);
    btn.title = view.title;
    btn.addEventListener('click', () => ctx.onGoodsView(view.id));
    return btn;
  }));

  // Thirty-four fixed rows, built once here: only the figures are written each
  // tick, exactly as the factory list and the ranks table work. One row carries
  // BOTH halves — the market on the left of the line, your own book on the
  // right — because they are the same commodity and splitting them into two
  // tables meant reading one line twice.
  refs.pricesBody.replaceChildren(...COMMODITY_IDS.map((id) => {
    const def = COMMODITIES[id];
    const row = html(`
      <tr data-commodity="${id}">
        <th scope="row"><i class="swatch" style="--swatch:${def.color}"></i>${def.name}</th>
        <td class="market__price"></td>
        <td class="market__base"></td>
        <td class="market__drift"></td>
        <td class="market__demand"></td>
        <td class="market__met"></td>
        <td class="market__stock"></td>
        <td class="goods__made"></td>
        <td class="goods__used"></td>
        <td class="goods__sold"></td>
        <td class="goods__balance"></td>
        <td class="goods__out"></td>
        <td class="goods__in"></td>
        <td class="prices__flags">
          <button type="button" class="flag flag--out" title="Offer the surplus abroad">&#8599;</button
          ><button type="button" class="flag flag--in" title="Buy from abroad — what your people are short of, and what your factories need">&#8601;</button>
        </td>
      </tr>`);
    row.querySelector('.flag--out').addEventListener('click', () => ctx.onToggleExport(id));
    row.querySelector('.flag--in').addEventListener('click', () => ctx.onToggleImport(id));
    return row;
  }));
}

export function updateResources(refs, ctx) {
  const { state, ui } = ctx;
  const where = ui.marketCountry;
  const market = state.markets[where];
  const mine = where === state.home;
  const book = state.ledger?.[ui.goodsView] ?? state.ledger?.tick ?? {};
  const perTick = ui.goodsView === 'tick';

  for (const btn of refs.pricesView.children) {
    setAttr(btn, 'data-active', btn.dataset.view === ui.goodsView ? 'true' : null);
  }
  setText(refs.pricesWhere, mine ? 'Your market' : COUNTRIES[where].name);

  // The standing rates, indexed once rather than per row: what your own plants
  // are set up to burn and to turn out, whether or not they ran this tick.
  const burn = factoryFlow(state, state.home, 'in');
  // The same figure the contract offers are filtered against, from the same
  // function — two definitions of "spare" would drift the first time either was
  // touched, and this table would then promise rates the offers refuse.
  const spare = spareRates(state, state.home);
  const make = factoryFlow(state, state.home, 'out');
  const usage = mine ? burn : factoryFlow(state, where, 'in');

  // Each bulk button lights up when the whole side already stands that way, so
  // "Sell all" on a book that is already all-sell reads as a switch that is
  // ON rather than as a button that did nothing when you pressed it.
  const every = (flags, want) => COMMODITY_IDS.every((id) => Boolean(flags[id]) === want);
  setAttr(refs.allSellOn, 'data-active', every(state.exports, true) ? 'true' : null);
  setAttr(refs.allSellOff, 'data-active', every(state.exports, false) ? 'true' : null);
  setAttr(refs.allBuyOn, 'data-active', every(state.imports, true) ? 'true' : null);
  setAttr(refs.allBuyOff, 'data-active', every(state.imports, false) ? 'true' : null);

  let idle = 0;
  for (const row of refs.pricesBody.children) {
    const id = row.dataset.commodity;
    const def = COMMODITIES[id];
    const line = market[id];

    const drift = Math.round(((line.price - def.basePrice) / def.basePrice) * 100);
    setText(row.querySelector('.market__price'), priceShort(line.price));
    setText(row.querySelector('.market__base'), priceShort(def.basePrice));
    const dr = row.querySelector('.market__drift');
    setText(dr, `${drift > 0 ? '▲' : drift < 0 ? '▼' : '·'}${Math.abs(drift)}%`);
    setAttr(dr, 'data-dir', drift > 0 ? 'up' : drift < 0 ? 'down' : 'flat');

    // The market half is always PER TICK: an appetite is a rate the nation runs
    // at, and "its people want 41,000 food" would be nonsense.
    const want = appetite(state, where, id);
    setText(row.querySelector('.market__demand'), want > 0.05 ? want.toFixed(1) : '·');

    const met = supplyRatio(state, where, id);
    const metCell = row.querySelector('.market__met');
    setText(metCell, pct(met));
    setAttr(metCell, 'data-short', met < 1 ? 'true' : 'false');

    const stock = warehouseStock(state, id, where);
    setText(row.querySelector('.market__stock'), stock > 0.5 ? qtyShort(stock) : '·');

    // ...and the rest of the same line is YOUR book, whichever market the left
    // of it happens to be showing.
    const led = book[id] ?? {};
    const held = mine ? stock : warehouseStock(state, id, state.home);

    setText(row.querySelector('.goods__made'), figure(led.made, perTick));
    setText(row.querySelector('.goods__used'), figure(led.used, perTick));
    setText(row.querySelector('.goods__sold'), figure(led.sold, perTick));

    // What you have spare once your own factories and your own people are
    // served — the rate a contract has to cover, so it is always per tick.
    const balance = spare[id] ?? 0;
    const bal = row.querySelector('.goods__balance');
    setText(bal, Math.abs(balance) < 0.05 ? '·' : `${balance > 0 ? '+' : ''}${balance.toFixed(1)}`);
    setAttr(bal, 'data-dir', balance > 0.05 ? 'up' : balance < -0.05 ? 'down' : null);

    setText(row.querySelector('.goods__out'), figure(led.exported, perTick));

    const inn = row.querySelector('.goods__in');
    const feed = led.feedstock ?? 0;
    setText(inn, feed > 0.05
      ? `${figure(led.imported, perTick)} (${figure(feed, perTick)})`
      : figure(led.imported, perTick));
    setAttr(inn, 'data-feed', feed > 0.05 ? 'true' : null);

    // A commodity nobody has touched keeps its row and its place in the table —
    // it just stops competing for your attention.
    const touched = (led.made ?? 0) + (led.used ?? 0) + (led.sold ?? 0)
      + (led.exported ?? 0) + (led.imported ?? 0) + held;
    if (touched <= 0.05) idle++;
    setAttr(row, 'data-idle', touched <= 0.05 ? 'true' : null);

    // The flags are always YOUR policy, whichever market is on screen.
    setAttr(row.querySelector('.flag--out'), 'data-on', state.exports[id] ? 'true' : 'false');
    setAttr(row.querySelector('.flag--in'), 'data-on', state.imports[id] ? 'true' : 'false');

    row.title = `${def.name} — ${mine ? 'your people' : `${COUNTRIES[where].name}'s people`} want ${want.toFixed(1)} a tick and ${(usage[id] ?? 0).toFixed(1)} goes to its factories. You make ${(make[id] ?? 0).toFixed(1)} and burn ${(burn[id] ?? 0).toFixed(1)}.`;
  }

  setText(refs.pricesNote, `${mine
    ? 'Your own market: prices fall as you supply your people, and rise when you do not.'
    : `${COUNTRIES[where].name} — what its people pay. Post terms it will take on the exchange, or take its own.`} ${perTick
    ? `${num(COMMODITY_IDS.length - idle)} of ${num(COMMODITY_IDS.length)} commodities moved last tick.`
    : 'Your own figures are the whole game so far.'}`);
}

// What a nation's plants are set up to burn (`in`) or turn out (`out`) per tick,
// whether or not they are actually running. This is the standing demand a
// contract has to cover — the difference between "my plants ate six coal last
// tick" and "my plants need six coal a tick for as long as they stand".
function factoryFlow(state, countryId, side) {
  const flow = {};
  for (const b of state.buildings) {
    if (b.owner !== countryId) continue;
    const recipe = BUILDINGS[b.type].recipe;
    if (!recipe) continue;
    for (const [id, qty] of Object.entries(recipe[side])) {
      flow[id] = (flow[id] ?? 0) + qty / recipe.ticks;
    }
  }
  return flow;
}

// Fractions matter per tick — half a unit of aluminium is a real rate — and are
// noise once a game's worth of them have been added up.
function figure(value, perTick) {
  const qty = value ?? 0;
  if (qty <= 0.005) return '·';
  if (!perTick) return qtyShort(qty);
  return qty >= 100 ? qtyShort(qty) : qty.toFixed(1);
}
