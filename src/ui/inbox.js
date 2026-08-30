import { CONFIG } from '../core/config.js';
import { COMMODITIES } from '../data/commodities.js';
import { COUNTRIES } from '../data/countries.js';
import { TECHS } from '../data/technology.js';
import { knowsTech } from '../core/state.js';
import { unlocksFor } from '../systems/research.js';
import { BUILDINGS } from '../data/buildings.js';
import { money, moneyShort, num, price, html } from './format.js';

// THE INBOX: everything waiting on your answer, floating over the map.
//
// Every offer here also lives in its own tab, and both routes call the same
// action — this is not a second copy of the state, it is a second door onto it.
// The reason it exists is that saying yes used to cost you the pane you were
// reading: a contract proposal arrived, and answering it meant leaving the
// factory list you were halfway through.
//
// It diffs on a signature like every other floating thing, because it is
// repainted on every render whether the panel is open or not.
export function updateInbox(host, ctx) {
  const { state, ui } = ctx;
  const contracts = state.contractOffers ?? [];
  const techs = (state.techOffers ?? []).filter((o) => !knowsTech(state, state.home, o.tech));
  // A pact put to you by another government. It lives on `state.diplomacy`
  // rather than in an offers array of its own, and it expires on the TICK clock
  // rather than the wall clock the other two use — a treaty is not a thing you
  // answer in five seconds, and it must not decide itself while you are paused.
  const pacts = (state.diplomacy?.proposals ?? []).filter((p) => p.to === state.home);

  // `at` is in the signature so a card that was replaced by a fresh proposal
  // restarts its countdown rather than inheriting the old one's.
  const sig = [
    ...contracts.map((o) => `c${o.from}${o.dir}${o.commodity}${o.qty}${o.activeAt ?? o.at ?? 0}`),
    ...techs.map((o) => `t${o.from}${o.tech}${o.activeAt ?? o.at ?? 0}`),
    ...pacts.map((p) => `p${p.id}`),
  ].join('|');
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;

  if (!contracts.length && !techs.length && !pacts.length) { host.replaceChildren(); return; }

  // The countdown holds while you are actually looking at the stack. Attached
  // once per rebuild rather than per card, because the pointer entering one card
  // and leaving another must not read as having left the inbox.
  if (!host.dataset.hover) {
    host.dataset.hover = 'true';
    host.addEventListener('pointerenter', () => { ui.inboxHeld = true; });
    host.addEventListener('pointerleave', () => { ui.inboxHeld = false; });
  }

  host.replaceChildren(
    ...pacts.map((proposal) => pactCard(state, proposal, ctx)),
    ...contracts.map((offer) => contractCard(state, offer, ctx)),
    ...techs.map((offer) => techCard(state, offer, ctx)),
  );
}

// A treaty offered. No countdown BAR on this one — the bar animates over
// `CONFIG.offerTtlMs` of wall clock, and a pact lapses on the tick clock — so it
// says its remaining ticks in words instead, and a paused game holds it.
function pactCard(state, proposal, ctx) {
  const c = COUNTRIES[proposal.from];
  const what = proposal.relation === 'alliance' ? 'an alliance'
    : proposal.relation === 'access' ? 'military access' : 'peace';
  const left = Math.max(0, CONFIG.diplomacy.proposalTtl - (state.tick - proposal.at));
  const node = html(`
    <div class="post" data-kind="pact">
      <div class="post__head">
        <i class="country__swatch" style="--swatch:${c.color}"></i>
        <span class="post__from">${c.name}</span>
        <span class="post__kind">pact</span>
      </div>
      <p class="post__body">Proposes <b>${what}</b>.${proposal.relation === 'alliance'
        ? ' An ally is dragged into your wars, and you into theirs.'
        : proposal.relation === 'access' ? ' Their formations could cross your soil, and yours theirs.' : ''}</p>
      <p class="post__meta muted">${left} ticks to answer &middot; it lapses if you say nothing</p>
      <div class="post__act">
        <button type="button" class="primary post__yes">Agree</button>
        <button type="button" class="post__no">Decline</button>
      </div>
    </div>`);
  node.querySelector('.post__yes').addEventListener('click', () => ctx.onAnswerPact(proposal.id, true));
  node.querySelector('.post__no').addEventListener('click', () => ctx.onAnswerPact(proposal.id, false));
  return node;
}

// Every card animates its own countdown over exactly `CONFIG.offerTtlMs`, so
// the bar always runs out when the offer does — the same contract the alerts
// keep. It is paused by CSS while the pointer is over the stack, which is the
// visual half of the hold in `pruneOffers`.
function countdown() {
  const bar = html('<i class="post__ttl"></i>');
  bar.style.setProperty('--ttl', `${CONFIG.offerTtlMs}ms`);
  return bar;
}

function contractCard(state, offer, ctx) {
  const c = COUNTRIES[offer.from];
  const good = COMMODITIES[offer.commodity];
  const supplying = offer.dir === 'sell';
  const perTick = (offer.qty / offer.every) * offer.price;
  const node = html(`
    <div class="post" data-kind="contract">
      <div class="post__head">
        <i class="country__swatch" style="--swatch:${c.color}"></i>
        <span class="post__from">${c.name}</span>
        <span class="post__kind">contract</span>
      </div>
      <p class="post__body">${supplying ? 'Will supply you' : 'Wants to buy'}
        <b>${offer.qty} ${good.name}</b> every ${num(offer.every)} ticks at
        <b>${price(offer.price)}</b> a unit, for ${num(offer.term)} ticks.</p>
      <p class="post__meta muted">${supplying ? '-' : '+'}${moneyShort(perTick)}/tick &middot; declined if you say nothing</p>
      <div class="post__act">
        <button type="button" class="primary post__yes">Sign</button>
        <button type="button" class="post__no">Decline</button>
      </div>
    </div>`);
  node.append(countdown());
  node.querySelector('.post__yes').addEventListener('click', () => ctx.onAcceptContract(offer));
  node.querySelector('.post__no').addEventListener('click', () => ctx.onDeclineContract(offer));
  return node;
}

function techCard(state, offer, ctx) {
  const c = COUNTRIES[offer.from];
  const tech = TECHS[offer.tech];
  const unlocks = unlocksFor(offer.tech).map((type) => BUILDINGS[type].name).join(', ');
  const node = html(`
    <div class="post" data-kind="tech">
      <div class="post__head">
        <i class="country__swatch" style="--swatch:${c.color}"></i>
        <span class="post__from">${c.name}</span>
        <span class="post__kind">licence</span>
      </div>
      <p class="post__body">Will licence <b>${tech.name}</b> for
        <b>${money(offer.fee)}</b>.${unlocks ? ` Unlocks ${unlocks}.` : ''}</p>
      <p class="post__meta muted">declined if you say nothing</p>
      <div class="post__act">
        <button type="button" class="primary post__yes">Licence</button>
        <button type="button" class="post__no">Decline</button>
      </div>
    </div>`);
  node.append(countdown());
  node.querySelector('.post__yes').addEventListener('click', () => ctx.onAcceptTech(offer.tech));
  node.querySelector('.post__no').addEventListener('click', () => ctx.onDeclineTech(offer.tech));
  return node;
}
