import { CONFIG } from '../core/config.js';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities.js';
import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { contractsOf, contractLeft, isPlayer, ownerName, warehouseStock } from '../core/state.js';
import { contractOfferLeft } from '../systems/contracts.js';
import { contractQuote } from '../actions.js';
import { money, moneyShort, num, price, qtyShort, setAttr, setText, html } from './format.js';

// Contracts, in the Trade tab. The deal list below them answers "what happened
// on the spot market"; this answers "what have I actually promised, and what
// has been promised to me".
//
// The draft form is mounted ONCE and never rebuilt — a select that is replaced
// while you are choosing from it closes itself, and the whole point of the form
// is that you are in the middle of using it. Only the quote and the button
// state are written per tick.
export function mountContracts(refs, ctx) {
  const wrap = html(`
    <div class="draft__inner">
      <div class="draft__grid">
        <label class="draft__field"><span>I want to</span>
          <select class="draft__dir">
            <option value="buy">buy</option>
            <option value="sell">sell</option>
          </select></label>
        <label class="draft__field"><span>Commodity</span><select class="draft__commodity"></select></label>
        <label class="draft__field"><span>Partner</span><select class="draft__partner"></select></label>
        <label class="draft__field"><span>Units</span><input class="draft__qty" type="number" min="0.1" step="0.1"></label>
        <label class="draft__field"><span>Every</span><input class="draft__every" type="number" min="1" step="1"></label>
        <label class="draft__field"><span>For (ticks)</span><input class="draft__term" type="number" min="0" step="5"></label>
      </div>
      <p class="draft__quote muted"></p>
      <button type="button" class="primary draft__sign">Propose contract</button>
    </div>`);
  refs.contractDraft.replaceChildren(wrap);

  const commodity = wrap.querySelector('.draft__commodity');
  commodity.replaceChildren(...COMMODITY_IDS.map((id) => option(id, COMMODITIES[id].name)));

  const partner = wrap.querySelector('.draft__partner');
  partner.replaceChildren(...COUNTRY_IDS.filter((id) => id !== ctx.state.home)
    .map((id) => option(id, COUNTRIES[id].name)));

  const read = () => ({
    dir: wrap.querySelector('.draft__dir').value,
    commodity: commodity.value,
    partner: partner.value,
    qty: Number(wrap.querySelector('.draft__qty').value),
    every: Number(wrap.querySelector('.draft__every').value),
    term: Number(wrap.querySelector('.draft__term').value),
  });
  for (const el of wrap.querySelectorAll('select, input')) {
    el.addEventListener('change', () => ctx.onDraft(read()));
  }
  wrap.querySelector('.draft__sign').addEventListener('click', () => ctx.onSignContract());
  refs.contractDraft.dataset.mounted = 'true';
}

function option(value, label) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  return opt;
}

export function updateContracts(refs, ctx) {
  updateDraft(refs, ctx);
  updateOffers(refs, ctx);
  updateList(refs, ctx);
}

function updateDraft(refs, ctx) {
  const { state, ui } = ctx;
  const draft = ui.draft;
  const wrap = refs.contractDraft.firstElementChild;
  if (!wrap) return;

  // Every nation on earth. There is no permission to trade any more — what
  // stops a deal is the other side refusing the terms, not an embassy.
  const open = COUNTRY_IDS.filter((id) => id !== state.home);
  const partner = wrap.querySelector('.draft__partner');
  const list = open.join(',');
  if (partner.dataset.list !== list) {
    partner.dataset.list = list;
    partner.replaceChildren(...open.map((id) => option(id, COUNTRIES[id].name)));
  }
  if (!draft.partner || !open.includes(draft.partner)) draft.partner = open[0] ?? null;

  setValue(wrap.querySelector('.draft__dir'), draft.dir);
  setValue(wrap.querySelector('.draft__commodity'), draft.commodity);
  setValue(partner, draft.partner ?? '');
  setValue(wrap.querySelector('.draft__qty'), String(draft.qty));
  setValue(wrap.querySelector('.draft__every'), String(draft.every));
  setValue(wrap.querySelector('.draft__term'), String(draft.term));

  const quote = draft.partner ? contractQuote(state, draft) : null;
  const note = wrap.querySelector('.draft__quote');
  const sign = wrap.querySelector('.draft__sign');
  if (!draft.partner) {
    setText(note, 'No market is open. Sign a trade pact first — a contract needs one.');
    setAttr(sign, 'disabled', 'disabled');
    return;
  }
  setAttr(sign, 'disabled', null);
  const perTick = draft.every > 0 ? draft.qty / draft.every : draft.qty;
  const value = (quote ?? 0) * perTick;
  const held = warehouseStock(state, draft.commodity);
  // `setText` writes textContent, so this is the character rather than an entity.
  setText(note, `${price(quote ?? 0)} a unit · ${qtyShort(perTick)}/tick · ${draft.dir === 'buy' ? '-' : '+'}${money(value)}/tick`
    + (draft.dir === 'sell' ? ` · you hold ${qtyShort(held)}` : ''));
  setText(sign, draft.term > 0
    ? `Propose ${draft.dir} for ${num(draft.term)} ticks`
    : `Propose a single ${draft.dir === 'buy' ? 'purchase' : 'sale'}`);
}

