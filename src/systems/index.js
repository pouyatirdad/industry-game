import { collect, distribute, spoil } from './logistics.js';
import { produce } from './production.js';
import { payWages } from './economy.js';
import { sellDomestic } from './domestic.js';
import { runTrade } from './trade.js';
import { movePrices, growEconomies, sampleHistory, reportHome } from './market.js';
import { runStateIndustry } from './stateIndustry.js';
import { runDiplomacy } from './diplomacy.js';
import { openLedger } from './ledger.js';

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
// domestic before trade    -> a nation feeds its own people before it feeds
//                            anyone else's, and only the surplus is offered
//                            abroad. Reverse these two and exporting would
//                            starve your own population for a better price.
// prices and growth after both -> a market is repriced on the full tick's
//                            supply, home sales and imports alike, and the
//                            economy grows or shrinks on that same figure.
// carry after trade      -> a warehouse is charged for what it still holds
//                            once everyone who wanted it has had their chance.
// state industry LAST      -> a government decides on settled numbers: this
//                            tick's prices and its treasury after trade has
//                            cleared. Its new site then waits a tick before
//                            producing, exactly as yours does. Diplomacy sits
//                            beside it: an offer is a government's decision
//                            too, taken on the same settled numbers.
export const PIPELINE = [
  ['ledger', openLedger],
  ['collect', collect],
  ['produce', produce],
  ['distribute', distribute],
  ['wages', payWages],
  ['domestic', sellDomestic],
  ['trade', runTrade],
  ['carry', spoil],
  ['prices', movePrices],
  ['growth', growEconomies],
  ['report', reportHome],
  ['history', sampleHistory],
  ['state', runStateIndustry],
  ['diplomacy', runDiplomacy],
];

export function runTick(state) {
  state.tick++;
  for (const [, system] of PIPELINE) system(state);
  return state;
}
