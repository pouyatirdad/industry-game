import { CONFIG } from '../core/config.js';
import { BUILDINGS } from '../data/buildings.js';
import { COUNTRIES } from '../data/countries.js';
import { TECHS, TECH_IDS, TECH_ERAS, canResearch } from '../data/technology.js';
import { knowsTech, techCount } from '../core/state.js';
import { licenceCost, sellersOf, unlocksFor, techOfferLeft } from '../systems/research.js';
import { money, moneyShort, num, pct, setAttr, setText, html } from './format.js';

// The technology tree, and the only place the game answers "why can I not build
// that". Everything here is derived from `state` on the spot, like every other
// pane: nothing accumulates, because a pane that is not on screen never runs.
//
// The tree is a fixed list of twenty entries, so its rows are built ONCE at
// mount and only their figures and their state are written per tick — the same
// rule the market table, the factory list and the ranks table follow, and for
// the same reason: rebuilding would throw away the scroll position you are
// reading with.
export function mountTech(refs, ctx) {
  const eras = TECH_ERAS.map((era) => {
    const group = html(`<div class="tree__era" data-era="${era}"><h3 class="tree__title">Era ${era}</h3></div>`);
    for (const id of TECH_IDS.filter((t) => TECHS[t].era === era)) {
      group.append(techRow(id, ctx));
    }
    return group;
  });
  refs.techTree.replaceChildren(...eras);
}

function techRow(id, ctx) {
  const tech = TECHS[id];
  const row = html(`
    <div class="tech" data-tech="${id}">
      <div class="tech__row">
        <span class="tech__state"></span>
        <span class="tech__name">${tech.name}</span>
        <b class="tech__cost"></b>
      </div>
      <div class="tech__bar"><i class="tech__fill"></i></div>
      <p class="tech__unlocks muted"></p>
      <div class="tech__act">
        <button type="button" class="tech__study">Study</button>
        <button type="button" class="tech__buy"></button>
      </div>
    </div>`);
  row.querySelector('.tech__study').addEventListener('click', () => ctx.onResearch(id));
  row.querySelector('.tech__buy').addEventListener('click', () => ctx.onBuyTech(id));
  return row;
}

export function updateTech(refs, ctx) {
  const { state } = ctx;
  const me = state.countries[state.home];
  const known = me.techs ?? {};

  updateHead(refs, ctx, me);
  updateOffers(refs, ctx);

  for (const group of refs.techTree.children) {
    for (const node of group.children) {
      const id = node.dataset?.tech;
      if (!id) continue;
      paint(node, state, me, known, id);
    }
  }
}

function paint(node, state, me, known, id) {
  const tech = TECHS[id];
  const have = Boolean(known[id]);
  const open = canResearch(known, id);
  const active = me.researching === id;
  const missing = tech.needs.filter((need) => !known[need]);

  const cost = have ? 0 : licenceCost(state, state.home, id);
  const sellers = have ? [] : sellersOf(state, state.home, id);
  const affordable = sellers.length && me.cash >= cost;
  const progress = active && tech.cost > 0 ? Math.min(1, (me.research ?? 0) / tech.cost) : 0;

  // A boolean rather than the cash figure, so a tech you cannot afford does not
  // rebuild this row on every tick the treasury moves.
  const sig = [have, open, active, Math.round(progress * 100), sellers.length, affordable].join('|');
  if (node.dataset.sig === sig) return;
  node.dataset.sig = sig;

  setAttr(node, 'data-have', have ? 'true' : null);
  setAttr(node, 'data-open', open ? 'true' : null);
  setAttr(node, 'data-active', active ? 'true' : null);

  setText(node.querySelector('.tech__state'), have ? '✓' : active ? '◐' : open ? '○' : '·');
  setText(node.querySelector('.tech__cost'), have ? 'known' : `${num(tech.cost)}p`);
  node.querySelector('.tech__fill').style.setProperty('--fill', `${Math.round(progress * 100)}%`);

  const unlocks = unlocksFor(id).map((type) => BUILDINGS[type].name).join(', ');
  const blocked = missing.map((need) => TECHS[need].name).join(' + ');
  setText(node.querySelector('.tech__unlocks'), have
    ? unlocks || 'no new industry'
    : missing.length ? `needs ${blocked}` : unlocks || 'no new industry');

  node.title = `${tech.name} — ${tech.blurb}${unlocks ? ` Unlocks: ${unlocks}.` : ''}`;

  const study = node.querySelector('.tech__study');
  const buy = node.querySelector('.tech__buy');
  setAttr(study, 'hidden', have || !open ? 'hidden' : null);
  setText(study, active ? 'Studying' : 'Study');
  setAttr(study, 'data-active', active ? 'true' : null);

  setAttr(buy, 'hidden', have || !sellers.length ? 'hidden' : null);
  setText(buy, `Licence ${moneyShort(cost)}`);
  setAttr(buy, 'data-affordable', affordable ? 'true' : 'false');
  if (sellers.length) {
    buy.title = `Licence from ${COUNTRIES[sellers[0]].name} for ${money(cost)}${sellers.length > 1 ? ` (${sellers.length} nations hold it)` : ''}. Anything upstream you are missing comes with it.`;
  }
}

