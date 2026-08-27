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

    // People move first, because how many of them there are is what the market
    // below is bounded against.
    growPopulation(state, country, supply);

    // A bigger population widens the BAND demand may move in, rather than
    // pushing demand up directly. Supply still decides where inside that band a
    // nation actually sits — so a country can populate and still shrink if it
    // cannot feed anybody, which is the honest outcome.
    const heads = country.pop / COUNTRIES[id].pop;
    const base = COUNTRIES[id].demand * heads;
    const next = country.demand * (1 + rate * (supply - pivot));
    country.demand = Math.min(base * ceiling, Math.max(base * floor, next));
  }
}

// People, as opposed to money.
//
// Demand answers to supply alone and moves within twenty ticks. Population is
// the slower thing underneath it and needs BOTH conditions: shops that are
// actually full, and a treasury that is comfortably ahead of its own bills. A
// well-fed nation that cannot pay for anything is not one people move to.
//
// It matters because it feeds back: every extra head lifts the floor under
// `demand`, so a nation that gets rich and stays supplied compounds twice — a
// bigger market, and then a bigger market again. That is what makes prosperity
// worth chasing past the point where your own people are simply fed.
function growPopulation(state, country, supply) {
  const { rate, pivot, starve, wealth, floor, ceiling } = CONFIG.population;
  const base = COUNTRIES[country.id].pop;
  if (!country.pop) country.pop = base;

  // Wealth is measured against the nation's own tax base, so it means the same
  // thing to DR Congo as it does to the United States.
  const rich = country.report.tax > 0 && country.cash >= country.report.tax * wealth;

  // Three bands, not two, and the middle one is where most of the world lives.
  // A nation only gains people if its shops are genuinely full AND it is
  // comfortably solvent; it only loses them if it is actually starving. Making
  // the grow and shrink thresholds the same figure quietly emptied the planet,
  // because the ordinary condition — fed, but not richly — fell on the wrong
  // side of it.
  const direction = supply >= pivot && rich ? 1 : supply < starve ? -1 : 0;
  if (direction === 0) return;

  const next = country.pop * (1 + rate * direction);
  country.pop = Math.min(base * ceiling, Math.max(base * floor, next));
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
    // Everything that moved the treasury this tick, in and out. Contracts and
    // research are separate lines rather than folded into trade and wages,
    // because both are policies you chose rather than things the market did to
    // you — and a net that hid them would be unreadable the moment either bit.
    owner.report.net = owner.report.tax + owner.report.domestic + owner.report.exports
      + (owner.report.penalties ?? 0)
      - owner.report.imports - owner.report.wages - (owner.report.research ?? 0)
      - (owner.report.fees ?? 0) - (owner.report.interest ?? 0) - (owner.report.repaid ?? 0);
  }
}
