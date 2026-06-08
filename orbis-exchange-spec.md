# Orbis Exchange

A single living world. One global market. AI and humans competing on the same ledger.

H0: Hack the Zero Stack with Vercel v0 and AWS Databases. Track 3, Million-scale Global App. Submission deadline June 29, 2026, 5:00pm PDT.

Hero database: Amazon Aurora DSQL. Frontend: Next.js scaffolded with v0, deployed on Vercel.

---

## 1. Executive summary

Orbis Exchange is a persistent, single-world economic simulation game. The world is a grid of resource cells whose abundance grows and collapses by deterministic cellular-automaton rules in the spirit of Conway's Game of Life. Players, both human and AI, claim cells, extract raw resources, refine them, and trade refined commodities through a single global order-book market. Prices are not authored. They emerge from the scarcity the simulation produces. When the rules deplete a region, supply falls and prices rise, which pulls miners elsewhere and creates organic boom-and-bust cycles.

The competitive hook is AI versus human on one substrate. Autonomous agents run trading and mining strategies against the exact same order book and the exact same database rows as people. They also provide liquidity, so the world feels alive even with a handful of live users, which solves the hardest demo problem in this track. A single leaderboard ranks everyone by net worth. The question that sells the game in four minutes is simple: can you out-trade the machine.

The whole thing is built to make the database the hero. Every trade is a short, strongly-consistent transaction against Aurora DSQL. No double-spend, no oversell, no overnight reconciliation. Because DSQL is active-active and strongly consistent across regions, a trade placed in Frankfurt is immediately visible in Virginia with no application-level coordination, which is the literal definition of the million-scale global story this track asks for.

This document is the build contract. It locks the concept, mechanics, data model, architecture, cost guardrails, and a week-by-week plan to ship a real, deployed product by the deadline.

---

## 2. Hackathon alignment

### 2.1 Requirements mapping

| Requirement | How this entry satisfies it |
|-------------|-----------------------------|
| Use one of Aurora PostgreSQL, Aurora DSQL, or DynamoDB | Aurora DSQL is the single source of truth for world state, balances, orders, and trades |
| Deploy front end on Vercel or v0.app | Next.js App Router scaffolded in v0, deployed to Vercel |
| Full-stack application within a track | Track 3, a gaming app with an architecture designed to scale to millions globally |
| 3 to 5 minute demo video | Problem, audience, working-app footage, and an explicit DSQL walkthrough |
| Published Vercel project link and Team ID | Provided at submission |
| Architecture diagram | Section 5.1 is the diagram source of truth |
| Storage configuration screenshots proving AWS database usage | DSQL cluster and connection config captured at submission |
| Optional bonus content | A build write-up published with the hashtag, see section 14 |

### 2.2 Judging-criteria mapping

| Criterion | The argument this entry makes |
|-----------|-------------------------------|
| Technological implementation | A deliberate relational data model, a strongly-consistent matching engine, a cellular-automaton tick engine, and an active-active multi-region deployment. The database is integrated with intent, not as a passive store |
| Design | The world view and the market view are two halves of one screen. The front end is designed against the back end, so what you see evolving is the literal state of the ledger |
| Impact and real-world applicability | An emergent-economy sandbox is a genuine product. It is also a credible testbed for market-design study and for benchmarking autonomous trading agents against humans on identical infrastructure |
| Originality | A cellular-automaton resource ecology driving a single global market, with AI and humans competing on one consistent ledger, is a novel synthesis rather than a known app rebuilt |

---

## 3. Concept and core loop

The world is one shared map. The economy is one shared market. The core loop is short and legible.

1. Claim. A participant claims or leases a cell, acquiring the right to extract whatever resource that cell currently holds.
2. Extract. Each tick, owned cells yield raw resource proportional to current cell density. Over-extraction accelerates local depletion.
3. Refine. Raw resource is converted to a tradeable commodity, optionally improved by infrastructure the player has invested in.
4. Trade. The player posts buy and sell orders to the single global market. Orders match by price-time priority. Fills settle against balances and inventory in one transaction.
5. Invest. Profits are reinvested into extraction upgrades, additional claims, or holdings, which compounds advantage.
6. Climb. Net worth, defined as credits plus inventory valued at the last market price, ranks the participant against every human and every agent on one leaderboard.

