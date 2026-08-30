import { CONFIG } from '../core/config.js';
import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { haulShare, neighboursOf } from '../data/geography.js';
import { isPlayer, pushAlert, noteEvent, isAlive, opinionOf, nudgeOpinion, decayOpinions } from '../core/state.js';
import { relationOf, setRelation, unitsOf } from './military.js';

// DIPLOMACY IS A CONVERSATION, WITH ONE EXCEPTION.
//
// Every relation in the game is a thing two governments agreed to — an alliance,
// military access, peace — and none of them can be taken. You PUT them, and the
// other government answers on its own reading of who you are, where you are and
// how the two of you already stand. That is the whole of this file.
//
// The exception is war, and it is the exception on purpose: nobody is asked
// permission to be invaded. War is DECLARED, unilaterally, and then it WAITS.
// For `CONFIG.diplomacy.warDelay` ticks the two are on notice and nothing else:
// an alliance between them breaks at once, but no border opens, no shot is
// fired, and either side may still call it off. The delay is what turns a war
// into a decision the whole world can watch coming, and it is why armies are
// worth having before you need them.
//
// Nothing here is special-cased for the player. `answerProposal` is the same
// function whether a government or you is saying yes, and `relationAppetite`
// is what the world uses to answer YOUR proposals as well as each other's.

// The three a government may be ASKED for. War is not on this list, and its
// absence is the rule rather than an oversight.
export const PROPOSABLE = ['alliance', 'access', 'neutral'];

// Tolerates a state built before any of this existed rather than making every
// caller check, exactly as `exchangeOf` and `noteLedger` do.
export function diplomacyOf(state) {
  if (!state.diplomacy) state.diplomacy = { relations: {}, lastWarAt: -1 };
  const d = state.diplomacy;
  d.opinion ??= {};
  d.proposals ??= [];
  d.ultimatums ??= [];
  d.history ??= {};
  d.nextId ??= 1;
  return d;
}

// --- reading the table ------------------------------------------------------

export function proposalsTo(state, id) {
  return diplomacyOf(state).proposals.filter((p) => p.to === id);
}

export function proposalsFrom(state, id) {
  return diplomacyOf(state).proposals.filter((p) => p.from === id);
}

export function proposalBetween(state, a, b) {
  return diplomacyOf(state).proposals.find((p) =>
    (p.from === a && p.to === b) || (p.from === b && p.to === a)) ?? null;
}

// The declaration standing between two nations, if any. It is the whole reason
// the Diplomacy tab can say "war in 84 ticks" rather than only "at war".
export function ultimatumBetween(state, a, b) {
  return diplomacyOf(state).ultimatums.find((u) =>
    (u.from === a && u.to === b) || (u.from === b && u.to === a)) ?? null;
}

export function ticksToWar(state, a, b) {
  const u = ultimatumBetween(state, a, b);
  return u ? Math.max(0, u.beginsAt - state.tick) : null;
}

// Everything one nation has hanging over it: who it is about to fight, and who
// is waiting on an answer from it.
export function standingWith(state, id) {
  const d = diplomacyOf(state);
  return {
    proposals: d.proposals.filter((p) => p.to === id || p.from === id),
    ultimatums: d.ultimatums.filter((u) => u.to === id || u.from === id),
  };
}

// --- putting a proposal -----------------------------------------------------

