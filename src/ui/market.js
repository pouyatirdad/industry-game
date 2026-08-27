import { CONFIG } from '../core/config.js';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities.js';
import { COUNTRIES } from '../data/countries.js';
import { haulShare } from '../data/geography.js';
import { exchangeOf, isPlayer, ownerName } from '../core/state.js';
import { borrowLimit } from '../systems/exchange.js';
import { money, moneyShort, num, price, priceShort, qtyShort, setAttr, setText, html } from './format.js';

// THE GLOBAL EXCHANGE, on screen.
//
// This is the one pane that shows what the rest of the world is trying to do
// rather than what it has already done. Every ask and bid on earth is here, in
// price order, and any of them can be taken with one click — so the answer to
// "who will sell me coal" is a list rather than a guess.
//
// The form is mounted ONCE and never rebuilt, like the contract draft: a select
// replaced while you are choosing from it closes itself.
export function mountMarket(refs, ctx) {
  const wrap = html(`
    <div class="draft__inner">
      <div class="draft__grid">
        <label class="draft__field"><span>I will</span>
          <select class="post__side">
            <option value="sell">sell</option>
            <option value="buy">buy</option>
          </select></label>
        <label class="draft__field"><span>Commodity</span><select class="post__commodity"></select></label>
        <label class="draft__field"><span>Units / tick</span><input class="post__qty" type="number" min="0.1" step="0.1"></label>
        <label class="draft__field"><span>Price a unit</span><input class="post__price" type="number" min="0" step="1"></label>
        <label class="draft__field"><span>Every</span><input class="post__every" type="number" min="1" step="1"></label>
        <label class="draft__field"><span>For (ticks)</span><input class="post__term" type="number" min="1" step="10"></label>
      </div>
      <p class="draft__quote muted"></p>
      <div class="draft__act">
        <button type="button" class="post__mid">Use mid price</button>
        <button type="button" class="primary post__go">Post</button>
      </div>
    </div>`);
  refs.listingDraft.replaceChildren(wrap);

  wrap.querySelector('.post__commodity')
    .replaceChildren(...COMMODITY_IDS.map((id) => option(id, COMMODITIES[id].name)));

  const read = () => ({
    side: wrap.querySelector('.post__side').value,
    commodity: wrap.querySelector('.post__commodity').value,
    qty: Number(wrap.querySelector('.post__qty').value),
    price: Number(wrap.querySelector('.post__price').value),
    every: Number(wrap.querySelector('.post__every').value),
    term: Number(wrap.querySelector('.post__term').value),
  });
  for (const el of wrap.querySelectorAll('select, input')) {
    el.addEventListener('change', () => ctx.onListingDraft(read()));
  }
  // The commodity you picked has a price at home; this fills it in, because a
  // blank price field is the one thing that stops the form being usable at all.
  wrap.querySelector('.post__mid').addEventListener('click', () => {
    const { state, ui } = ctx;
    ctx.onListingDraft({ price: state.markets[state.home][ui.listing.commodity].price });
  });
  wrap.querySelector('.post__go').addEventListener('click', () => ctx.onPostListing());
}

function option(value, label) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  return opt;
}

export function updateMarket(refs, ctx) {
  updateHead(refs, ctx);
  updateDraft(refs, ctx);
  updateBook(refs, ctx);
  updateFund(refs, ctx);
}

function updateHead(refs, ctx) {
  const { state } = ctx;
  const book = exchangeOf(state);
  const asks = book.listings.filter((l) => l.side === 'sell').length;
  const bids = book.listings.length - asks;
  const mine = book.listings.filter((l) => l.from === state.home).length;
  const contracts = (state.contracts ?? []).filter((c) => c.viaExchange).length;

  const sig = [asks, bids, mine, contracts, Math.round(book.fund)].join('|');
  if (refs.marketHead.dataset.sig === sig) return;
  refs.marketHead.dataset.sig = sig;

  refs.marketHead.replaceChildren(html(`
    <dl class="facts facts--four">
      <div><dt title="Nations offering to sell">Asks</dt><dd>${num(asks)}</dd></div>
      <div><dt title="Nations offering to buy">Bids</dt><dd>${num(bids)}</dd></div>
      <div><dt title="Terms you have posted yourself">Yours</dt><dd>${num(mine)}</dd></div>
      <div><dt title="Contracts running that the exchange matched">Matched</dt><dd>${num(contracts)}</dd></div>
    </dl>`));
}

function updateDraft(refs, ctx) {
  const { state, ui } = ctx;
  const draft = ui.listing;
  const wrap = refs.listingDraft.firstElementChild;
  if (!wrap) return;

  setValue(wrap.querySelector('.post__side'), draft.side);
  setValue(wrap.querySelector('.post__commodity'), draft.commodity);
  setValue(wrap.querySelector('.post__qty'), String(draft.qty));
  setValue(wrap.querySelector('.post__price'), String(draft.price || ''));
  setValue(wrap.querySelector('.post__every'), String(draft.every));
  setValue(wrap.querySelector('.post__term'), String(draft.term));

  const local = state.markets[state.home][draft.commodity].price;
  const base = COMMODITIES[draft.commodity].basePrice;
  const value = (draft.price || 0) * (draft.qty || 0) / Math.max(1, draft.every);
  setText(wrap.querySelector('.draft__quote'),
    `at home ${price(local)} · base ${price(base)} · ${draft.side === 'sell' ? '+' : '-'}${money(value)}/tick if it fills`);
  setText(wrap.querySelector('.post__go'), draft.side === 'sell' ? 'Post ask' : 'Post bid');
}