// What your laboratories cost and what they are working on. The slider is a
// POLICY and lives on the country, not on `ui` — the other forty-five have one
// too, and yours rides along in the save exactly as theirs do.
function updateHead(refs, ctx, me) {
  const { state } = ctx;
  const target = TECHS[me.researching];
  const share = me.researchShare ?? CONFIG.research.share;
  const spend = me.report.tax * share;
  const left = target
    ? Math.max(0, target.cost - (me.research ?? 0)) / Math.max(0.001, spend / CONFIG.research.costPerPoint)
    : 0;

  const sig = [techCount(state, state.home), me.researching, Math.round(me.research ?? 0),
    share.toFixed(2), Math.round(spend), Math.round(left)].join('|');
  if (refs.techHead.dataset.sig === sig) return;
  refs.techHead.dataset.sig = sig;

  // One root element: `html` returns the first child of its template, so a
  // fragment with two siblings would silently drop the second — which is
  // exactly what happened to the slider the first time.
  refs.techHead.replaceChildren(html(`
    <div>
      <dl class="facts facts--four">
        <div><dt>Known</dt><dd>${num(techCount(state, state.home))} / ${num(TECH_IDS.length)}</dd></div>
        <div><dt>Studying</dt><dd>${target ? target.name : '<span class="muted">nothing</span>'}</dd></div>
        <div><dt title="What the laboratories cost the treasury each tick">Budget</dt><dd>${money(spend)}/t</dd></div>
        <div><dt title="Ticks until the current subject completes at this budget">Due in</dt><dd>${target ? `${num(Math.ceil(left))}t` : '&mdash;'}</dd></div>
      </dl>
      <label class="slider">
        <span>Research ${pct(share)} of the tax base</span>
        <input type="range" id="research-share" min="0" max="${Math.round(CONFIG.research.maxShare * 100)}" value="${Math.round(share * 100)}">
      </label>
    </div>`));
  refs.techHead.querySelector('#research-share')
    .addEventListener('input', (event) => ctx.onResearchShare(Number(event.target.value) / 100));
}

function updateOffers(refs, ctx) {
  const { state } = ctx;
  const offers = (state.techOffers ?? []).filter((o) => !knowsTech(state, state.home, o.tech));
  const sig = offers.map((o) => `${o.from}${o.tech}${o.fee}${techOfferLeft(state, o)}`).join('|');
  if (refs.techOffers.dataset.sig === sig) return;
  refs.techOffers.dataset.sig = sig;

  if (!offers.length) {
    refs.techOffers.replaceChildren(html('<p class="muted hint--tight">Nobody is selling just now. Any nation you hold a pact with will licence what it knows — see the <b>Licence</b> buttons below.</p>'));
    return;
  }
  refs.techOffers.replaceChildren(...offers.map((offer) => {
    const c = COUNTRIES[offer.from];
    const node = html(`
      <div class="offer">
        <div class="offer__who">
          <i class="country__swatch" style="--swatch:${c.color}"></i>
          <span class="offer__name">${TECHS[offer.tech].name}</span>
          <b class="offer__fee is-negative">-${money(offer.fee)}</b>
        </div>
        <p class="offer__note muted">from ${c.name} &middot; lapses in ${num(techOfferLeft(state, offer))} ticks</p>
        <div class="offer__act">
          <button type="button" class="primary offer__yes">Licence</button>
          <button type="button" class="offer__no">Decline</button>
        </div>
      </div>`);
    node.querySelector('.offer__yes').addEventListener('click', () => ctx.onAcceptTech(offer.tech));
    node.querySelector('.offer__no').addEventListener('click', () => ctx.onDeclineTech(offer.tech));
    return node;
  }));
}