export function canPropose(state, from, to, relation) {
  if (from === to) return { ok: false, reason: 'A nation cannot deal with itself.' };
  if (!COUNTRIES[to] || !isAlive(state, to) || !isAlive(state, from)) {
    return { ok: false, reason: 'That nation no longer exists.' };
  }
  if (relation === 'war') {
    return { ok: false, reason: 'War is declared, not requested — nobody is asked permission to be invaded.' };
  }
  if (!PROPOSABLE.includes(relation)) return { ok: false, reason: 'That is not something one government may ask another for.' };
  const now = relationOf(state, from, to);
  if (now === relation) return { ok: false, reason: `Already ${label(relation)}.` };
  // From a war, the only thing on the table is peace. You do not ask a nation
  // you are shelling for basing rights.
  if (now === 'war' && relation !== 'neutral') {
    return { ok: false, reason: `${COUNTRIES[to].name} is at war with you — sue for peace first.` };
  }
  if (ultimatumBetween(state, from, to)) {
    return { ok: false, reason: 'A declaration of war stands between you — call it off first.' };
  }
  if (proposalBetween(state, from, to)) {
    return { ok: false, reason: `Something is already on the table with ${COUNTRIES[to].name}.` };
  }
  if (proposalsFrom(state, from).length >= CONFIG.diplomacy.maxProposals) {
    return { ok: false, reason: 'Too many proposals already outstanding.' };
  }
  const since = state.tick - (diplomacyOf(state).history[key(from, to, relation)] ?? -Infinity);
  if (since < CONFIG.diplomacy.cooldown) {
    return { ok: false, reason: `${COUNTRIES[to].name} answered that recently — ask again in ${Math.ceil(CONFIG.diplomacy.cooldown - since)} ticks.` };
  }
  return { ok: true };
}

export function proposeRelation(state, from, to, relation) {
  const check = canPropose(state, from, to, relation);
  if (!check.ok) return check;
  const d = diplomacyOf(state);
  const proposal = { id: d.nextId++, from, to, relation, at: state.tick };
  d.proposals.push(proposal);
  return { ok: true, proposal };
}

// Saying yes or no. `by` is the government answering, and it must be the one
// the proposal was put TO — a nation cannot accept its own offer on the other
// side's behalf.
export function answerProposal(state, proposalId, accept, by) {
  const d = diplomacyOf(state);
  const proposal = d.proposals.find((p) => p.id === proposalId);
  if (!proposal) return { ok: false, reason: 'That proposal is no longer on the table.' };
  if (by != null && proposal.to !== by) return { ok: false, reason: 'That proposal was not put to you.' };
  d.proposals = d.proposals.filter((p) => p.id !== proposalId);
  d.history[key(proposal.from, proposal.to, proposal.relation)] = state.tick;
  // Logged from the ANSWERER's side, because saying no is the news as much as
  // saying yes — and `eventsFor` finds it under either nation's name.
  noteEvent(state, accept ? 'pact' : 'refused', proposal.to,
    { about: proposal.from, what: proposal.relation });
  if (!accept) return { ok: true, accepted: false, proposal };
  // A peace made out of a war starts its own clock. Without it a government
  // could sign peace and declare again on the same tick, which would make the
  // hundred-tick ultimatum a formality rather than a cost.
  const ending = relationOf(state, proposal.from, proposal.to) === 'war' && proposal.relation === 'neutral';
  setRelation(state, proposal.from, proposal.to, proposal.relation);
  if (ending) d.history[key(proposal.from, proposal.to, 'peace')] = state.tick;
  return { ok: true, accepted: true, proposal, ended: ending };
}

export function withdrawProposal(state, proposalId, by) {
  const d = diplomacyOf(state);
  const proposal = d.proposals.find((p) => p.id === proposalId);
  if (!proposal) return { ok: false, reason: 'No such proposal.' };
  if (by != null && proposal.from !== by) return { ok: false, reason: 'That is not yours to withdraw.' };
  d.proposals = d.proposals.filter((p) => p.id !== proposalId);
  return { ok: true, proposal };
}

// --- declaring war ----------------------------------------------------------

