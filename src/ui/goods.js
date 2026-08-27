import { BUILDINGS } from '../data/buildings.js';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities.js';
import { warehouseStock, appetite } from '../core/state.js';
import { qtyShort, num, setAttr, setText, html } from './format.js';

// The commodity book: for every one of the thirty-four goods, what your industry
// made, what your industry burned, what your people bought, what left the
// country and what came into it — with the part of that last figure that went to
// your FACTORIES rather than your people called out, because that is the number
// that answers "can I run a steel mill without a coalfield".
//
// The treasury only ever shows money, and Prices only ever shows one market.
// This is the only place that shows goods.
const VIEWS = [
  { id: 'tick', label: 'Per tick', title: 'The tick that just ran.' },
  { id: 'total', label: 'This game', title: 'Everything since the game began.' },
];

export function mountGoods(refs, ctx) {
  refs.goodsView.replaceChildren(...VIEWS.map((view) => {
    const btn = html(`<button type="button" class="speed" data-view="${view.id}">${view.label}</button>`);
    btn.title = view.title;
    btn.addEventListener('click', () => ctx.onGoodsView(view.id));
    return btn;
  }));

  refs.goodsBody.replaceChildren(...COMMODITY_IDS.map((id) => {
    const def = COMMODITIES[id];
    return html(`
      <tr data-commodity="${id}">
        <th scope="row"><i class="swatch" style="--swatch:${def.color}"></i>${def.name}</th>
        <td class="goods__made"></td>
        <td class="goods__used"></td>
        <td class="goods__sold"></td>
        <td class="goods__want"></td>
        <td class="goods__burn"></td>
        <td class="goods__balance"></td>
        <td class="goods__out"></td>
        <td class="goods__in"></td>
        <td class="goods__held"></td>
      </tr>`);
  }));
}

// What your own factories are set up to burn, per commodity per tick, whether
// or not they are actually running. This is the standing demand a contract has
// to cover — the difference between "my plants ate six coal last tick" and "my
// plants need six coal a tick for as long as they stand".
function industrialBurn(state) {
  const burn = {};
  for (const b of state.buildings) {
    if (b.owner !== state.home) continue;
    const recipe = BUILDINGS[b.type].recipe;
    if (!recipe) continue;
    for (const [id, qty] of Object.entries(recipe.in)) {
      burn[id] = (burn[id] ?? 0) + qty / recipe.ticks;
    }
  }
  return burn;
}

// ...and what it turns out, the same way. The pair is what makes the balance
// column mean anything: made minus burned minus eaten is the surplus you have
// to place, or the hole you have to fill.
function industrialMake(state) {
  const make = {};
  for (const b of state.buildings) {
    if (b.owner !== state.home) continue;
    const recipe = BUILDINGS[b.type].recipe;
    if (!recipe) continue;
    for (const [id, qty] of Object.entries(recipe.out)) {
      make[id] = (make[id] ?? 0) + qty / recipe.ticks;
    }
  }
  return make;
}

export function updateGoods(refs, ctx) {
  const { state, ui } = ctx;
  const book = state.ledger?.[ui.goodsView] ?? state.ledger?.tick ?? {};
  const perTick = ui.goodsView === 'tick';

  for (const btn of refs.goodsView.children) {
    setAttr(btn, 'data-active', btn.dataset.view === ui.goodsView ? 'true' : null);
  }

  // The three standing figures, indexed once rather than per row.
  const burn = industrialBurn(state);
  const make = industrialMake(state);

  let idle = 0;
  for (const row of refs.goodsBody.children) {
    const id = row.dataset.commodity;
    const line = book[id] ?? {};
    const held = warehouseStock(state, id);
    const touched = (line.made ?? 0) + (line.used ?? 0) + (line.sold ?? 0)
      + (line.exported ?? 0) + (line.imported ?? 0) + held;
    if (touched <= 0.05) idle++;
    // A commodity you have never touched is still listed — its row is simply
    // pushed back, so the table stays the same thirty-four lines in the same
    // order rather than reshuffling under the cursor every tick.
    setAttr(row, 'data-idle', touched <= 0.05 ? 'true' : null);

    setText(row.querySelector('.goods__made'), figure(line.made, perTick));
    setText(row.querySelector('.goods__used'), figure(line.used, perTick));
    setText(row.querySelector('.goods__sold'), figure(line.sold, perTick));

    // The three standing figures are always PER TICK, whichever view is on —
    // they are a rate the nation runs at, not a total it has accumulated, and
    // showing "your people want 41,000 food" would be nonsense.
    const want = appetite(state, state.home, id);
    const eats = burn[id] ?? 0;
    const balance = (make[id] ?? 0) - eats - want;
    setText(row.querySelector('.goods__want'), want > 0.05 ? want.toFixed(1) : '·');
    setText(row.querySelector('.goods__burn'), eats > 0.05 ? eats.toFixed(1) : '·');

    const bal = row.querySelector('.goods__balance');
    setText(bal, Math.abs(balance) < 0.05 ? '·' : `${balance > 0 ? '+' : ''}${balance.toFixed(1)}`);
    // Short is the figure that decides whether you can take a bid, so it is the
    // one that gets a colour.
    setAttr(bal, 'data-dir', balance > 0.05 ? 'up' : balance < -0.05 ? 'down' : null);

    setText(row.querySelector('.goods__out'), figure(line.exported, perTick));

    const inn = row.querySelector('.goods__in');
    const feed = line.feedstock ?? 0;
    setText(inn, feed > 0.05
      ? `${figure(line.imported, perTick)} (${figure(feed, perTick)})`
      : figure(line.imported, perTick));
    setAttr(inn, 'data-feed', feed > 0.05 ? 'true' : null);

    setText(row.querySelector('.goods__held'), held > 0.5 ? qtyShort(held) : '·');
    // The one thing on this table that is not history: what your people are
    // still waiting for.
    row.title = `${COMMODITIES[id].name} — your people want ${want.toFixed(1)} a tick, your factories burn ${eats.toFixed(1)}, and you make ${(make[id] ?? 0).toFixed(1)}`;
  }

  setText(refs.goodsNote, perTick
    ? `The tick just run. ${num(COMMODITY_IDS.length - idle)} of ${num(COMMODITY_IDS.length)} commodities moved.`
    : 'Everything since the game began. A commodity you buy in for your factories shows the feedstock share in brackets.');
}

// Fractions matter per tick — half a unit of aluminium is a real rate — and are
// noise once a game's worth of them have been added up.
function figure(value, perTick) {
  const qty = value ?? 0;
  if (qty <= 0.005) return '·';
  if (!perTick) return qtyShort(qty);
  return qty >= 100 ? qtyShort(qty) : qty.toFixed(1);
}
