import { BUILDINGS } from '../data/buildings.js';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities.js';
import { siteWages, warehouseUsed, bufferUsed, appetite } from '../core/state.js';
import { supplyRatio } from '../systems/domestic.js';
import { warehousesServing } from '../systems/logistics.js';
import { money, num, price, pct, setAttr, setText, html } from './format.js';

const STATUS_LABEL = {
  running: 'Running',
  starved: 'Starved',
  blocked: 'Output full',
  unstaffed: 'Unstaffed',
  store: 'Storing',
  idle: 'Idle',
};

// Every site you own, with the four questions a site can raise: what is going
// in, what it wants per job, what is coming out, and how much of the time it is
// actually working.
//
// The list is rebuilt only when the SET of sites changes; the numbers on each
// row are written in place every tick. Rebuilding forty rows a tick would throw
// away the open row and the scroll position, which is exactly the state you are
// using while you read the thing.
export function updateFactories(refs, ctx) {
  const { state, ui } = ctx;
  const mine = state.buildings.filter((b) => b.owner === state.home).sort(order);

  updateHead(refs.factoryHead, state, mine);

  const ids = mine.map((b) => b.id).join(',');
  if (refs.factoryList.dataset.ids !== ids) {
    refs.factoryList.dataset.ids = ids;
    refs.factoryList.replaceChildren(...mine.map((b) => row(b, ctx)));
  }

  // Indexed once rather than searched per row: this list can run to hundreds of
  // sites and it is repainted every tick.
  const byId = new Map(mine.map((b) => [b.id, b]));
  for (const node of refs.factoryList.children) {
    const b = byId.get(Number(node.dataset.id));
    if (!b) continue;
    const work = workShare(b);

    setAttr(node, 'data-status', b.status);
    setText(node.querySelector('.factory__status'), STATUS_LABEL[b.status] ?? b.status);
    setText(node.querySelector('.factory__pct'), pct(work));
    node.querySelector('.factory__fill').style.setProperty('--fill', `${Math.min(100, Math.round(work * 100))}%`);

    const open = ui.openFactoryId === b.id;
    setAttr(node, 'data-open', String(open));
    const detail = node.querySelector('.factory__detail');
    if (!open) { detail.replaceChildren(); detail.dataset.sig = ''; continue; }
    const sig = detailSig(state, b);
    if (detail.dataset.sig === sig) continue;
    detail.dataset.sig = sig;
    detail.replaceChildren(html(detailNode(state, b)));
  }
}

// Depots first, then by industry, then by where they stand. A site keeps its
// place in the list as it changes status, so the row you are reading does not
// jump out from under you.
function order(a, b) {
  const depot = Number(Boolean(b.store)) - Number(Boolean(a.store));
  if (depot) return depot;
  const name = BUILDINGS[a.type].name.localeCompare(BUILDINGS[b.type].name);
  return name || a.id - b.id;
}

function updateHead(host, state, mine) {
  const wages = mine.reduce((sum, b) => sum + siteWages(b), 0);
  const producers = mine.filter((b) => !b.store);
  const work = producers.length
    ? producers.reduce((sum, b) => sum + (b.uptime ?? 0), 0) / producers.length
    : 0;
  const troubled = producers.filter((b) => b.status === 'starved' || b.status === 'blocked' || b.status === 'unstaffed');

  const sig = [mine.length, producers.length, wages, Math.round(work * 100), troubled.length].join('|');
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;

  if (!mine.length) {
    host.replaceChildren(html('<p class="muted">No sites yet. Build a Warehouse first — nothing you produce can move without one.</p>'));
    return;
  }
  host.replaceChildren(html(`
    <dl class="facts">
      <div><dt>Sites</dt><dd>${num(mine.length)}</dd></div>
      <div><dt>Payroll</dt><dd>${money(wages)}/t</dd></div>
      <div><dt>Working</dt><dd>${producers.length ? pct(work) : '&mdash;'}</dd></div>
      <div><dt>Trouble</dt><dd${troubled.length ? ' class="is-negative"' : ''}>${num(troubled.length)}</dd></div>
    </dl>`));
}

function row(b, ctx) {
  const def = BUILDINGS[b.type];
  const node = html(`
    <div class="factory" data-id="${b.id}" data-open="false">
      <div class="factory__row">
        <button type="button" class="factory__main">
          <span class="factory__glyph">${def.glyph}</span>
          <span class="factory__id">
            <span class="factory__name">${def.name}</span>
            <span class="factory__where">(${b.x}, ${b.y})</span>
          </span>
          <span class="factory__work" title="${b.store ? 'How full this depot is' : 'Share of recent ticks this site actually worked'}">
            <i class="workbar"><i class="workbar__fill factory__fill"></i></i>
            <b class="factory__pct">0%</b>
          </span>
          <span class="factory__status"></span>
        </button>
        <button type="button" class="factory__kill" title="Demolish ${def.name} for ${money(Math.round(def.cost / 2))}">&times;</button>
      </div>
      <div class="factory__detail"></div>
    </div>`);
  node.querySelector('.factory__main').addEventListener('click', () => ctx.onToggleFactory(b.id));
  node.querySelector('.factory__kill').addEventListener('click', (event) => {
    event.stopPropagation();
    ctx.onRemoveBuilding(b.id);
  });
  return node;
}