export function canDeclareWar(state, from, to) {
  if (from === to) return { ok: false, reason: 'A nation cannot declare war on itself.' };
  if (!COUNTRIES[to] || !isAlive(state, to) || !isAlive(state, from)) {
    return { ok: false, reason: 'That nation no longer exists.' };
  }
  if (relationOf(state, from, to) === 'war') return { ok: false, reason: 'Already at war.' };
  if (ultimatumBetween(state, from, to)) return { ok: false, reason: 'War has already been declared.' };
  const since = state.tick - (diplomacyOf(state).history[key(from, to, 'peace')] ?? -Infinity);
  if (since < CONFIG.diplomacy.peaceCooldown) {
    return { ok: false, reason: `The peace with ${COUNTRIES[to].name} is ${Math.ceil(since)} ticks old — it holds for ${Math.ceil(CONFIG.diplomacy.peaceCooldown - since)} more.` };
  }
  return { ok: true };
}

// The declaration itself. Note what it does IMMEDIATELY and what it does not:
// an alliance or an access agreement between the two is torn up on the spot,
// because you cannot be somebody's ally and be marching on them. Everything
// else waits out the ultimatum.
export function declareWar(state, from, to, reason = null) {
  const check = canDeclareWar(state, from, to);
  if (!check.ok) return check;
  const d = diplomacyOf(state);
  if (relationOf(state, from, to) !== 'neutral') setRelation(state, from, to, 'neutral');
  nudgeOpinion(state, to, from, CONFIG.diplomacy.opinion.war);
  nudgeOpinion(state, from, to, CONFIG.diplomacy.opinion.attacker);
  punishAttackOnFriend(state, from, to);
  const ultimatum = {
    id: d.nextId++, from, to, at: state.tick,
    beginsAt: state.tick + CONFIG.diplomacy.warDelay,
    reason,
  };
  d.ultimatums.push(ultimatum);
  d.lastWarAt = state.tick;
  noteEvent(state, 'declared', from, { about: to });
  // Whichever of the two is yours, this is news — being declared on matters
  // rather more than declaring.
  if (isPlayer(state, to)) {
    pushAlert(state, `${COUNTRIES[from].name} has declared war — fighting begins in ${CONFIG.diplomacy.warDelay} ticks.`, 'danger');
  } else if (isPlayer(state, from)) {
    pushAlert(state, `War declared on ${COUNTRIES[to].name} — fighting begins in ${CONFIG.diplomacy.warDelay} ticks.`, 'warn');
  }
  return { ok: true, ultimatum };
}

// Calling it off, which is only possible while it is still an ultimatum. Once
// the fighting starts the way out is peace, and peace has to be agreed.
export function callOffWar(state, ultimatumId, by) {
  const d = diplomacyOf(state);
  const ultimatum = d.ultimatums.find((u) => u.id === ultimatumId);
  if (!ultimatum) return { ok: false, reason: 'No such declaration.' };
  if (by != null && ultimatum.from !== by) {
    return { ok: false, reason: 'Only the government that declared it can call it off.' };
  }
  d.ultimatums = d.ultimatums.filter((u) => u.id !== ultimatumId);
  if (isPlayer(state, ultimatum.to)) {
    pushAlert(state, `${COUNTRIES[ultimatum.from].name} has called off its declaration of war.`, 'good');
  }
  return { ok: true, ultimatum };
}

// --- the tick ---------------------------------------------------------------

export function runRelations(state) {
  const d = diplomacyOf(state);
  beginWars(state, d);
  lapseProposals(state, d);
  if (state.tick % CONFIG.diplomacy.every !== 0) return;
  decayOpinions(state);
  answerTheWorld(state, d);
  proposeAmongTheWorld(state, d);
  declareAmongTheWorld(state, d);
}

