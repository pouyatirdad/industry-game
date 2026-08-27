import { CONFIG } from '../core/config.js';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities.js';
import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { projectedWages, warehouseStock, hasPact, ownerName, ownFlows } from '../core/state.js';
import { supplyRatio } from '../systems/domestic.js';
import { money, num, price, pct, html } from './format.js';

// One tab that answers "how is the nation doing" without reading the other
// four. Everything here is derived — the summary owns no state of its own — so
// it can be rebuilt whenever its signature moves and can never drift out of
// step with the panels it summarises.
export function updateSummary(host, ctx) {
  const { state } = ctx;
  const me = state.countries[state.home];
  const def = COUNTRIES[state.home];
  const wages = projectedWages(state);
  const sites = siteCounts(state);
  const shortfalls = homeShortfalls(state);
  const held = topStock(state);
  const partners = COUNTRY_IDS.filter((id) => id !== state.home && hasPact(state, id));

  const sig = [
    state.home, Math.round(me.cash), me.report.net, me.report.tax, me.report.domestic,
    me.report.exports, me.report.imports, wages, sites.total, sites.running, sites.starved,
    sites.blocked, sites.unstaffed, sites.idle, sites.stores, Math.round(sites.work * 100),
    me.demand.toFixed(1), me.supply.toFixed(2), partners.length,
    shortfalls.map((s) => s.id + Math.round(s.met * 100)).join(','),
    held.map((s) => s.id + Math.round(s.qty)).join(','),
  ].join('|');
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;

  const grows = me.supply >= CONFIG.growth.pivot;
  const balance = me.report.exports - me.report.imports;

  host.replaceChildren(html(`
    <div class="summary__inner">
      <section class="card card--wide">
        <h4>Treasury</h4>
        <p class="card__big ${me.cash < 0 ? 'is-negative' : ''}">${money(me.cash)}</p>
        <ul class="ledger">
          ${ledgerRow('Taxes', me.report.tax)}
          ${ledgerRow('Sold at home', me.report.domestic)}
          ${ledgerRow('Exports', me.report.exports)}
          ${ledgerRow('Imports', -me.report.imports)}
          ${ledgerRow('Payroll', -wages)}
          ${ledgerRow('Net per tick', me.report.net, 'ledger__total')}
        </ul>
      </section>

      <section class="card">
        <h4>Your people</h4>
        <div class="meter" title="Share of what your people want that is actually reaching them">
          <div class="meter__bar" style="--fill:${Math.min(100, Math.round(me.supply * 100))}%" data-good="${grows}"></div>
          <span class="meter__label">${pct(me.supply)} of demand met &middot; economy ${grows ? 'growing' : 'shrinking'}</span>
        </div>
        <dl class="facts">
          <div><dt>Economy</dt><dd>${me.demand.toFixed(1)} / ${def.demand}</dd></div>
          <div><dt>Population</dt><dd>${def.pop >= 10 ? Math.round(def.pop) : def.pop}m</dd></div>
        </dl>
      </section>

      <section class="card">
        <h4>Industry</h4>
        <p class="card__big">${num(sites.total)} <span class="card__unit">sites</span></p>
        <ul class="chips">
          ${chip('running', sites.running)}
          ${chip('starved', sites.starved)}
          ${chip('blocked', sites.blocked)}
          ${chip('unstaffed', sites.unstaffed)}
          ${chip('idle', sites.idle)}
          ${chip('store', sites.stores)}
        </ul>
        <dl class="facts">
          <div><dt>Working</dt><dd>${sites.producers ? pct(sites.work) : '&mdash;'}</dd></div>
          <div><dt>Payroll</dt><dd>${money(wages)}/t</dd></div>
        </dl>
      </section>

      <section class="card card--wide">
        <h4>Resources</h4>
        ${shortfalls.length
          ? `<ul class="bars">${shortfalls.map((s) => bar(s.id, s.met)).join('')}</ul>`
          : '<p class="card__sub good-text">Every commodity your people want is fully supplied.</p>'}
        ${held.length
          ? `<ul class="ledger">${held.map((s) => `<li><span>${COMMODITIES[s.id].name} stored</span><b>${num(s.qty)} <span class="muted">@ ${price(state.markets[state.home][s.id].price)}</span></b></li>`).join('')}</ul>`
          : '<p class="card__sub muted">Warehouses are empty.</p>'}
      </section>

      <section class="card card--wide">
        <h4>Trade</h4>
        <p class="card__big ${balance < 0 ? 'is-negative' : ''}">${balance >= 0 ? '+' : ''}${money(balance)}</p>
        <p class="card__sub">${num(partners.length)} of ${COUNTRY_IDS.length - 1} markets open</p>
        ${recentPartners(state)}
      </section>
    </div>`));
}

