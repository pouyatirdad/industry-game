import { CONFIG } from '../core/config.js';
import { COMMODITIES } from '../data/commodities.js';
import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { UNIT_TYPES } from '../systems/military.js';
import { eventsFor, ownerName } from '../core/state.js';
import { moneyShort, num, setAttr, setText, html } from './format.js';

// NOTIFICATIONS: what the rest of the world has just done.
//
// The alerts in the corner are YOUR news and expire on a wall clock. This is the
// world's, and it expires on the tick clock — `CONFIG.events.ttl` ticks, because
// 258 governments acting constantly is a great deal of paper and none of it is
// worth keeping for the length of a game.
//
// The systems store DATA (`kind`, `who`, `about`, `what`, `qty`) and this file
// is the only place it becomes a sentence. That is not tidiness: `src/systems`
// may not contain presentation text, and a formatted string per row would also
// make the save several times bigger for nothing.

// Three filters, and the third is a nation you pick. `all` is the world, `home`
// is anything you were party to — `eventsFor` matches on `who` OR `about`, so a
// pact France proposed to you appears under both names.
const FILTERS = [
  { id: 'all', label: 'World' },
  { id: 'home', label: 'Yours' },
];

// What each kind of row looks like. `e.who` is the government that acted and
// `e.about` whoever it acted with; everything else is a number or an id.
const LINES = {
  pact: (e) => `agreed ${relationWord(e.what)} with ${name(e.about)}`,
  refused: (e) => `turned down ${relationWord(e.what)} with ${name(e.about)}`,
  declared: (e) => `DECLARED WAR on ${name(e.about)} — fighting begins in ${CONFIG.diplomacy.warDelay} ticks`,
  war: (e) => `is now AT WAR with ${name(e.about)}`,
  contract: (e) => `contracted to supply ${name(e.about)} with ${num(e.qty)} ${good(e.what)}/tick`,
  army: (e) => `raised ${UNIT_TYPES[e.what]?.name ?? e.what}${e.qty > 0 ? ` — ${moneyShort(e.qty)} of it bought in` : ''}`,
  terror: () => 'has a terrorist cell on its soil',
  terrorGone: (e) => `destroyed the cell in ${name(e.about)} — ${moneyShort(e.qty)} bounty`,
  conquest: (e) => `took ground from ${name(e.about)}`,
  seized: () => 'lost ground to a terrorist cell',
  conquered: () => 'HAS BEEN CONQUERED — it no longer exists',
  restored: () => 'holds its ground again',
  annexed: (e) => `ANNEXED ${name(e.about)} — its treasury, people and industry${e.qty > 0 ? ` (${moneyShort(e.qty)})` : ''}`,
};

// How loud a row is. Only three levels, because a list where everything is
// urgent is a list where nothing is.
const TONE = {
  declared: 'bad', war: 'bad', terror: 'bad', conquered: 'bad', seized: 'bad',
  terrorGone: 'good', pact: 'good', restored: 'good',
  conquest: 'warn', annexed: 'bad',
  refused: 'warn',
};

export function mountEvents(refs, ctx) {
  refs.eventFilters.replaceChildren(...FILTERS.map((f) => {
    const btn = html(`<button type="button" class="speed" data-filter="${f.id}">${f.label}</button>`);
    btn.addEventListener('click', () => ctx.onEventFilter(f.id));
    return btn;
  }));

  refs.eventCountry.replaceChildren(
    html('<option value="">One nation…</option>'),
    ...COUNTRY_IDS.map((id) => html(`<option value="${id}">${COUNTRIES[id].name}</option>`)),
  );
  refs.eventCountry.addEventListener('change', () => {
    if (refs.eventCountry.value) ctx.onEventFilter(refs.eventCountry.value);
  });
}

export function updateEvents(refs, ctx) {
  const { state, ui } = ctx;
  const filter = ui.eventFilter === 'home' ? state.home : ui.eventFilter;
  const rows = eventsFor(state, filter);

  for (const btn of refs.eventFilters.children) {
    setAttr(btn, 'data-active', btn.dataset.filter === ui.eventFilter ? 'true' : null);
  }
  // The select shows a nation only while a nation is what is being shown, so
  // the two controls never both look active.
  const picked = ui.eventFilter !== 'all' && ui.eventFilter !== 'home' ? ui.eventFilter : '';
  if (refs.eventCountry.value !== picked) refs.eventCountry.value = picked;

  setText(refs.eventHead, rows.length
    ? `${num(rows.length)} in the last ${CONFIG.events.ttl} ticks`
    : `Nothing in the last ${CONFIG.events.ttl} ticks`);

  // Rows are rebuilt only when the log actually changed. The newest id and the
  // count together settle that: the log only ever gains at the end and loses
  // from the front, so those two cannot both match a different list.
  const sig = [ui.eventFilter, rows.length, rows[0]?.id ?? '', state.tick - (rows[0]?.tick ?? 0)].join('|');
  if (refs.eventList.dataset.sig === sig) return;
  refs.eventList.dataset.sig = sig;

  if (!rows.length) {
    refs.eventList.replaceChildren(html(`<p class="muted">The world has been quiet — or this nation has.
      Notifications are kept for ${CONFIG.events.ttl} ticks and then dropped.</p>`));
    return;
  }

  refs.eventList.replaceChildren(...rows.map((e) => {
    const line = LINES[e.kind];
    const mine = e.who === state.home || e.about === state.home;
    return html(`
      <div class="ev" data-tone="${TONE[e.kind] ?? 'info'}" data-mine="${mine}">
        <i class="country__swatch" style="--swatch:${COUNTRIES[e.who]?.color ?? '#888'}"></i>
        <span class="ev__body"><b>${name(e.who)}</b> ${line ? line(e) : e.kind}</span>
        <span class="ev__age">${state.tick - e.tick}t</span>
      </div>`);
  }));
}

function name(id) {
  return COUNTRIES[id]?.name ?? ownerName(id);
}

function good(id) {
  return COMMODITIES[id]?.name ?? id;
}

function relationWord(relation) {
  return relation === 'alliance' ? 'an alliance'
    : relation === 'access' ? 'military access'
      : relation === 'neutral' ? 'peace' : relation;
}