// An ultimatum that has run its course. This is the only place a relation
// becomes `war`, which is what makes the delay unconditional: there is no path
// from a declaration to a shot fired that does not go through here.
function beginWars(state, d) {
  const due = d.ultimatums.filter((u) => state.tick >= u.beginsAt);
  if (!due.length) return;
  d.ultimatums = d.ultimatums.filter((u) => state.tick < u.beginsAt);
  for (const u of due) {
    // It may have been settled some other way while the clock ran.
    if (relationOf(state, u.from, u.to) === 'war') continue;
    setRelation(state, u.from, u.to, 'war');
    noteEvent(state, 'war', u.from, { about: u.to });
    if (isPlayer(state, u.from) || isPlayer(state, u.to)) {
      const other = isPlayer(state, u.from) ? u.to : u.from;
      pushAlert(state, `The war with ${COUNTRIES[other].name} has begun.`, 'danger');
    }
    // A proposal cannot survive the war it was overtaken by.
    d.proposals = d.proposals.filter((p) =>
      !((p.from === u.from && p.to === u.to) || (p.from === u.to && p.to === u.from)));
    if (CONFIG.diplomacy.alliesJoin) dragInAllies(state, u);
  }
}

// The defender's allies are dragged in — and dragged in the SAME WAY as
// everybody else, with their own declaration and their own hundred ticks.
// There is no back door round the delay, which is what makes an alliance worth
// signing and worth thinking twice about.
function dragInAllies(state, war) {
  for (const ally of alliesOf(state, war.to)) {
    if (ally === war.from) continue;
    declareWar(state, ally, war.from, `alliance with ${COUNTRIES[war.to].name}`);
  }
}

export function alliesOf(state, id) {
  const row = state.diplomacy?.relations?.[id] ?? {};
  return Object.keys(row).filter((other) => row[other] === 'alliance');
}

function lapseProposals(state, d) {
  if (!d.proposals.length) return;
  const kept = d.proposals.filter((p) => state.tick - p.at < CONFIG.diplomacy.proposalTtl);
  if (kept.length === d.proposals.length) return;
  for (const p of d.proposals) {
    if (kept.includes(p)) continue;
    // Letting one lapse counts as an answer, so the same government does not
    // come straight back with it — the same rule technology licences follow.
    d.history[key(p.from, p.to, p.relation)] = state.tick;
    if (isPlayer(state, p.from)) {
      pushAlert(state, `${COUNTRIES[p.to].name} never answered your proposal of ${label(p.relation)}.`, 'info');
    }
  }
  d.proposals = kept;
}

// Every government answers what has been put to it. YOURS is the only inbox
// that waits for a person: a proposal to you sits until you answer it or it
// lapses, and every other nation decides on the same appetite you can read off
// the panel.
function answerTheWorld(state, d) {
  for (const proposal of d.proposals.slice()) {
    if (proposal.to === state.home) continue;
    const want = relationAppetite(state, proposal.to, proposal.from, proposal.relation)
      + jitter(state, `answer${proposal.id}`);
    const accept = want >= CONFIG.diplomacy.accept;
    answerProposal(state, proposal.id, accept, proposal.to);
    if (!isPlayer(state, proposal.from)) continue;
    pushAlert(state, accept
      ? `${COUNTRIES[proposal.to].name} accepts ${label(proposal.relation)}.`
      : `${COUNTRIES[proposal.to].name} declines ${label(proposal.relation)}.`, accept ? 'good' : 'warn');
  }
}

// ...and a few of them go looking. Which few is a pure function of the seed and
// the tick, so a save replayed sees the same diplomacy — the same rule
// `licenseAmongTheWorld` follows for the same reason.
function proposeAmongTheWorld(state, d) {
  const pool = COUNTRY_IDS.filter((id) => id !== state.home && state.countries[id]?.solvent && isAlive(state, id));
  if (!pool.length) return;
  for (let n = 0; n < CONFIG.diplomacy.seekersPerTick; n++) {
    const from = pool[(state.seed + state.tick * 7 + n * 101) % pool.length];
    const to = bestPartnerFor(state, from, n);
    if (!to) continue;
    if (to === state.home) {
      if (!CONFIG.diplomacy.unsolicitedToPlayer) continue;
      // Your inbox is capped the same way a government's outbox is. Diplomacy
      // the world puts to you is meant to be an occasional decision, not a
      // queue — and a stack of pacts is a stack you stop reading, which is the
      // same reason a declined technology has a cooldown.
      if (proposalsTo(state, state.home).length >= CONFIG.diplomacy.maxProposals) continue;
    }
    const relation = relationOf(state, from, to) === 'war' ? 'neutral'
      : relationOf(state, from, to) === 'access' ? 'alliance' : 'access';
    const result = proposeRelation(state, from, to, relation);
    if (!result.ok) continue;
    // A proposal put to another government is answered by the next review; one
    // put to you sits in your inbox until you answer it.
    if (isPlayer(state, to)) {
      pushAlert(state, `${COUNTRIES[from].name} proposes ${label(relation)}.`, 'info');
    }
  }
}

