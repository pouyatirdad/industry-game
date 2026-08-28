import { collect, distribute, spoil } from './logistics.js';
import { produce } from './production.js';
import { payWages } from './economy.js';
import { sellDomestic } from './domestic.js';
import { movePrices, growEconomies, sampleHistory, reportHome } from './market.js';
import { runStateIndustry } from './stateIndustry.js';
import { runContracts, runContractDiplomacy } from './contracts.js';
import { runExchange, runLending } from './exchange.js';
import { runResearch, runTechTrade } from './research.js';
import { openLedger } from './ledger.js';
import { runMilitary } from './military.js';

// Tick phase order is a GAME DESIGN decision, not an implementation detail.
//
// ledger FIRST            -> the commodity ledger is folded and zeroed before
//                            anything writes into it, so `ledger.tick` still
//                            holds the finished tick when the panels render.
// collect before produce  -> a site's throughput never depends on where it sits
//                            in the buildings array (determinism).
// distribute after produce -> goods take a tick to travel, so you can watch a
//                            chain fill up stage by stage.
// wages before market      -> you must be solvent to run, not merely to profit.
// contracts before domestic -> a contract is a PROMISE. The cargo leaves the
//                            country before the shopkeeper opens, which is what
//                            gives one teeth: over-commit your own supply and
//                            you really will starve your own people for it.
//                            Whatever survives every contract is what the home
//                            market and then the spot market get to work with.
// distribute after contracts -> and BEFORE domestic. A factory draws its inputs
//                            out of the depot before the counter opens, because
//                            otherwise a nation's own population outbids its own
//                            industry for free: an imported cargo of coal landed
//                            in the warehouse and was sold over the counter the
//                            same tick, every tick, and the steel mill it was
//                            bought for never saw a lump of it.
// domestic after contracts -> a nation feeds its own people out of whatever its
//                            promises and its own factories left behind. There
//                            is no spot market after it: a contract is the ONLY
//                            way goods cross a border, and the exchange at the
//                            bottom of the tick is how one gets written.
// prices and growth after both -> a market is repriced on the full tick's
//                            supply, and the economy grows or shrinks on that
//                            same figure. Population moves with it, far slower.
// carry after trade      -> a warehouse is charged for what it still holds
//                            once everyone who wanted it has had their chance.
// lending before report    -> interest and repayment move the treasury, so
//                            they have to be in before the net is struck.
// state industry LAST      -> a government decides on settled numbers: this
//                            tick's prices and its treasury after everything
//                            has cleared. Its new site then waits a tick before
//                            producing, exactly as yours does. The exchange
//                            sits beside it, because posting an ask is a
//                            government's decision taken on the same numbers —
//                            and a match written now first delivers next tick.
// research before report  -> a laboratory is paid for out of the same tick's
//                            treasury, so the net on screen is the whole net.
//                            It sits with the other decisions at the bottom
//                            because it is one: a government funds it on
//                            settled numbers, as it builds on settled numbers.
export const PIPELINE = [
  ['ledger', openLedger],
  ['collect', collect],
  ['produce', produce],
  ['wages', payWages],
  ['contracts', runContracts],
  ['distribute', distribute],
  ['domestic', sellDomestic],
  ['carry', spoil],
  ['prices', movePrices],
  ['growth', growEconomies],
  ['research', runResearch],
  ['lending', runLending],
  ['report', reportHome],
  ['history', sampleHistory],
  ['state', runStateIndustry],
  ['exchange', runExchange],
  ['licensing', runTechTrade],
  ['dealing', runContractDiplomacy],
  ['security', runMilitary],
];

export function runTick(state) {
  state.tick++;
  for (const [, system] of PIPELINE) system(state);
  return state;
}
