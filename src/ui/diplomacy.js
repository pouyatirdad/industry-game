import { CONFIG } from '../core/config.js';
import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { opinionOf, isAlive } from '../core/state.js';
import { relationOf, terroristForce } from '../systems/military.js';
import { canPropose, canDeclareWar, diplomacyOf, proposalBetween, ultimatumBetween,
  relationAppetite, alliesOf } from '../systems/relations.js';
import { setAttr, setText, html } from './format.js';

// THE DIPLOMACY TAB.
//
// It used to be a dropdown per nation, which said the quiet part out loud: a
// relation was something you SET. Now it is a conversation — you put alliance,
// access or peace and the other government answers — with exactly one thing you
// can still do unilaterally, which is declare war, and even that waits a
// hundred ticks before anybody fires.
//
// Two rules keep it affordable. Two hundred and fifty-seven rows are built ONCE
// at mount, like the commodity book and the ranks table, and only their text and
// button states are written per tick. And the row diffs on a signature string,
// so a tick in which nothing diplomatic happened touches no DOM at all.

// What a row can offer, in the order the buttons appear. `war` is deliberately
// last and deliberately styled apart: it is the only one of the four that is not
// a request.
const MOVES = [
  { relation: 'alliance', label: 'Ally', title: 'Propose an alliance. They answer on their own reading of you — and an ally is dragged into your wars.' },
  { relation: 'access', label: 'Access', title: 'Ask for military access: your formations may cross their soil.' },
  { relation: 'neutral', label: 'Peace', title: 'Sue for peace, or end a pact. They have to agree.' },
  { relation: 'war', label: 'War', title: 'Declare war. Nobody is asked permission to be invaded — but the fighting does not start for 100 ticks.' },
];

export function mountDiplomacy(refs, ctx) {
  refs.diplomacyList.replaceChildren(...COUNTRY_IDS
    .filter((id) => id !== ctx.state.home)
    .map((id) => {
      const row = html(`
        <div class="dip" data-country="${id}">
          <button type="button" class="dip__name" title="Show this nation on the map">
            <i class="country__swatch" style="--swatch:${COUNTRIES[id].color}"></i>
            <span class="dip__label">${COUNTRIES[id].name}</span>
          </button>
          <span class="dip__state"></span>
          <span class="dip__opinion"><span class="dip__opinion-word"></span><i class="dip__opinion-bar"></i></span>
          <span class="dip__acts">${MOVES
            .map((m) => `<button type="button" class="dip__act" data-relation="${m.relation}" title="${m.title}">${m.label}</button>`)
            .join('')}</span>
        </div>`);
      row.querySelector('.dip__name').addEventListener('click', () => ctx.onFocusCountry(id));
      for (const btn of row.querySelectorAll('.dip__act')) {
        btn.addEventListener('click', () => ctx.onRelation(id, btn.dataset.relation));
      }
      return row;
    }));
}

export function updateDiplomacy(refs, ctx) {
  const { state } = ctx;
  updateHead(refs, ctx);
  updatePending(refs, ctx);

  for (const row of refs.diplomacyList.children) {
    const id = row.dataset.country;
    const relation = relationOf(state, state.home, id);
    const proposal = proposalBetween(state, state.home, id);
    const ultimatum = ultimatumBetween(state, state.home, id);
    const countdown = ultimatum ? Math.max(0, ultimatum.beginsAt - state.tick) : null;
    const opinion = Math.round(opinionOf(state, state.home, id));
    // A nation conquered out of existence keeps its row rather than vanishing
    // from a list built once at mount — but it must not read `Neutral`, which
    // is what a nation you have never dealt with reads.
    const alive = isAlive(state, id);

    // The signature is what stops two hundred and fifty-seven rows being
    // rewritten on a tick in which nothing was said. The countdown is in it
    // because it changes every tick — but only for the handful of pairs that
    // actually have a declaration standing.
    const sig = [relation, proposal?.id ?? '', proposal?.from ?? '', countdown ?? '', opinion, alive].join('|');
    if (row.dataset.sig === sig) continue;
    row.dataset.sig = sig;

    setAttr(row, 'data-relation', relation);
    setAttr(row, 'data-dead', alive ? null : 'true');
    setAttr(row, 'data-pending', ultimatum ? 'war' : proposal ? 'proposal' : null);
    setText(row.querySelector('.dip__state'), stateLine(state, id, relation, proposal, countdown, alive));
    const opinionNode = row.querySelector('.dip__opinion');
    setText(opinionNode.querySelector('.dip__opinion-word'), opinionWord(opinion));
    opinionNode.style.setProperty('--opinion', `${Math.abs(opinion)}%`);
    setAttr(opinionNode, 'data-tone', opinion < -10 ? 'bad' : opinion > 10 ? 'good' : 'neutral');

    for (const btn of row.querySelectorAll('.dip__act')) {
      const move = btn.dataset.relation;
      const check = move === 'war' ? canDeclareWar(state, state.home, id)
        : canPropose(state, state.home, id, move);
      btn.disabled = !check.ok;
      setAttr(btn, 'data-danger', move === 'war' ? 'true' : null);
      // The refusal is on the button that would have made the move, which is
      // where you are already looking when you wonder why it is greyed out.
      setAttr(btn, 'title', check.ok
        ? `${MOVES.find((m) => m.relation === move).title}${move === 'war' ? '' : ` They want this about ${Math.round(relationAppetite(state, id, state.home, move) * 100)}%.`}`
        : check.reason);
    }
  }
}