function declareAmongTheWorld(state, d) {
  if (state.tick - (d.lastWarAt ?? -Infinity) < CONFIG.diplomacy.warQuiet) return;
  let declared = 0;
  const pool = COUNTRY_IDS.filter((id) => id !== state.home && state.countries[id]?.solvent && isAlive(state, id));
  if (!pool.length) return;
  const start = (state.seed + state.tick * 17) % pool.length;
  for (let n = 0; n < pool.length && declared < CONFIG.diplomacy.warsPerReview; n++) {
    const from = pool[(start + n) % pool.length];
    const target = bestWarTarget(state, from, n);
    if (!target) continue;
    const result = declareWar(state, from, target, 'hostile relations');
    if (result.ok) declared++;
  }
}

function bestWarTarget(state, from, salt) {
  const pool = nearestTo(from);
  let best = null;
  for (let i = 0; i < pool.length; i++) {
    const to = pool[(state.seed + state.tick * 19 + salt * 43 + i * 131) % pool.length];
    if (!to || to === from || !canDeclareWar(state, from, to).ok) continue;
    const want = warAppetite(state, from, to) + jitter(state, `war${from}${to}`);
    if (!best || want > best.want) best = { to, want };
  }
  return best && best.want >= CONFIG.diplomacy.warAppetite ? best.to : null;
}

// Who this government would most like to deal with. It looks at its NEAREST
// NEIGHBOURS rather than at a random sample of the planet, and that is not an
// optimisation — it is the whole reason the diplomatic map ends up looking like
// a map.
//
// Sampling the whole world uniformly was the first version and it produced a
// world of 182 basing agreements and not one alliance: a nation was only ever
// asked about strangers, and `relationAppetite` quite correctly refuses to
// promise to fight a stranger's war. Neighbours are who you have something to
// settle with.
//
// The nearest list is CACHED per country: `neighboursOf` sorts 257 countries by
// distance, and doing that three times a tick for the life of a game is a sort
// nobody needs to repeat — the distance matrix it reads never changes.
const NEARBY = new Map();
function nearestTo(id) {
  let list = NEARBY.get(id);
  if (!list) { list = neighboursOf(id).slice(0, 24); NEARBY.set(id, list); }
  return list;
}

function bestPartnerFor(state, from, salt) {
  const pool = nearestTo(from);
  let best = null;
  for (let i = 0; i < 12; i++) {
    const to = pool[(state.seed + state.tick * 13 + salt * 37 + i * 211) % pool.length];
    if (!to || to === from) continue;
    const now = relationOf(state, from, to);
    if (now === 'alliance') continue;
    const relation = now === 'war' ? 'neutral' : now === 'access' ? 'alliance' : 'access';
    if (!canPropose(state, from, to, relation).ok) continue;
    const want = relationAppetite(state, from, to, relation);
    if (!best || want > best.want) best = { to, want };
  }
  // It only asks for something it actually wants, or the world spends the game
  // proposing pacts nobody has a reason for.
  return best && best.want >= CONFIG.diplomacy.accept ? best.to : null;
}

