import { CONFIG } from '../core/config.js';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities.js';
import { COUNTRIES, COUNTRY_IDS } from '../data/countries.js';
import { appetite, allOwners, pushAlert } from '../core/state.js';
import { supplyRatio } from './domestic.js';

// Each nation prices every commodity on its own. `selfSufficiency` is what the
// private economy supplies without you, so a market nobody has touched sits at a
// standing premium rather than racing to the ceiling — you are competing at the
// margin, not feeding a starving world. Sell into a country and you push THAT
// country's price down, nobody else's, which is the whole reason a second market
// is worth opening.
export function movePrices(state) {
  const { meanReversion, elasticity, floor, ceiling } = CONFIG.price;
  for (const country of COUNTRY_IDS) {
    for (const id of COMMODITY_IDS) {
      const def = COMMODITIES[id];
      const line = state.markets[country][id];
      const wanted = appetite(state, country, id);
      const supplied = wanted * CONFIG.selfSufficiency + line.soldLastTick + line.importedLastTick;
      const pressure = wanted > 0 ? (wanted - supplied) / wanted : 0;

      let next = line.price
        + (def.basePrice - line.price) * meanReversion
        + def.basePrice * elasticity * pressure;
      next = Math.min(def.basePrice * ceiling, Math.max(def.basePrice * floor, next));
      line.price = Math.round(next * 100) / 100;
    }
  }
}

// An economy answers to whether its people are supplied. Above the pivot a
// nation's demand compounds and it becomes a bigger market for everybody;
// below it the economy shrinks and takes its appetite with it.
//
// This is the only country figure that moves during a game, and it is the
// reason to keep goods at home rather than exporting every last unit: a nation
// you starve is a customer you are destroying.
export function growEconomies(state) {
  const { rate, pivot, floor, ceiling } = CONFIG.growth;
  for (const id of COUNTRY_IDS) {
    const country = state.countries[id];
    let weighted = 0;
    let weight = 0;
    for (const commodityId of COMMODITY_IDS) {
      const share = COMMODITIES[commodityId].demandShare;
      // Glutting one commodity cannot pay for starving another, so a surplus
      // counts only a little way past full satisfaction.
      weighted += share * Math.min(1.2, supplyRatio(state, id, commodityId));
      weight += share;
    }
    const supply = weight > 0 ? weighted / weight : 1;
    country.supply = supply;

    const base = COUNTRIES[id].demand;
    const next = country.demand * (1 + rate * (supply - pivot));
    country.demand = Math.min(base * ceiling, Math.max(base * floor, next));
  }
}

export function sampleHistory(state) {
  if (state.tick % CONFIG.historyEvery !== 0) return;
  const push = (arr, value) => {
    arr.push(value);
    if (arr.length > CONFIG.historyLength) arr.shift();
  };
  const home = state.countries[state.home];
  push(state.history.cash, home.cash);
  push(state.history.demand, Math.round(home.demand * 100) / 100);
  push(state.history.supply, Math.round(home.supply * 1000) / 1000);
  // Prices are per nation, so the chart follows your own market.
  const market = state.markets[state.home];
  if (market) for (const id of COMMODITY_IDS) push(state.history.prices[id], market[id].price);
}

// Insolvency and a starving population are the two ways a game goes wrong, and
// both are quiet until you look at the numbers. Only your own nation is worth
// interrupting you about.
export function reportHome(state) {
  const home = state.countries[state.home];
  const hungry = home.supply < CONFIG.growth.pivot;
  if (hungry && !state.warnedHungry) pushAlert(state, 'Your people are under-supplied — the economy is shrinking.', 'warn');
  if (!hungry && state.warnedHungry) pushAlert(state, 'Domestic demand is being met — the economy is growing.', 'good');
  state.warnedHungry = hungry;

  for (const owner of allOwners(state)) {
    owner.report.net = owner.report.tax + owner.report.domestic + owner.report.exports
      - owner.report.imports - owner.report.wages;
  }
}
