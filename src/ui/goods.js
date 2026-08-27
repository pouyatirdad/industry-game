import { COMMODITIES, COMMODITY_IDS } from '../data/commodities.js';
import { warehouseStock, appetite } from '../core/state.js';
import { qtyShort, num, setAttr, setText, html } from './format.js';

// The commodity book: for every one of the twenty-one goods, what your industry
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
        <td class="goods__out"></td>
        <td class="goods__in"></td>
        <td class="goods__held"></td>
      </tr>`);
  }));
}

export function updateGoods(refs, ctx) {
  const { state, ui } = ctx;
  const book = state.ledger?.[ui.goodsView] ?? state.ledger?.tick ?? {};
  const perTick = ui.goodsView === 'tick';

  for (const btn of refs.goodsView.children) {
    setAttr(btn, 'data-active', btn.dataset.view === ui.goodsView ? 'true' : null);
  }

  let idle = 0;
  for (const row of refs.goodsBody.children) {
    const id = row.dataset.commodity;
    const line = book[id] ?? {};
    const held = warehouseStock(state, id);
    const touched = (line.made ?? 0) + (line.used ?? 0) + (line.sold ?? 0)
      + (line.exported ?? 0) + (line.imported ?? 0) + held;
    if (touched <= 0.05) idle++;
    // A commodity you have never touched is still listed — its row is simply
    // pushed back, so the table stays the same twenty-one lines in the same
    // order rather than reshuffling under the cursor every tick.
    setAttr(row, 'data-idle', touched <= 0.05 ? 'true' : null);

    setText(row.querySelector('.goods__made'), figure(line.made, perTick));
    setText(row.querySelector('.goods__used'), figure(line.used, perTick));
    setText(row.querySelector('.goods__sold'), figure(line.sold, perTick));
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
    row.title = `${COMMODITIES[id].name} — your people want ${appetite(state, state.home, id).toFixed(1)} per tick`;
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