The simulation runs underneath all of this on a fixed tick. The cellular-automaton rules redistribute resource density across the map every generation, so the optimal place to mine and the relative value of each commodity are always shifting.

---

## 4. Game mechanics

### 4.1 World model

The world is a grid of cells. For the demo the visible map is 64 by 64, partitioned into region shards for scale (section 12). Each cell has:

- A resource type drawn from a small set. Default set is four: Ore, Energy, Biomass, and Rare.
- A density value from 0 to 100 representing current abundance.
- An owner, either unclaimed or a reference to a participant.
- A last-updated generation marker for delta persistence.

### 4.2 Cellular-automaton resource rules

Density evolves by local rules applied every tick. A neighbor is healthy if its density is at or above a healthy threshold. The intent mirrors Conway: too few healthy neighbors causes withering, a balanced neighborhood causes regeneration and bloom, and overcrowding causes collapse. Extraction is a separate downward pressure layered on top.

```
HEALTHY_THRESHOLD = 40
REGEN_FLOOR       = 35
REGEN_RATE        = 0.20
BLOOM_RATE        = 4
WITHER_RATE       = 6
CROWD_RATE        = 8

for each cell c:
    n = count of healthy neighbors of c          # Moore neighborhood, 8 cells
    d = c.density
    next = d

    if d < REGEN_FLOOR and 2 <= n <= 3:           # regeneration / birth
        next = d + REGEN_RATE * average_neighbor_density(c)
    elif d >= HEALTHY_THRESHOLD and 2 <= n <= 5:  # stable bloom
        next = d + BLOOM_RATE
        if next >= 90:
            seed_lowest_adjacent(c)               # spread to a weak neighbor
    elif n < 2:                                   # isolation / underpopulation
        next = d - WITHER_RATE
    elif n > 5:                                   # overcrowding collapse
        next = d - CROWD_RATE

    next = next - extraction_pressure(c)          # mining draw this tick
    c.next_density = clamp(next, 0, 100)

# commit all next_density values simultaneously, then clear extraction_pressure
```

Two emergent behaviors fall out of this for free. Rich regions spread outward until they overcrowd and collapse, and heavily mined regions deplete and trigger local cascades. Both move scarcity around the map, which is what keeps the market interesting without any hand-authored supply curve.

### 4.3 The single global market

There is exactly one market. It holds one order book per commodity. Mechanics:

- Orders are limit orders with a side, a price in credits, and a quantity.
- Matching is price-time priority. The highest bid that crosses the lowest ask trades at the resting order's price.
- Settlement is atomic. A fill debits the buyer's credits, credits the seller, transfers inventory, updates or closes both orders, and records a trade, all in one transaction.
- The last trade price per commodity is the reference price used for net-worth valuation and for charting.

This is the component that justifies the database choice. The invariant that balances and inventory never go negative and that a unit is never sold twice is enforced by strong consistency, not by after-the-fact cleanup.

### 4.4 Investment mechanics

Buy and sell flows for assets, not just commodities, also clear through the same ledger.

- Claims. Unclaimed cells can be claimed for a credit cost. Owned cells can be listed for sale or lease and bought by others.
- Extraction infrastructure. Credits upgrade a player's extraction rate multiplier, increasing yield per tick at the cost of faster local depletion.
- Holdings. Commodities held in inventory are speculative positions, since their value floats with the market price the simulation drives.

### 4.5 AI versus human

Agents are first-class participants. They are rows in the same players table, they hold credits and inventory, and they place orders through the same path as humans.

Default agent strategies, all algorithmic and therefore zero inference cost:

- Market maker. Quotes both sides around the reference price to provide liquidity.
- Momentum. Buys commodities whose price is rising, sells those falling.
- Value. Buys commodities trading below a rolling mean, sells above.
- Scout. Claims and mines cells in regions the cellular automaton is currently blooming.
- Arbitrage. Exploits transient price gaps between commodities or regions.