function setValue(el, value) {
  if (el && el.value !== value) el.value = value;
}

// The book itself. Sorted so the best terms for YOU are at the top of each
// side: the cheapest thing anybody will sell, and the most anybody will pay.
function updateBook(refs, ctx) {
  const { state } = ctx;
  const book = exchangeOf(state);
  const rows = book.listings.slice().sort((a, b) => {
    if (a.side !== b.side) return a.side === 'sell' ? -1 : 1;
    return a.side === 'sell' ? a.price - b.price : b.price - a.price;
  }).slice(0, 40);

  const sig = rows.map((l) => `${l.id}${l.qty}${l.price}`).join('|') + `#${state.countries[state.home].cash > 0}`;
  if (refs.listingBook.dataset.sig === sig) return;
  refs.listingBook.dataset.sig = sig;

  if (!rows.length) {
    refs.listingBook.replaceChildren(html('<p class="muted hint--tight">The book is empty. Governments post what they cannot place at home and bid for what they cannot dig up — give it a few ticks, or post the first terms yourself.</p>'));
    return;
  }

  refs.listingBook.replaceChildren(...rows.map((l) => {
    const own = isPlayer(state, l.from);
    const good = COMMODITIES[l.commodity];
    const sell = l.side === 'sell';
    // What it would actually cost you delivered, which is not what it says on
    // the tin: the freight from there to here is real and is the reason a
    // cheaper listing on the far side of the planet can be the dearer one.
    const freight = good.basePrice * CONFIG.trade.freight * haulShare(l.from, state.home);
    const node = html(`
      <div class="listing" data-side="${l.side}" data-own="${own}">
        <div class="listing__row">
          <i class="country__swatch" style="--swatch:${COUNTRIES[l.from].color}"></i>
          <span class="listing__what">${sell ? 'sells' : 'buys'} ${qtyShort(l.qty)} ${good.name}<span class="muted">/${l.every}t</span></span>
          <b class="listing__price">${priceShort(l.price)}</b>
          <button type="button" class="listing__act">${own ? '×' : sell ? 'Buy' : 'Sell'}</button>
        </div>
        <p class="listing__note muted">${own ? 'your own listing' : ownerName(l.from)} &middot; ${num(l.term)}t term${own ? '' : ` &middot; ${priceShort(freight)} freight`}</p>
      </div>`);
    const act = node.querySelector('.listing__act');
    act.title = own
      ? 'Withdraw this listing.'
      : sell
        ? `Take it: a contract to buy ${l.qty} ${good.name} every ${l.every} ticks at ${price(l.price)}, delivered, for ${l.term} ticks.`
        : `Take it: a contract to sell ${l.qty} ${good.name} every ${l.every} ticks at ${price(l.price)} for ${l.term} ticks.`;
    act.addEventListener('click', () => (own ? ctx.onCancelListing(l.id) : ctx.onTakeListing(l.id)));
    return node;
  }));
}

// The clearing fund, and what you may draw against it. This is the fee every
// settlement on the exchange has paid in — the world's own trade, lending to
// whoever needs it.
function updateFund(refs, ctx) {
  const { state } = ctx;
  const book = exchangeOf(state);
  const me = state.countries[state.home];
  const limit = borrowLimit(state, state.home);
  const owed = me.debt ?? 0;

  const sig = [Math.round(book.fund), Math.round(book.lent), Math.round(owed), Math.round(limit),
    Math.round(me.report.interest ?? 0)].join('|');
  if (refs.fundCard.dataset.sig === sig) return;
  refs.fundCard.dataset.sig = sig;

  refs.fundCard.replaceChildren(html(`
    <div class="fund__inner">
      <dl class="facts facts--four">
        <div><dt title="Fees paid in by every settlement, less what is out on loan">In the fund</dt><dd>${money(book.fund)}</dd></div>
        <div><dt>Out on loan</dt><dd>${money(book.lent)}</dd></div>
        <div><dt>You owe</dt><dd class="${owed > 0 ? 'is-negative' : ''}">${money(owed)}</dd></div>
        <div><dt title="Interest on the balance, every tick">Interest</dt><dd class="${owed > 0 ? 'is-negative' : ''}">${money(me.report.interest ?? 0)}/t</dd></div>
      </dl>
      <div class="fund__act">
        <button type="button" class="fund__borrow" ${limit > 0 ? '' : 'disabled'}>Borrow ${moneyShort(limit)}</button>
        <button type="button" class="fund__repay" ${owed > 0 && me.cash > 0 ? '' : 'disabled'}>Repay ${moneyShort(Math.min(owed, Math.max(0, me.cash)))}</button>
      </div>
      <p class="hint hint--tight">${owed > 0
        ? `Repaid automatically at ${Math.round(CONFIG.exchange.loan.repay * 100)}% of your tax base each tick, plus ${(CONFIG.exchange.loan.interest * 100).toFixed(1)}% interest on the balance.`
        : 'Borrowing keeps the lights on through a bad decade — but it is repaid out of the tax base, so it spends next decade’s budget.'}</p>
    </div>`));
  refs.fundCard.querySelector('.fund__borrow').addEventListener('click', () => ctx.onBorrow(limit));
  refs.fundCard.querySelector('.fund__repay')
    .addEventListener('click', () => ctx.onRepay(Math.min(owed, Math.max(0, me.cash))));
}