function setValue(el, value) {
  if (el && el.value !== value) el.value = value;
}

function updateOffers(refs, ctx) {
  const { state } = ctx;
  const offers = state.contractOffers ?? [];
  const sig = offers.map((o) => `${o.from}${o.dir}${o.commodity}${o.qty}${contractOfferLeft(state, o)}`).join('|');
  if (refs.contractOffers.dataset.sig === sig) return;
  refs.contractOffers.dataset.sig = sig;

  if (!offers.length) { refs.contractOffers.replaceChildren(); return; }
  refs.contractOffers.replaceChildren(...offers.map((offer) => {
    const c = COUNTRIES[offer.from];
    const good = COMMODITIES[offer.commodity];
    const supplying = offer.dir === 'sell';
    const perTick = (offer.qty / offer.every) * offer.price;
    const node = html(`
      <div class="offer">
        <div class="offer__who">
          <i class="country__swatch" style="--swatch:${c.color}"></i>
          <span class="offer__name">${supplying ? 'Will supply' : 'Wants to buy'} ${offer.qty} ${good.name}/${offer.every}t</span>
          <b class="offer__fee ${supplying ? 'is-negative' : ''}">${supplying ? '-' : '+'}${moneyShort(perTick)}/t</b>
        </div>
        <p class="offer__note muted">${c.name} &middot; ${price(offer.price)} a unit for ${num(offer.term)} ticks &middot; lapses in ${num(contractOfferLeft(state, offer))}</p>
        <div class="offer__act">
          <button type="button" class="primary offer__yes">Sign</button>
          <button type="button" class="offer__no">Decline</button>
        </div>
      </div>`);
    node.querySelector('.offer__yes').addEventListener('click', () => ctx.onAcceptContract(offer));
    node.querySelector('.offer__no').addEventListener('click', () => ctx.onDeclineContract(offer));
    return node;
  }));
}

// Your standing book. Each row says what was promised, how much of it has
// actually moved, and whether anybody has missed — which is the whole reason to
// look at it rather than at the deal list.
function updateList(refs, ctx) {
  const { state } = ctx;
  const rows = contractsOf(state, state.home);
  const sig = rows.map((c) => `${c.id}${Math.round(c.delivered ?? 0)}${Math.round(c.penalties ?? 0)}${contractLeft(state, c)}`).join('|');
  if (refs.contractList.dataset.sig === sig) return;
  refs.contractList.dataset.sig = sig;

  if (!rows.length) {
    refs.contractList.replaceChildren(html('<p class="muted hint--tight">No contracts. Everything you trade is going through the spot market, which takes the best price it can find and asks nobody.</p>'));
    return;
  }
  refs.contractList.replaceChildren(...rows.map((c) => {
    const out = isPlayer(state, c.seller);
    const good = COMMODITIES[c.commodity];
    const other = out ? c.buyer : c.seller;
    const owed = ((state.tick - c.started + c.every) / c.every) * c.qty;
    const kept = owed > 0 ? Math.min(1, (c.delivered ?? 0) / owed) : 1;
    const node = html(`
      <div class="contract" data-dir="${out ? 'out' : 'in'}" data-late="${(c.missed ?? 0) > 0.5}">
        <div class="contract__row">
          <span class="contract__arrow">${out ? '↗' : '↙'}</span>
          <span class="contract__what">${c.qty} ${good.name}<span class="muted">/${c.every}t</span></span>
          <span class="contract__who">${out ? 'to' : 'from'} ${ownerName(other)}</span>
          <b class="contract__value">${out ? '+' : '-'}${moneyShort((c.qty / c.every) * c.price)}/t</b>
          <button type="button" class="contract__kill" title="Break this contract — you pay ${Math.round(CONFIG.contracts.penalty * 100)}% of what is still owed">&times;</button>
        </div>
        <div class="contract__bar"><i class="contract__fill" style="--fill:${Math.round(kept * 100)}%"></i></div>
        <p class="contract__note muted">${price(c.price)} a unit fixed &middot; ${num(contractLeft(state, c))}t left &middot; ${qtyShort(c.delivered ?? 0)} moved${(c.missed ?? 0) > 0.5 ? ` &middot; <span class="is-negative">${qtyShort(c.missed)} short, ${money(c.penalties ?? 0)} in penalties</span>` : ''}</p>
      </div>`);
    node.querySelector('.contract__kill').addEventListener('click', () => ctx.onCancelContract(c.id));
    return node;
  }));
}