// HOW MUCH ONE GOVERNMENT WANTS A RELATION WITH ANOTHER, on a 0..1 scale
// against `CONFIG.diplomacy.accept`. Three things decide it and they are the
// three that would decide it in life:
//
//   - DISTANCE. A neighbour's basing rights are worth something; a nation on
//     the far side of the planet is a stranger. `haulShare` is the same measure
//     freight is priced on, so geography means one thing in this game.
//   - POWER. A small nation wants a big one's alliance far more than the other
//     way round, which is why the ratio is not symmetric.
//   - STANDING. Somebody you already grant access to is most of the way to an
//     ally; somebody you are at war with is not being offered a base.
//
// It is a pure function of `state`, so the panel can show you the answer you
// are going to get before you ask for it — diplomacy you can read is diplomacy
// worth playing.
export function relationAppetite(state, from, to, relation) {
  const near = 1 - clamp01(haulShare(from, to));
  const theirs = powerOf(state, to);
  const mine = powerOf(state, from);
  const ratio = theirs / (theirs + mine || 1);
  const now = relationOf(state, from, to);
  const opinion = opinionOf(state, from, to) / 100;

  if (relation === 'neutral') {
    // Suing for peace. A government at war wants out in proportion to how badly
    // it is doing — an army it has lost and industry it is losing are the whole
    // argument for peace, and a nation that is winning has no reason to listen.
    if (now !== 'war') return 0.5;
    return clamp01(0.30 + ratio * 0.70 + (1 - near) * 0.15 + opinion * 0.20);
  }
  const standing = now === 'access' ? 0.18 : 0;
  if (relation === 'access') return clamp01(0.24 + near * 0.38 + ratio * 0.28 + standing + opinion * 0.22);
  // An alliance is a promise to fight somebody else's war, so it is asked for
  // far less freely than a landing strip.
  return clamp01(0.02 + near * 0.30 + ratio * 0.34 + standing + opinion * 0.28);
}

export function warAppetite(state, from, to) {
  if (relationOf(state, from, to) === 'war' || ultimatumBetween(state, from, to)) return 0;
  const near = 1 - clamp01(haulShare(from, to));
  const theirs = powerOf(state, to);
  const mine = powerOf(state, from);
  const advantage = mine / (mine + theirs || 1);
  const dislike = clamp01(-opinionOf(state, from, to) / 100);
  const border = near > 0.82 ? 0.12 : 0;
  return clamp01(dislike * 0.62 + near * 0.18 + advantage * 0.16 + border);
}

// The size of a nation, for diplomacy's purposes: its economy and its army.
// Used only as a RATIO against another nation, so the units cancel and what is
// left is "how much bigger than me are they".
export function powerOf(state, id) {
  const gov = state.countries[id];
  if (!gov) return 0;
  const army = unitsOf(state, id).reduce((sum, u) => sum + u.strength, 0);
  return Math.max(0.01, gov.demand + army / 4);
}

// A small deterministic wobble, so the world is not a lookup table: the same
// proposal put again in a hundred ticks may get a different answer. Pure in
// `seed`, `tick` and the salt, so a replayed save sees the same diplomacy.
function jitter(state, salt) {
  return (hash(`${state.seed}:${state.tick}:${salt}`) / 4294967296 - 0.5) * 2 * CONFIG.diplomacy.jitter;
}

function punishAttackOnFriend(state, attacker, defender) {
  const { friendThreshold, friendAttack } = CONFIG.diplomacy.opinion;
  for (const id of COUNTRY_IDS) {
    if (id === attacker || id === defender) continue;
    const fondness = opinionOf(state, id, defender);
    if (fondness < friendThreshold) continue;
    nudgeOpinion(state, id, attacker, friendAttack * Math.min(1, fondness / 100));
  }
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function key(a, b, relation) {
  return a < b ? `${a}|${b}|${relation}` : `${b}|${a}|${relation}`;
}

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function label(relation) {
  return relation === 'alliance' ? 'an alliance'
    : relation === 'access' ? 'military access'
      : relation === 'war' ? 'war' : 'peace';
}