function opinionWord(value) {
  return value <= -50 ? 'Hostile'
    : value <= -15 ? 'Wary'
      : value >= 50 ? 'Friendly'
        : value >= 15 ? 'Warm' : 'Neutral';
}

// One line saying where the two of you actually stand — and it is the only
// place a countdown to a war appears in a list of two hundred and fifty-seven
// nations, so it says the number rather than "pending".
function stateLine(state, id, relation, proposal, countdown, alive) {
  // Conquest outranks everything else a row could say. `eliminate` clears the
  // relation, so without this the nation you have just annexed would read as a
  // neutral neighbour you had never spoken to.
  if (!alive) return 'Conquered';
  if (countdown != null) return `War in ${countdown}t`;
  if (proposal) {
    return proposal.from === state.home
      ? `${short(proposal.relation)} offered`
      : `${short(proposal.relation)} asked`;
  }
  return relation === 'alliance' ? 'Allied'
    : relation === 'access' ? 'Access'
      : relation === 'war' ? 'AT WAR' : 'Neutral';
}

function short(relation) {
  return relation === 'alliance' ? 'Alliance' : relation === 'access' ? 'Access' : 'Peace';
}

// The head is the state of the world as it concerns you: who you are fighting,
// who you are bound to, and what is about to start.
function updateHead(refs, ctx) {
  const { state } = ctx;
  const d = diplomacyOf(state);
  const wars = COUNTRY_IDS.filter((id) => relationOf(state, state.home, id) === 'war');
  const allies = alliesOf(state, state.home);
  const access = COUNTRY_IDS.filter((id) => relationOf(state, state.home, id) === 'access');
  const looming = d.ultimatums.filter((u) => u.from === state.home || u.to === state.home);
  const active = state.terrorism?.active;
  const force = terroristForce(active);
  const warned = !active ? state.terrorism?.warning : null;

  const sig = [wars.length, allies.length, access.length,
    looming.map((u) => `${u.id}:${Math.max(0, u.beginsAt - state.tick)}`).join(','),
    active?.id ?? '', active?.destroyed ?? '',
    // The countdown ticks down every tick, so it is in the signature — this
    // block is only rebuilt while a warning is actually standing.
    warned ? `w${warned.at - state.tick}` : ''].join('|');
  if (refs.diplomacyHead.dataset.sig === sig) return;
  refs.diplomacyHead.dataset.sig = sig;

  const soonest = looming.slice().sort((a, b) => a.beginsAt - b.beginsAt)[0];
  refs.diplomacyHead.replaceChildren(html(`
    <div class="dip__head">
      <dl class="facts">
        <div><dt>At war</dt><dd class="${wars.length ? 'is-negative' : ''}">${wars.length ? wars.map((id) => COUNTRIES[id].name).join(', ') : 'nobody'}</dd></div>
        <div><dt>Allies</dt><dd>${allies.length ? allies.map((id) => COUNTRIES[id].name).join(', ') : 'none'}</dd></div>
        <div><dt>Access</dt><dd>${access.length ? `${access.length} nation${access.length === 1 ? '' : 's'}` : 'none'}</dd></div>
        <div><dt>Terrorism</dt><dd>${active
          ? `${active.name} in ${COUNTRIES[active.countryId]?.name ?? active.countryId} · ${force.infantry} inf, ${force.armoredCar} car${force.armoredCar === 1 ? '' : 's'} · ${active.destroyed ?? 0} wrecked`
          : warned
            ? `${warned.name} forming in ${COUNTRIES[warned.countryId]?.name ?? warned.countryId} · ${Math.max(0, warned.at - state.tick)} ticks out`
            : `none · next risk tick ${state.terrorism?.nextSpawnTick ?? 0}`}</dd></div>
      </dl>
      ${soonest ? `<p class="dip__warning">${soonest.from === state.home
        ? `Your declaration of war on ${COUNTRIES[soonest.to].name}`
        : `${COUNTRIES[soonest.from].name}'s declaration of war on you`} — fighting begins in
        <b>${Math.max(0, soonest.beginsAt - state.tick)}</b> ticks.${soonest.from === state.home ? ' It can still be called off.' : ''}</p>` : ''}
    </div>`));

  if (soonest?.from === state.home) {
    const stop = html('<button type="button" class="dip__calloff">Call it off</button>');
    stop.addEventListener('click', () => ctx.onCallOffWar(soonest.id));
    refs.diplomacyHead.querySelector('.dip__warning').append(' ', stop);
  }
}