Agents serve two purposes. They make the market liquid and the world active during a demo with few live humans, and they are the opponent. An optional stretch is a Bedrock-backed analyst agent that narrates its reasoning for flavor, kept off the critical path for cost control.

### 4.6 Optional civic layer (stretch)

A light governance mechanic lets participants vote on world rules such as an extraction cap, a transaction tax, or a regeneration boost. Votes are tallied on the ledger and applied at the next generation. This is a stretch feature, framed as nonpartisan world stewardship, and is cut first if the schedule slips.

---

## 5. System architecture

### 5.1 Components and data flow

```
                    +-------------------------+
                    |   Browser (Next.js UI)  |
                    |  world view + market    |
                    +-----------+-------------+
                                |  HTTPS / SSE
                                v
        +-----------------------------------------------+
        |        Vercel (Next.js App Router)            |
        |  - Edge reads: world snapshot, order book     |
        |  - Route handlers: place/cancel order, claim  |
        |  - SSE endpoint: tick + fill + price stream   |
        +-----------------------+-----------------------+
                                |  SQL (pg wire protocol)
                                v
                    +-------------------------+
                    |     Amazon Aurora DSQL  |
                    |  canonical world + ledger|
                    |  strong consistency      |
                    +-----------+-------------+
                                ^
                                |  SQL writes (deltas, settlement)
        +-----------------------+-----------------------+
        |   Simulation worker (scheduled, off-Vercel)   |
        |  - loads latest snapshot into memory          |
        |  - runs CA tick + extraction                  |
        |  - runs matching engine settlement            |
        |  - persists deltas + market state             |
        +-----------------------+-----------------------+
                                ^
                                |  places orders via DB/API
                    +-----------+-------------+
                    |    AI agent worker      |
                    |  algorithmic strategies |
                    |  (optional Bedrock LLM)  |
                    +-------------------------+
```

### 5.2 The tick

The tick is the heartbeat. Default interval is 3 seconds. Each tick the simulation worker:

1. Reads the latest world snapshot and open orders from DSQL.
2. Applies the cellular-automaton rules in memory to compute next densities.
3. Applies accumulated extraction pressure from owned cells.
4. Runs the matching engine and settles all crossing orders in short transactions.
5. Persists only changed cells as deltas, a new market state row per commodity, and trade records.

The simulation runs in memory and persists deltas. The full grid is never written cell by cell every tick. This is the single most important cost and performance decision in the build (section 11).

### 5.3 Real-time updates

Vercel functions do not hold long-lived sockets well, so the client receives updates over Server-Sent Events from a streaming route handler that publishes tick completions, the viewer's own fills, and price changes. A short-poll fallback every 2 seconds covers any client where SSE drops. The world view reads a cached snapshot with a short time-to-live and applies deltas on top.

### 5.4 Multi-region

For the headline scale story, the DSQL cluster is configured multi-region active-active and Vercel serves from the edge nearest the user. Because DSQL keeps regions strongly consistent, the application stack does not coordinate across regions at all. It simply connects to its nearest regional endpoint. Development runs single-region for cost, and the multi-region cluster is stood up for the demo footage and the architecture screenshots.

---

## 6. Data model

Aurora DSQL is PostgreSQL-compatible. The schema is designed to DSQL operating characteristics: referential integrity is enforced in application logic rather than with foreign-key constraints, transactions are kept short and well within the transaction time limit, secondary indexes are created asynchronously, and write paths are designed for optimistic concurrency with a bounded retry on conflict.

