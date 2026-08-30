export const CONFIG = {
  tickMs: 1000,
  maxFrameMs: 250,
  maxCatchUpTicks: 5,
  demolishRefund: 0.5,
  historyEvery: 5,
  historyLength: 120,
  maxAlerts: 6,
  // How many of your own deals the Trade tab keeps. The world list below is
  // every deal on the planet and a busy world fills it in a tick or two, so
  // your own are kept in a list of their own rather than being crowded out of
  // it by forty-five other governments trading among themselves.
  maxOwnFlows: 60,
  // How long a message stays on screen before it clears itself. Alerts are
  // interruptions, not a log: the panel is meant to be empty most of the time,
  // so anything still on it is something that just happened.
  alertTtlMs: 9000,

  // What another government's proposal does if you say nothing.
  //
  // An unanswered offer is DECLINED, in real time, on the same wall clock the
  // alerts use — so the corner never silts up with decisions you have already
  // decided not to make. The bar across each card is this countdown, and it
  // holds while the pointer is over the inbox, because an offer that vanishes
  // as you reach for it is worse than one that lingers.
  offerTtlMs: 5000,
  // ...and once you have turned a technology down, that government does not
  // come back with it for this many ticks. Being asked the same question every
  // thirty ticks is the thing that makes an inbox worth ignoring.
  offerCooldown: 400,
  maxFlows: 40,

  // THE WORLD LOG behind the Notifications tab. Two hundred and fifty-eight
  // governments act constantly, so this is bounded twice over — see `noteEvent`.
  events: {
    // Ticks a line survives. Short on purpose: this is "what is going on right
    // now", not a history of the game, and a history of the game would not fit
    // in localStorage beside the markets.
    ttl: 50,
    // ...and a hard ceiling whatever the age, because the world acts in BURSTS:
    // every nation reviews its army on the same decision tick, so a single tick
    // can produce hundreds of lines and the sweep only runs once a tick.
    max: 400,
  },
  speeds: [1, 2, 4],
  // Tile sizes in px. The world is far wider than a screen, so zoom is a
  // first-class control rather than a nicety.
  // ...and the top of the range is set by the PROVINCES rather than by the
  // tiles: a province name has to fit on the land it names, so the map has to
  // be able to get big enough to read one.
  zoomLevels: [1, 2, 3, 5, 8, 14, 20, 28],
  // 2px a tile on a 1440-wide world is a hundred and sixty degrees of longitude
  // across a laptop screen: a world map you can read, one step out from the
  // whole planet and one step in from a single continent.
  defaultZoom: 1,
  // Weight of the current tick in a site's rolling 'working %'. Uptime has to
  // answer 'is this plant earning its wages lately', so it is an exponential
  // average rather than a lifetime one: a factory starved for fifty ticks and
  // then fed reads as working again within a few ticks.
  uptimeSmoothing: 0.12,
  price: { meanReversion: 0.02, elasticity: 0.025, floor: 0.35, ceiling: 1.9 },

  // Converts a nation's `demand` x a commodity's `demandShare` into units its
  // population wants per tick. The United States eats 120 food a tick and DR
  // Congo 2.2, so one food plant at 4/tick is most of a small nation's table
  // and a rounding error in a large one. This sets the scale of the whole
  // economy — raise it and every nation needs proportionally more industry.
  demandScale: 0.2,

  // How much of its own appetite a nation meets from the private economy you do
  // not run. Your state industry is built on TOP of this, which is why an
  // untouched market sits at a mild premium instead of starving outright.
  selfSufficiency: 0.45,

  // What a nation collects each tick from the private economy it does not run,
  // per point of `demand`. This is the tax base, and it is why `demand` is worth
  // growing for its own sake: supply your people, the economy compounds, and
  // the treasury compounds with it. It also means no nation can be permanently
  // killed — a government that closes every plant still collects taxes and can
  // start again.
  taxPerDemand: 130,

  // Share of warehouse stock lost to handling and carrying costs each tick.
  // Small, but it means goods nobody will buy do not pile up forever: a nation
  // that produces past what it can sell is quietly burning money, which is the
  // pressure that makes finding an export market matter.
  spoilage: 0.015,

  // The economy responds to whether its people are supplied. Above `pivot` a
  // nation's demand compounds, below it the economy contracts — and since
  // `demand` is what every price moves against, a shrinking nation is a
  // shrinking market for everybody who sells to it.
  growth: { rate: 0.003, pivot: 0.62, floor: 0.4, ceiling: 3.0 },

  // People, as opposed to money. A nation whose shops are full AND whose
  // treasury is comfortable does not merely buy more — it grows. Population is
  // deliberately far slower than demand and answers to both, so a boom shows up
  // in the market within twenty ticks and in the census within two hundred.
  population: {
    rate: 0.0008,
    // Supply a nation has to clear before its people increase at all...
    pivot: 0.78,
    // ...and the level it has to fall below before it loses any. The gap between
    // the two is the ordinary condition — fed, but not richly — and most of the
    // world sits in it, neither growing nor emptying.
    starve: 0.55,
    // ...and treasury, as a multiple of its own tax base per tick. Prosperity
    // is the second condition: a well-fed nation that cannot pay its bills is
    // not one people move to.
    wealth: 40,
    floor: 0.6,
    ceiling: 4.0,
  },

  trade: {
    // A deal is struck between the seller's local price and the buyer's. Half
    // and half: both sides gain, which is why trade happens at all.
    split: 0.5,
    // Freight for one unit hauled to the far side of the planet, as a share of
    // the commodity's base price. Nearby partners are nearly free; the antipodes
    // eat a fifth of the cargo's value.
    freight: 0.20,
    // Below this much price gap the haul is not worth arranging.
    minGain: 0.04,
    // Payroll a treasury keeps back rather than spending it on imports.
    reserveTicks: 10,
    // A nation will not buy more than this share of its unmet appetite in one
    // tick, so a single rich buyer cannot vacuum up a market instantly.
    maxFill: 0.6,
    // Ticks of factory consumption a nation keeps in stock when it buys inputs
    // abroad. A country with no coalfield can still run a steel mill, because
    // feedstock lands in its WAREHOUSES rather than being eaten by its
    // population — that is what makes the second import channel worth having.
    // Small on purpose: buying a hundred ticks of coal up front would let a
    // treasury corner a market in one go.
    inputBuffer: 6,
    // What a factory will pay OVER its own local price for feedstock it is
    // short of, at its hungriest. A population that cannot get coal simply goes
    // without; a plant that cannot get coal goes on paying wages while it sits
    // idle, so it is worth more to it than the shop price — and without that
    // premium a nation whose people are well supplied could never outbid a
    // hungrier country for its own factories' inputs, which is exactly how
    // three coal plants ended up sharing one plant's worth of coal.
    feedstockPremium: 0.6,
  },

  // Research. A government turns treasury into technology at a fixed exchange
  // rate, funded as a share of its tax base — so a big economy climbs the tree
  // faster than a small one for exactly the reason it should, and a small one's
  // realistic route to the top is to BUY a licence off somebody who got there
  // first (see `techTrade`).
  research: {
    // Share of the tax base a government puts into research each tick.
    share: 0.15,
    // The most a player may set the slider to. Past this a nation is spending
    // more on laboratories than it can possibly make back.
    maxShare: 0.5,
    // Treasury spent per research point. `TECHS[id].cost` is in points, so this
    // is what converts a tech's price into ticks of a nation's budget.
    costPerPoint: 3,
  },

  // Licensing technology. A nation that holds a tech will sell it to one that
  // does not, and the fee lands in its treasury — so being first up the tree is
  // worth money as well as industry.
  techTrade: {
    // What a licence costs against the research it saves the buyer. Above 1
    // because you are buying time, not knowledge.
    markup: 4,
    // A government will not sell to a nation it is not comfortably ahead of.
    every: 10,        // ticks between a government considering an offer to you
    maxPending: 2,    // tech offers on the table at once
    unsolicitedToPlayer: false,
    ttl: 90,          // ticks one stands before it lapses
  },

  // Supply CONTRACTS. The spot market clears whatever is left over each tick;
  // a contract is a promise made in advance, at a price fixed for its term, and
  // it is honoured BEFORE either side goes to market. Breaking one costs money.
  contracts: {
    minTerm: 5,
    maxTerm: 400,
    // What a defaulter pays the other side, as a share of the value it failed
    // to deliver or failed to take. Half: enough to hurt, not enough to make
    // one bad tick fatal.
    penalty: 0.5,
    // What certainty is worth. A contracted price sits this far above the spot
    // midpoint for the seller's benefit — the buyer is paying for a supply it
    // can plan around, and the seller is giving up the chance of a better day.
    premium: 0.06,
    every: 8,         // ticks between the world considering new contracts
    // How many governments go looking on one of those ticks. One was too few to
    // see: the world wrote its first contract several hundred ticks in.
    seekersPerTick: 5,
    maxOffers: 4,     // contract offers on the table at once
    ttl: 60,          // ticks one stands before it lapses
  },

  // THE GLOBAL EXCHANGE.
  //
  // Every nation on earth can deal with every other, so the question is not who
  // you are allowed to talk to but how you find them. A government with a
  // surplus posts an ASK; one with a shortage posts a BID; the exchange pairs
  // them and the pair becomes a contract. Nothing moves except under a contract.
  exchange: {
    // Ticks between governments reviewing what they have posted. Matching runs
    // every tick — it is cheap, and a listing nobody matches is a nation with a
    // full warehouse and no buyer.
    post: 3,
    // Ticks a listing stands before it is withdrawn.
    ttl: 40,
    // Open listings one nation will keep at once, and how many the book holds
    // in total. Both are there to keep the panel readable and the save small.
    // Asks and bids get SEPARATE allowances. One shared cap let a nation short
    // of a few things fill its whole allowance with bids and never offer its own
    // surplus again — the world filled up with coal nobody was selling.
    asksPerNation: 4,
    bidsPerNation: 4,
    asksPerRound: 2,
    bidsPerRound: 2,
    maxListings: 320,
    // The house cut, charged to BOTH sides of every settlement that came off the
    // book. Small on purpose: it is a clearing fee, not a tax, and its whole
    // purpose is to build the fund that nations borrow from below.
    fee: 0.015,
    // How long a matched listing runs as a contract, and how often it delivers.
    term: 200,
    every: 1,
    // A standing contract stops counting as cover this many ticks before it ends,
    // so its replacement is arranged before the supply actually stops.
    renewWithin: 20,
    // A bid will not cross an ask more than this far above it. Without a ceiling
    // a desperate buyer signs a hundred-tick contract at a shortage price and
    // spends the rest of the game paying it.
    maxCross: 1.6,

    // Lending. The clearing fund is real money and it does something: a nation
    // that cannot make payroll can borrow against it rather than closing its
    // industry, and pays it back out of its tax base with interest.
    loan: {
      // The most one nation may owe, as a multiple of its tax base per tick.
      maxDebt: 120,
      // ...and the most the fund will lend out at once, as a share of itself.
      maxShare: 0.5,
      // Charged per tick on the outstanding balance, and paid into the fund.
      interest: 0.004,
      // Share of the tax base a borrower puts toward the balance each tick.
      repay: 0.25,
      // A government asks for this many ticks of payroll when it asks at all.
      ticksOfPayroll: 30,
    },
  },

  // State industry. A nation builds from its treasury, which it fills by
  // selling to its own people and exporting the surplus. `stateBuildEvery` is
  // in ticks; keeping it well above 1 is what stops governments from carpeting
  // their own land.
  stateBuildEvery: 5,
  // ...and up to this many sites on one decision, so a government with a full
  // treasury actually spends it. One site every eight ticks left half the world
  // sitting on money it never turned into industry.
  stateBuildsPerDecision: 2,
  stateReserveTicks: 45,   // payroll it refuses to spend below
  // How much capacity a government will build for a commodity before it stops.
  // Its own people cap what it can sell at home (`homeShare` of their appetite);
  // the export market is worth a slice of what the whole world eats
  // (`worldShare`). Without this a resource-rich nation carpets its deposits and
  // then goes bankrupt paying wages on goods nobody will buy.
  stateCapacity: { homeShare: 1.0, worldShare: 0.05 },
  // BUILDING THE THING THAT UNBLOCKS THE THING.
  //
  // A plan whose feedstock a government can neither dig up nor buy used to be
  // discarded outright, so a nation with no coalfield never built the coal mine
  // that would have let it build a steel mill — and half the map stayed a pure
  // extraction economy for the whole game.
  //
  // `lookahead` is how much of a blocked plan's value carries back to the plant
  // that would unblock it. Well under 1 on purpose: the downstream plant is not
  // built, may never be built, and the government has to want the upstream one
  // for more than a promise. `reach` is how far out of reach a blocked plan may
  // be — as a multiple of what the treasury can spend today — and still be worth
  // planning around at all.
  stateChain: { lookahead: 0.6, reach: 3 },
  // Spare depot space, as a share of one warehouse, below which a government
  // builds another before it builds anything else.
  stateDepotHeadroom: 0.35,
  // ...and at most one depot per this many sites, whatever else is going on.
  stateSitesPerDepot: 6,
  // Clearing dead capital. A plant that has stood this long without working is
  // wages leaving the treasury every tick for nothing, so a government
  // demolishes it and takes the refund. `deadAfter` is generous on purpose — a
  // chain takes time to fill, and a plant judged before its feedstock arrives
  // would be torn down the tick before it started paying.
  stateSalvage: { deadAfter: 220, deadUptime: 0.02 },

  // DIPLOMACY. A relation is a thing two governments AGREE to — except one.
  //
  // Alliance, military access and peace are all REQUESTS: you put them, and the
  // other government answers on its own reading of who you are and where you
  // are. War is the exception, and it is the exception on purpose — nobody has
  // ever been asked permission to be invaded. It is DECLARED, unilaterally, and
  // then it WAITS: `warDelay` ticks of ultimatum in which the whole world can
  // see it coming, armies march and either side can still call it off.
  diplomacy: {
    // Ticks a proposal stands before it lapses unanswered, and how many one
    // government may have outstanding at once. Tick-based rather than the
    // wall-clock the inbox uses for contracts: a pact is not a thing you answer
    // in five seconds, and a paused game must not decide it for you.
    proposalTtl: 90,
    maxProposals: 3,
    // Ticks between the world reviewing its diplomacy, and how many governments
    // consider putting a proposal on one of those ticks. Both deliberately slow:
    // an inbox that fills with pacts is an inbox you stop reading.
    every: 12,
    seekersPerTick: 3,
    // How much a government has to WANT a relation before it says yes. Appetite
    // is distance, relative power and how the two already stand — see
    // `relationAppetite` — plus a small deterministic jitter, so the same
    // proposal put again in fifty ticks is not guaranteed the same answer.
    accept: 0.55,
    jitter: 0.18,
    // ...and how long before the same pair may be asked the same thing again.
    cooldown: 150,
    // Whether the world ever puts a pact to YOU unasked. It does — an inbox
    // that only ever carries contracts makes diplomacy feel like a menu rather
    // than a world.
    unsolicitedToPlayer: true,

    // WAR IS NOT A REQUEST.
    //
    // A declaration is unilateral and immediate; the FIGHTING is not. For this
    // many ticks the two are merely on notice — the alliance between them (if
    // any) is broken the moment it is declared, but no shot is fired, no border
    // is open, and either side may still call it off. It is the single most
    // consequential thing a government can do, so it is the one thing the game
    // gives you time to think about and your enemy time to prepare for.
    warDelay: 50,
    // ...and how long BEFORE the fighting a government starts raising its army.
    // The whole point of a declared war having a delay is that both sides can
    // SEE it coming, so they had better use it: mobilising only once the
    // shooting started meant an army arrived a hundred ticks after it was
    // needed. This is ticks remaining on the ultimatum, not ticks elapsed.
    mobiliseAt: 20,
    // The defender's allies are dragged in when the fighting starts, and they
    // are dragged in the same way as everybody else: their own declaration,
    // their own hundred ticks. There is no back door round the delay.
    alliesJoin: true,
    // Ticks after a war ends before those two may fight again. Peace has to be
    // worth something.
    peaceCooldown: 120,
    // The world may start wars without you, but only rarely: appetite has to
    // clear a high bar, one declaration at most can come out of a review, and
    // the whole planet then gets a quiet stretch before another countdown.
    warAppetite: 0.82,
    warsPerReview: 1,
    warQuiet: 240,
    opinion: {
      signed: 4,
      completed: 6,
      defaulted: -14,
      war: -55,
      attacker: -22,
      friendAttack: -18,
      friendThreshold: 18,
      decay: 0.985,
      deadband: 0.25,
    },
  },

  // WHAT A WAR ACTUALLY DOES. Restrained on purpose: an army in this game is a
  // running supply bill that can take ground and wreck industry, not a
  // tactical wargame. Everything here is per tick and applies to BOTH sides
  // identically — `runMilitary` never reads a country name.
  war: {
    // What a formation takes off an enemy formation within its own `range` each
    // tick, as a share of the attacker's strength. Two evenly matched
    // formations grind each other down over roughly a dozen ticks, which is
    // slow enough to reinforce or withdraw and fast enough to matter.
    damage: 0.09,
    // A formation this far below its full strength has stopped being a
    // formation and is destroyed outright.
    //
    // This is not decoration, it is what makes a battle END. Damage is a share
    // of the attacker's own strength, so two formations shooting at each other
    // decay geometrically and NEVER reach zero — they would sit at a hundredth
    // of a point of strength for ever, both still on the map, both still eating.
    // A break point turns that asymptote into an outcome.
    breakAt: 0.15,
    // Ticks between a formation standing on (or beside) an enemy SITE wrecking
    // it. A war costs the loser its industry, which is the only reason a
    // government would ever sue for peace.
    raidEvery: 14,
    // Ticks between a LAND formation standing on enemy soil TAKING the ground it
    // stands on. Only the tile under it, and only land units — an aircraft
    // overflies everything and holds nothing, which is the whole reason a nation
    // still needs infantry. Slower than the raid cadence on purpose: wrecking a
    // factory is a raid, taking a country is a campaign.
    conquerEvery: 10,
    // Ticks a march may go without getting any CLOSER before it is abandoned.
    // The step rule walks round obstacles, which is what carries a column
    // along a coastline — and is also what lets one circle an unreachable
    // target for ever. An island is the ordinary case.
    giveUpAfter: 90,
  },

  // THE WORLD'S ARMIES. Governments raise formations out of their own
  // warehouses exactly as you do — `createMilitaryUnit`, same costs, same
  // refusal when the depot is empty. What this decides is only how many one
  // wants and where it sends them.
  stateArmyEvery: 15,
  army: {
    // Formations a government keeps per point of `demand`, floored and capped
    // so neither a microstate nor the United States ends up absurd.
    perDemand: 0.2,
    min: 1,
    max: 14,
    // ...multiplied when it has a reason. A nation at war wants an army; one
    // with a cell on its soil wants enough to go and clear it.
    warFactor: 2.5,
    // ...and a cell on its soil is answered by STRENGTH, not by a percentage:
    // this multiple of the cell's own strength is what the host wants standing
    // before it is done raising. A factor was useless here — a small nation's
    // target is one formation, and one and a half rounds back to one.
    terrorMargin: 1.4,
    // How much MORE than the batch a government wants standing in its depots
    // before it spends one on a formation. A unit costs nothing to keep, so
    // this is the only brake there is — without it a nation converts every
    // scrap of surplus into soldiers on the tick it appears and never has
    // anything left to sell.
    costHeadroom: 2,
    // How far around an objective a government spreads its formations. Two
    // units given the same tile walk the same line and arrive as a stack; each
    // taking its own corner sends them down their own roads and puts each on
    // its own ground, which matters because a unit takes only the tile it
    // stands on. Small: they are still converging on one objective.
    spread: 2,
    // WHAT A GOVERNMENT PAYS TO BUY IN WHAT IT HAS NOT GOT, as a multiple of
    // the commodity's price. This applies to EVERY government including yours.
    //
    // A formation is still made of goods, and taking them out of your own
    // warehouses is still much the cheapest way to raise one. But a treasury
    // with no steel in it is not a treasury that cannot field an army: it makes
    // up the shortfall in money, at a markup, and the markup is the whole
    // point — it is dearer than producing the stuff, so building the industry
    // remains the better answer wherever you can manage it.
    //
    // It is NOT a purchase from anybody. No contract is written, no border is
    // crossed and no other nation's warehouse is touched — see the note in
    // `military.js`. It is the government paying its own economy to procure.
    cashMarkup: 2.5,
  },

  // TERRORISM is deliberately one pressure point, not world chaos. There is
  // never more than one active presence, and everything below is tuned so that
  // it is a problem you go and deal with rather than a fire that spreads while
  // you are reading a market.
  terrorism: {
    // Ticks between one presence being destroyed and the next appearing, and
    // the tick the first one may appear on at all.
    cooldown: 600,
    firstAt: 600,
    // ...and how long BEFORE a spawn the world is told about it. The ground is
    // chosen at this point and stands, so the red card can name the country and
    // count the ticks down. A cell you cannot see coming is an ambush; one you
    // can is a problem you get to move an army toward first.
    warnBefore: 100,
    // A cell is INFANTRY and a few armoured cars, and NOTHING ELSE — it cannot
    // build, cannot trade, and cannot field a tank, an aircraft or a gun, and it
    // never grows past this. `carsPer` is one armoured car per this many
    // riflemen, which is what keeps "fewer cars than men" true at any size.
    startInfantry: 3,
    carsPer: 3,
    // It does not sit still. Every `moveEvery` ticks it takes one step of up to
    // `moveTiles` toward the nearest site of its host nation, and when it
    // reaches one it destroys it and picks the next nearest. That cadence is
    // the whole reason it reads as SLOW: a camp on the far side of a large
    // country takes a long time to arrive, which is what makes moving your own
    // army to intercept it worth doing.
    moveEvery: 50,
    moveTiles: 2,
    // What defeating it pays the government whose soldiers did it — real money,
    // landed straight in the treasury, for the same reason the clearing fund's
    // fee is real: a reward with no substance behind it teaches a player nothing.
    bounty: 60_000,
  },

  seed: 20260826,
};