// Everything waiting on YOUR answer, at the top of the pane where the decision
// is rather than buried among two hundred and fifty-seven neutral neighbours.
// The same cards appear in the floating inbox and both call the same action —
// two doors onto one state, exactly as the contract and licence offers are.
function updatePending(refs, ctx) {
  const { state } = ctx;
  const d = diplomacyOf(state);
  const incoming = d.proposals.filter((p) => p.to === state.home);
  const outgoing = d.proposals.filter((p) => p.from === state.home);

  // The countdown on an outgoing proposal is bucketed into fives: the number
  // has to visibly run down, and rebuilding these cards on every single tick
  // would take the pointer off a button as you reached for it.
  const sig = [
    ...incoming.map((p) => `${p.id}${p.from}${p.relation}`),
    ...outgoing.map((p) => `${p.id}${p.to}${p.relation}${Math.floor((state.tick - p.at) / 5)}`),
  ].join('|');
  if (refs.diplomacyPending.dataset.sig === sig) return;
  refs.diplomacyPending.dataset.sig = sig;

  if (!incoming.length && !outgoing.length) { refs.diplomacyPending.replaceChildren(); return; }

  refs.diplomacyPending.replaceChildren(
    ...incoming.map((p) => {
      const node = html(`
        <div class="dip__offer" data-kind="in">
          <span><i class="country__swatch" style="--swatch:${COUNTRIES[p.from].color}"></i>
            <b>${COUNTRIES[p.from].name}</b> proposes ${short(p.relation).toLowerCase()}</span>
          <span class="dip__offer-act">
            <button type="button" class="primary dip__yes">Agree</button>
            <button type="button" class="dip__no">Decline</button>
          </span>
        </div>`);
      node.querySelector('.dip__yes').addEventListener('click', () => ctx.onAnswerPact(p.id, true));
      node.querySelector('.dip__no').addEventListener('click', () => ctx.onAnswerPact(p.id, false));
      return node;
    }),
    ...outgoing.map((p) => {
      const left = CONFIG.diplomacy.proposalTtl - (state.tick - p.at);
      const node = html(`
        <div class="dip__offer" data-kind="out">
          <span><i class="country__swatch" style="--swatch:${COUNTRIES[p.to].color}"></i>
            ${short(p.relation)} put to <b>${COUNTRIES[p.to].name}</b>
            <span class="muted">— awaiting an answer, ${Math.max(0, left)}t left</span></span>
          <span class="dip__offer-act"><button type="button" class="dip__no">Withdraw</button></span>
        </div>`);
      node.querySelector('.dip__no').addEventListener('click', () => ctx.onWithdrawPact(p.id));
      return node;
    }),
  );
}