```sql
-- Participants, human and agent alike
CREATE TABLE players (
    id           UUID PRIMARY KEY,
    handle       TEXT NOT NULL,
    kind         TEXT NOT NULL,          -- 'human' | 'agent'
    credits      BIGINT NOT NULL,        -- integer credits, no floats for money
    home_region  TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL
);

-- World cells; demo grid plus region shard key
CREATE TABLE cells (
    id            BIGINT PRIMARY KEY,    -- encodes region + x + y
    region        TEXT NOT NULL,
    x             INT NOT NULL,
    y             INT NOT NULL,
    resource_type TEXT NOT NULL,         -- 'ore'|'energy'|'biomass'|'rare'
    density       SMALLINT NOT NULL,     -- 0..100
    owner_id      UUID,                  -- nullable, app-enforced reference
    updated_gen   BIGINT NOT NULL
);
CREATE INDEX cells_by_region ON cells (region);
CREATE INDEX cells_by_owner  ON cells (owner_id);

-- Player holdings of refined commodities
CREATE TABLE inventory (
    player_id   UUID NOT NULL,
    commodity   TEXT NOT NULL,
    qty         BIGINT NOT NULL,
    PRIMARY KEY (player_id, commodity)
);

-- Open and historical orders
CREATE TABLE orders (
    id          UUID PRIMARY KEY,
    player_id   UUID NOT NULL,
    commodity   TEXT NOT NULL,
    side        TEXT NOT NULL,           -- 'buy' | 'sell'
    price       BIGINT NOT NULL,
    qty_open    BIGINT NOT NULL,
    status      TEXT NOT NULL,           -- 'open'|'filled'|'cancelled'
    created_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX orders_book ON orders (commodity, side, price);

-- Executed trades, the audit trail of the economy
CREATE TABLE trades (
    id            UUID PRIMARY KEY,
    commodity     TEXT NOT NULL,
    buy_order_id  UUID NOT NULL,
    sell_order_id UUID NOT NULL,
    price         BIGINT NOT NULL,
    qty           BIGINT NOT NULL,
    generation    BIGINT NOT NULL,
    executed_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX trades_by_commodity ON trades (commodity, executed_at);

-- Reference price and depth per commodity, refreshed each tick
CREATE TABLE market_state (
    commodity   TEXT PRIMARY KEY,
    last_price  BIGINT NOT NULL,
    best_bid    BIGINT,
    best_ask    BIGINT,
    generation  BIGINT NOT NULL
);

-- Simulation metadata
CREATE TABLE ticks (
    generation    BIGINT PRIMARY KEY,
    started_at    TIMESTAMPTZ NOT NULL,
    completed_at  TIMESTAMPTZ,
    cells_changed INT
);

-- Agent configuration
CREATE TABLE agents (
    player_id  UUID PRIMARY KEY,
    strategy   TEXT NOT NULL,            -- 'maker'|'momentum'|'value'|'scout'|'arb'
    params     JSONB NOT NULL
);
```

### 6.1 Settlement transaction

The matching engine settles each crossing pair as a short, strongly-consistent transaction. This is the centerpiece of the technical story.

```
match(buy, sell):                       # buy.price >= sell.price
    qty   = min(buy.qty_open, sell.qty_open)
    price = sell.price                  # resting order sets the price
    cost  = qty * price

    BEGIN
      assert buyer.credits >= cost                 # re-check inside txn
      assert seller_inventory(sell.commodity) >= qty
      UPDATE players SET credits = credits - cost  WHERE id = buy.player_id
      UPDATE players SET credits = credits + cost  WHERE id = sell.player_id
      UPSERT inventory(+qty) for buyer
      UPDATE inventory(-qty) for seller
      UPDATE orders SET qty_open = qty_open - qty, status = ... for both
      INSERT trade row
    COMMIT                              # retry once on OCC conflict
```

Strong consistency is what makes the asserts trustworthy. Two concurrent fills cannot both spend the same credits or sell the same unit, and there is no reconciliation pass to clean up afterward.

---

## 7. Database rationale

Aurora DSQL is the hero database for four reasons that line up with this panel.

1. The single global market with strict balance and inventory invariants is the canonical use case AWS markets DSQL for. Leading with it speaks the judges' language directly.
2. Strong consistency lets the matching engine assert and act in one transaction with no reconciliation, which is a clean and defensible technical narrative.
3. Active-active multi-region with no application-level coordination is the most credible way to claim global million-scale in a track that scores architecture rather than a literal user count.
4. Serverless scale-to-zero keeps cost near zero during development and through the judging window.