function ledgerRow(label, value, extra = '') {
  const cls = value < 0 ? 'is-negative' : value > 0 ? 'good-text' : 'muted';
  return `<li class="${extra}"><span>${label}</span><b class="${cls}">${value < 0 ? '-' : '+'}${money(Math.abs(value))}</b></li>`;
}

const CHIP_LABEL = {
  running: 'running', starved: 'starved', blocked: 'output full',
  unstaffed: 'unstaffed', idle: 'idle', store: 'depots',
};

function chip(kind, n) {
  if (!n) return '';
  return `<li class="chip" data-status="${kind}">${num(n)} ${CHIP_LABEL[kind]}</li>`;
}

function bar(commodityId, met) {
  const fill = Math.min(100, Math.round(met * 100));
  return `<li>
      <span>${COMMODITIES[commodityId].name}</span>
      <i class="bars__track"><i class="bars__fill" style="--fill:${fill}%" data-good="${met >= CONFIG.growth.pivot}"></i></i>
      <b>${pct(met)}</b>
    </li>`;
}

// Sites are counted by the status the tick just left on them, which is exactly
// what the map paints and what the factory list shows. Depots are counted apart
// because a warehouse has no recipe to run and so no working percentage.
function siteCounts(state) {
  const out = { total: 0, running: 0, starved: 0, blocked: 0, unstaffed: 0, idle: 0, stores: 0, producers: 0, work: 0 };
  let uptime = 0;
  for (const b of state.buildings) {
    if (b.owner !== state.home) continue;
    out.total++;
    if (b.store) { out.stores++; continue; }
    out.producers++;
    uptime += b.uptime ?? 0;
    if (b.status === 'running') out.running++;
    else if (b.status === 'starved') out.starved++;
    else if (b.status === 'blocked') out.blocked++;
    else if (b.status === 'unstaffed') out.unstaffed++;
    else out.idle++;
  }
  out.work = out.producers ? uptime / out.producers : 0;
  return out;
}

function homeShortfalls(state) {
  return COMMODITY_IDS
    .map((id) => ({ id, met: supplyRatio(state, state.home, id) }))
    .filter((row) => row.met < 0.999)
    .sort((a, b) => a.met - b.met)
    .slice(0, 3);
}

function topStock(state) {
  return COMMODITY_IDS
    .map((id) => ({ id, qty: warehouseStock(state, id) }))
    .filter((row) => row.qty >= 1)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 2);
}

// Who you actually dealt with lately, rather than who you could deal with.
function recentPartners(state) {
  const value = new Map();
  for (const f of ownFlows(state)) {
    const other = f.from === state.home ? f.to : f.from;
    value.set(other, (value.get(other) ?? 0) + f.value);
  }
  const rows = [...value.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  if (!rows.length) return '<p class="card__sub muted">No deals yet.</p>';
  return `<ul class="ledger">${rows
    .map(([id, v]) => `<li><span>${ownerName(id)}</span><b>${money(v)}</b></li>`)
    .join('')}</ul>`;
}