// A depot has no recipe to run, so "working" is how full it is; a plant's is the
// rolling share of ticks it actually turned its recipe.
function workShare(b) {
  if (b.store) {
    const cap = BUILDINGS[b.type].capacity || 1;
    return Math.min(1, warehouseUsed(b) / cap);
  }
  return Math.min(1, Math.max(0, b.uptime ?? 0));
}

function detailSig(state, b) {
  const def = BUILDINGS[b.type];
  const bag = (contents) => (contents
    ? COMMODITY_IDS.map((id) => Math.round((contents[id] ?? 0) * 10)).join('.')
    : '');
  const prices = def.recipe
    ? Object.keys(def.recipe.out).map((id) => Math.round(state.markets[state.home][id].price)).join('.')
    : '';
  return [b.status, b.progress, Math.round((b.uptime ?? 0) * 50), b.shortage?.join('+') ?? '',
    bag(b.input), bag(b.output), bag(b.store), prices].join('|');
}

function detailNode(state, b) {
  const def = BUILDINGS[b.type];
  const served = warehousesServing(state, b.x, b.y, b.owner).length;
  const link = served
    ? `<p class="muted">Linked to ${served} warehouse${served > 1 ? 's' : ''}.</p>`
    : '<p class="is-negative">⚠ No warehouse in range — goods cannot move.</p>';

  if (!def.recipe) {
    const used = warehouseUsed(b);
    return `
      <div class="detail">
        <p class="muted">${money(siteWages(b))}/tick wages &middot; serves ${def.radius} tiles in every direction</p>
        ${meter(used / (def.capacity || 1), `${num(used)} / ${num(def.capacity)} stored`)}
        ${bagList('Holding', b.store, state)}
        <p class="muted">A depot sells to your own people first, up to what they eat in a tick, and offers whatever is left abroad.</p>
        ${link}
      </div>`;
  }

  const recipe = def.recipe;
  const inputs = Object.keys(recipe.in);
  return `
    <div class="detail">
      <p class="muted">${money(siteWages(b))}/tick wages &middot; one job every ${recipe.ticks} tick${recipe.ticks > 1 ? 's' : ''}${recipe.ticks > 1 ? ` &middot; job ${b.progress}/${recipe.ticks}` : ''}</p>
      ${meter(workShare(b), `working ${pct(workShare(b))} of recent ticks`)}
      ${inputs.length ? needsList(b, recipe) : '<p class="muted">Takes nothing in — it works the deposit under it.</p>'}
      ${makesList(state, b, def)}
      ${bagList('Awaiting pickup', b.output, state, `${num(bufferUsed(b.output))} / ${num(def.outCap)}`)}
      ${link}
    </div>`;
}

// What the recipe wants per job against what is actually in the hopper. This is
// the pair of numbers that explains a starved plant, so they sit side by side.
function needsList(b, recipe) {
  const rows = Object.entries(recipe.in).map(([id, need]) => {
    const have = b.input?.[id] ?? 0;
    const short = have < need;
    return `<li data-short="${short}">
        <span><i class="swatch" style="--swatch:${COMMODITIES[id].color}"></i>${COMMODITIES[id].name}</span>
        <b>${num(have)} <span class="muted">/ ${num(need)} per job</span></b>
      </li>`;
  }).join('');
  return `<div class="bag"><h4>Needs</h4><ul class="needs">${rows}</ul></div>`;
}

// What it turns out, at what rate, and whether anyone at home still wants it —
// a plant running flat out into a market that is already full is the quiet way
// to lose money.
function makesList(state, b, def) {
  const rows = Object.entries(def.recipe.out).map(([id, qty]) => {
    const nominal = qty / def.recipe.ticks;
    const actual = nominal * workShare(b);
    const met = supplyRatio(state, state.home, id);
    return `<li>
        <span><i class="swatch" style="--swatch:${COMMODITIES[id].color}"></i>${COMMODITIES[id].name}</span>
        <b>${actual.toFixed(1)}<span class="muted">/${nominal.toFixed(1)} per tick</span></b>
      </li>
      <li class="needs__note muted">
        <span>home demand ${appetite(state, state.home, id).toFixed(1)}/t, ${pct(met)} met</span>
        <b>${price(state.markets[state.home][id].price)}</b>
      </li>`;
  }).join('');
  return `<div class="bag"><h4>Makes</h4><ul class="needs">${rows}</ul></div>`;
}

function bagList(title, contents, state, suffix = '') {
  if (!contents) return '';
  const rows = COMMODITY_IDS
    .filter((id) => (contents[id] ?? 0) > 0.5)
    .sort((a, c) => contents[c] - contents[a])
    .map((id) => `<li>
        <span><i class="swatch" style="--swatch:${COMMODITIES[id].color}"></i>${COMMODITIES[id].name}</span>
        <b>${num(contents[id])} <span class="muted">@ ${price(state.markets[state.home][id].price)}</span></b>
      </li>`)
    .join('');
  const head = suffix ? `${title} <span class="muted">${suffix}</span>` : title;
  return `<div class="bag"><h4>${head}</h4>${rows ? `<ul>${rows}</ul>` : '<p class="muted">empty</p>'}</div>`;
}

function meter(share, label) {
  const fill = Math.min(100, Math.round(share * 100));
  return `<div class="meter">
      <div class="meter__bar" style="--fill:${fill}%" data-good="${share >= 0.5}"></div>
      <span class="meter__label">${label}</span>
    </div>`;
}