The documented alternative is DynamoDB. If sustained write volume from the tick or the order flow ever became the dominant constraint, the world grid and order book could move to a single-table DynamoDB design with transactional writes for settlement. The tradeoff is giving up SQL ergonomics and the single strongly-consistent SQL narrative. For a hackathon judged on a deliberate data model and a global-scale story, DSQL is the stronger choice, so DynamoDB stays documented but unused unless a measured bottleneck forces the switch.

---

## 8. Tech stack and deployment

| Layer | Choice |
|-------|--------|
| Frontend | Next.js App Router, scaffolded in v0, TypeScript |
| Hosting | Vercel, Pro plan for the judging window |
| Database | Amazon Aurora DSQL, PostgreSQL wire protocol |
| DB driver | node-postgres with the DSQL auth token flow |
| Simulation worker | Scheduled compute off Vercel: EventBridge Scheduler invoking a Lambda, or a small Fargate task running the tick loop |
| Agent worker | Same runtime as the simulation worker, algorithmic strategies by default |
| Optional LLM | Amazon Bedrock for an analyst agent, credit-eligible, off the critical path |
| Realtime | Server-Sent Events with a short-poll fallback |
| Auth | Minimal: handle plus signed session token, or email magic link |

---

## 9. API surface

Next.js route handlers. Reads favor the edge with short caching, writes go to DSQL.

| Method and path | Purpose |
|-----------------|---------|
| GET /api/world?region=&since= | World snapshot, or deltas since a generation |
| GET /api/market/:commodity | Order book depth, last price, recent trades |
| POST /api/orders | Place a buy or sell limit order |
| DELETE /api/orders/:id | Cancel an open order |
| POST /api/claims | Claim or buy a cell |
| POST /api/claims/:id/list | List an owned cell for sale or lease |
| POST /api/invest | Upgrade extraction infrastructure |
| GET /api/leaderboard | Net-worth ranking across humans and agents |
| GET /api/stream | SSE stream of ticks, fills, and price updates |

---

## 10. Frontend and UX

The screen is one world, two panels, so the front end visibly is the back end.

- World view. The grid, colored by resource type and shaded by density, animating each tick. Owned cells are outlined. This is the hypnotic, demo-critical visual.
- Market panel. A price chart per commodity, the live order book, and a one-click buy and sell control. Fills animate in as they settle.
- Leaderboard. Net worth across all participants, with agents clearly tagged, so the AI-versus-human framing is always on screen.
- Player dashboard. Credits, inventory, owned cells, and extraction infrastructure.

Design intent for the Best Design criterion: a single cohesive layout where the evolving map on the left and the moving market on the right are obviously the same system seen two ways.

---

## 11. Cost model and guardrails

The stack is serverless and scales to zero, so the expected out-of-pocket is near zero with the AWS and v0 credits the hackathon provides, and the idle judging period is effectively free.

| Item | Cost posture |
|------|--------------|
| Aurora DSQL | Free tier covers single-region development; trivial beyond it; multi-region only for the demo |
| Vercel | Pro for the judging window, roughly one month, likely covered by v0 credits |
| Simulation and agent workers | Light scheduled compute, within free or near-free tiers |
| AI agents | Algorithmic by default, zero inference cost; Bedrock only for the optional analyst |

Mandatory guardrails, set on day one:

- Run the simulation in memory and persist deltas plus a per-commodity market state row. Never write the full grid cell by cell every tick.
- Keep the demo grid bounded and tick no faster than every 3 seconds. The million-scale claim lives in the architecture diagram, not in a runaway tick.
- Set an AWS Budgets alert at a low threshold so a runaway loop pages rather than bills.
- Enable Vercel Spend Management with an auto-pause threshold as a hard ceiling.
- Develop single-region. Provision the multi-region cluster only to capture the demo and screenshots.

---

## 12. Scaling design

The Track 3 argument, stated for the architecture diagram and the video.

