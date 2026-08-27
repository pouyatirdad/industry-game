import { BUILDINGS } from '../data/buildings.js';
import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { hasPact } from '../core/state.js';
import { moneyShort, num, pct, setAttr, setText, html } from './format.js';

// Forty-six nations, scored against each other on the six things a government
// can actually be judged on. Every nation in the game is run by the same code
// out of its own treasury, so "how am I doing" only means anything relative to
// them — and the map cannot answer it, because a nation's industry is invisible
// from orbit.
//
// Each measure is normalised against the best in the world, so the score is a
// standing rather than a unit: 100 would be a nation that led every column at
// once, which nothing ever does.
const WEIGHTS = [
  { id: 'economy', label: 'Econ', weight: 30, title: 'The size of its home market — the one country figure that moves during a game.' },
  { id: 'sites', label: 'Sites', weight: 20, title: 'How much industry it has actually built.' },
  { id: 'output', label: 'Out/t', weight: 20, title: 'What that industry turns out per tick, valued at its own local prices.' },
  { id: 'supply', label: 'Fed', weight: 15, title: 'How much of what its people want is reaching them.' },
  { id: 'cash', label: 'Cash', weight: 10, title: 'Treasury.' },
  { id: 'trade', label: 'Trade', weight: 5, title: 'Exports less imports, per tick.' },
];

// The columns the table shows, in order. `score` and `name` are not measures.
const COLUMNS = [
  { id: 'score', label: 'Score', title: 'The weighted total out of 100.' },
  ...WEIGHTS,
];

export function mountRanks(refs, ctx) {
  const head = [html('<th title="Rank">#</th>'), html('<th>Nation</th>')];
  for (const col of COLUMNS) {
    const th = html(`<th class="ranks__col" data-col="${col.id}">${col.label}</th>`);
    th.title = `${col.title}${col.weight ? ` Worth ${col.weight} of the score.` : ''} Click to rank by it.`;
    th.addEventListener('click', () => ctx.onRankSort(col.id));
    head.push(th);
  }
  refs.ranksCols.replaceChildren(...head);

  refs.ranksBody.replaceChildren(...COUNTRY_IDS.map((id) => html(`
    <tr data-country="${id}">
      <td class="ranks__place"></td>
      <th scope="row"><i class="swatch" style="--swatch:${COUNTRIES[id].color}"></i>${COUNTRIES[id].name}</th>
      <td class="ranks__score"></td>
      ${WEIGHTS.map((w) => `<td class="ranks__${w.id}"></td>`).join('')}
    </tr>`)));
}

export function updateRanks(refs, ctx) {
  const { state, ui } = ctx;
  const rows = scoreNations(state);
  const sort = ui.rankSort ?? 'score';
  rows.sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0));

  for (const th of refs.ranksCols.children) {
    setAttr(th, 'data-active', th.dataset.col === sort ? 'true' : null);
  }

  // Rows are keyed by country and updated in place; they are only re-ordered
  // when the order genuinely changes. Rebuilding forty-six rows a tick would
  // throw away the scroll position you are reading with.
  const byId = new Map([...refs.ranksBody.children].map((node) => [node.dataset.country, node]));
  const order = rows.map((row) => row.id).join(',');
  if (refs.ranksBody.dataset.order !== order) {
    refs.ranksBody.dataset.order = order;
    refs.ranksBody.replaceChildren(...rows.map((row) => byId.get(row.id)));
  }

  rows.forEach((row, index) => {
    const node = byId.get(row.id);
    if (!node) return;
    setAttr(node, 'data-home', row.id === state.home ? 'true' : null);
    setAttr(node, 'data-pact', row.id !== state.home && hasPact(state, row.id) ? 'true' : null);
    setText(node.querySelector('.ranks__place'), String(index + 1));
    setText(node.querySelector('.ranks__score'), row.score.toFixed(1));
    setText(node.querySelector('.ranks__economy'), row.economy.toFixed(1));
    setText(node.querySelector('.ranks__sites'), num(row.sites));
    setText(node.querySelector('.ranks__output'), moneyShort(row.output));
    setText(node.querySelector('.ranks__supply'), pct(row.supply));
    setText(node.querySelector('.ranks__cash'), moneyShort(row.cash));
    const trade = node.querySelector('.ranks__trade');
    setText(trade, `${row.trade >= 0 ? '+' : '-'}${moneyShort(Math.abs(row.trade))}`);
    setAttr(trade, 'data-dir', row.trade > 0 ? 'up' : row.trade < 0 ? 'down' : null);
  });

  updateHead(refs.ranksHead, state, rows);
}

function updateHead(host, state, rows) {
  const place = rows.findIndex((row) => row.id === state.home) + 1;
  const me = rows.find((row) => row.id === state.home);
  const leader = rows[0];
  const sig = [place, me?.score.toFixed(1), leader?.id, leader?.score.toFixed(1)].join('|');
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  host.replaceChildren(html(`
    <dl class="facts">
      <div><dt>Your place</dt><dd>${num(place)} of ${num(rows.length)}</dd></div>
      <div><dt>Your score</dt><dd>${me ? me.score.toFixed(1) : '—'}</dd></div>
      <div><dt>Leader</dt><dd>${leader ? COUNTRIES[leader.id].name : '—'}</dd></div>
      <div><dt>Its score</dt><dd>${leader ? leader.score.toFixed(1) : '—'}</dd></div>
    </dl>`));
}

// One pass over the world's buildings, then one normalisation pass. Asking each
// nation for its own sites would be forty-six scans of every building there is.
export function scoreNations(state) {
  const sites = new Map();
  const output = new Map();
  for (const b of state.buildings) {
    sites.set(b.owner, (sites.get(b.owner) ?? 0) + 1);
    const recipe = BUILDINGS[b.type].recipe;
    if (!recipe) continue;
    const market = state.markets[b.owner];
    let value = 0;
    for (const [id, qty] of Object.entries(recipe.out)) value += (qty / recipe.ticks) * (market?.[id]?.price ?? 0);
    // Valued at what it is ACTUALLY turning out: a plant standing idle for want
    // of coal is not industry, whatever it cost to build.
    output.set(b.owner, (output.get(b.owner) ?? 0) + value * Math.min(1, Math.max(0, b.uptime ?? 0)));
  }

  const rows = COUNTRY_IDS.map((id) => {
    const gov = state.countries[id];
    return {
      id,
      economy: gov.demand,
      sites: sites.get(id) ?? 0,
      output: output.get(id) ?? 0,
      supply: gov.supply,
      cash: gov.cash,
      trade: gov.report.exports - gov.report.imports,
      score: 0,
    };
  });

  for (const { id, weight } of WEIGHTS) {
    let low = Infinity;
    let high = -Infinity;
    for (const row of rows) {
      low = Math.min(low, row[id]);
      high = Math.max(high, row[id]);
    }
    const span = high - low;
    for (const row of rows) {
      row.score += weight * (span > 0 ? (row[id] - low) / span : 1);
    }
  }
  return rows;
}