- World sharding. The map partitions into region shards, each driven by its own simulation worker, so tick work scales horizontally.
- Market sharding. The order book partitions by commodity, so matching scales per commodity independently.
- Database scaling. DSQL scales compute and storage automatically with no sharding or instance management, and replicates across availability zones for durability.
- Read scaling. The read-heavy world view is served from edge cache with a short time-to-live and reconciled with deltas, keeping read pressure off the write path.
- Global reach. Multi-region active-active means a player connects to the nearest regional endpoint and still sees a single consistent world, with no cross-region coordination in the application.

---

## 13. Build plan to June 29

About three and a half weeks. Thin game, thick market. Cut from the bottom of the stretch list if behind.

| Phase | Target date | Deliverable |
|-------|-------------|-------------|
| 0 Foundations | by June 9 | DSQL cluster provisioned, schema applied, credits requested, Next.js scaffolded in v0, hello-world deployed to Vercel, budgets and spend caps on |
| 1 Living world | by June 13 | Cellular-automaton tick engine in memory with delta persistence, world view rendering and animating, one resource type end to end |
| 2 The market | by June 20 | Matching engine with the strongly-consistent settlement transaction, order placement and cancel, balances and inventory, market panel, leaderboard |
| 3 Competition and polish | by June 27 | Algorithmic AI agents for liquidity and competition, claims and mining and investment loop, SSE realtime, all four commodities, multi-region cluster stood up and tested briefly, UI polish |
| 4 Ship | June 27 to 29 | Demo video, architecture diagram, storage screenshots, submission, optional blog post; final day is buffer |

---

## 14. Demo and submission plan

Submission checklist, drawn from the hackathon requirements:

- Text description that names Amazon Aurora DSQL as the database.
- A 3 to 5 minute video that states the problem and audience, shows the working app with the world evolving and trades settling, and walks through how DSQL is used and why strong consistency matters.
- The published Vercel project link and the Vercel Team ID.
- The architecture diagram from section 5.1, rendered cleanly.
- Screenshots of the storage configuration proving Aurora DSQL usage.
- Optional bonus content: a build write-up on how the single-market ledger was implemented on DSQL, published publicly with the event hashtag and the required attribution language.

Demo narrative arc: open on the living world, introduce the single global market, place a trade and show it settle instantly, reveal that several of the active traders are AI, then zoom out to the leaderboard and pose the out-trade-the-machine question. Close on the multi-region diagram and the consistency claim.

---

## 15. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Economy scope creep | Thin game, thick market. One commodity working end to end before adding the rest. Investment and civic layers are cut first |
| Tick cost or latency blowup | In-memory simulation, delta persistence, bounded grid, 3-second tick, budgets and spend caps |
| DSQL operating constraints | App-enforced integrity instead of foreign keys, short transactions, asynchronous index creation, optimistic-concurrency retry |
| No realtime sockets on Vercel | Server-Sent Events with a short-poll fallback |
| Empty world in the demo | AI agents seed liquidity and continuous activity from the first second |
| Multi-region complexity | Single-region by default; DSQL makes multi-region application-transparent, so it is a configuration step for the demo, not a rebuild |

---

## 16. Stretch goals

- Civic governance votes on world rules, framed as nonpartisan stewardship.
- Bedrock analyst agents that narrate strategy for personality.
- Resource futures or simple derivatives on top of the spot market.
- A world replay and timelapse for the demo.
- A mobile-friendly layout.

---

## 17. Open decisions and assumptions

Defaults are chosen so the build can start immediately. Each is adjustable.

- Commodities: 4 (Ore, Energy, Biomass, Rare).
- Demo grid: 64 by 64 visible, region-sharded for the scale story.
- Tick interval: 3 seconds.
- Money type: integer credits, no floating point.
- Starting balance: a fixed credit grant per new participant, tuned during phase 2.
- Auth: minimal handle plus session token for the demo, magic link if time allows.
- Worker runtime: Lambda on a schedule first, Fargate only if the tick outgrows the Lambda window.
