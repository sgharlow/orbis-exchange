# I stopped trying to prove "global scale" and let the database guarantee it instead

*Building Orbis Exchange for the H0 "Hack the Zero Stack" hackathon — Vercel + AWS Databases, hero database Amazon Aurora DSQL.*

**#H0Hackathon** · Built for Devpost's *H0: Hack the Zero Stack with Vercel and AWS Databases*.

---

Most "global app" demos prove scale the same way: a load-test, a graph that goes up and to the right, a number with a lot of zeros. I find those unconvincing — a throughput graph tells you the system was *fast once*, not that it's *correct under contention*. So when I started Orbis Exchange, I made a different bet: prove global scale with an **invariant** instead of a benchmark.

The invariant is the boring, terrifying one every transactional system lives or dies on:

> Balances never go negative. Inventory is never oversold. No reconciliation pass, ever.

If I could make that *true by construction* — and make it visible, on screen, with humans and bots hammering the same ledger — that would say more about a database than any RPS chart. The database that made it natural was **Amazon Aurora DSQL**: PostgreSQL-compatible, strongly consistent, active-active across regions.

## What I built

Orbis Exchange is a single living world with one global market.

- You **open the link and you're just in** — auto-joined as a guest, no login, no signup, no handle to pick (a signed per-browser cookie keeps you for ~30 days, and you can rename yourself to anything unique whenever you want).
- A **64×64 grid of resource cells** evolves every 3 seconds by Conway-style cellular-automaton rules. Regions bloom, spread, overcrowd, and collapse. Scarcity is *emergent* — nothing is hand-authored. The field renders as a single-hue density heatmap with a bloom glow, and you can light up one commodity at a time with reveal-layer chips.
- Every commodity has **one order book** with price-time priority. Each fill **settles as a single short, strongly-consistent transaction**: debit the buyer, credit the seller, move the inventory, close both orders, write the trade. As a human you trade as a *taker* — Buy at the best ask, Sell at the best bid, with the quantity auto-bounded to what's actually executable so an order always fills and never just sits there; the book itself is shown read-only, as the AI market-makers' liquidity.
- **Algorithmic agents are first-class players.** Maker, momentum, value, scout — they trade through the exact same order path a human does, at zero inference cost. They keep the market liquid and they're the opponent on one net-worth leaderboard.

The screen is one world, two panels: the map on the left and the order book on the right are visibly the *same ledger seen two ways*.

The frontend is Next.js (App Router) on Vercel. A simulation worker runs the heartbeat off-Vercel. And one Aurora DSQL cluster is the single source of truth all three runtimes write to.

## The part that mattered: settlement is one conditional write

Here's the habit I had to unlearn. In Postgres, the way you stop two buyers from spending the same credits is a pessimistic lock:

```sql
SELECT credits FROM players WHERE id = :buyer FOR UPDATE;
-- check in app code, then:
UPDATE players SET credits = credits - :cost WHERE id = :buyer;
```

DSQL doesn't have `SELECT … FOR UPDATE`. It's **optimistic**, not pessimistic. My first instinct was to treat that as a missing feature. It isn't — it's a better model once you stop fighting it. You move the check *into the write*:

```sql
UPDATE players
   SET credits = credits - :cost
 WHERE id = :buyer
   AND credits >= :cost;     -- the invariant, asserted by the database
```

Then you read the affected-row count. **One row** means it held. **Zero rows** means someone else moved first and the balance no longer satisfies the guard — so the matching loop re-reads and retries once. The same pattern guards inventory so a unit can't be sold twice. Money is `BIGINT` credits and every money calculation happens in SQL — no floating point anywhere, no integer drift.

The result is that "no double-spend, no oversell" isn't something my application *hopes* it enforced correctly across a lock acquisition. It's something the **database guarantees** on each individual write, under strong consistency, with the agents and the humans all crossing the same book. That's the whole demo: I can place a buy that crosses a resting AI sell and watch it settle instantly, knowing the balance and inventory checks happened *inside* that transaction.

## Three places DSQL made me unlearn a Postgres habit

**1. Migrations: one DDL per transaction.** DSQL allows exactly one DDL statement per transaction, and DDL and DML can't share a transaction at all. My first migration runner wrapped everything in one atomic transaction — the Postgres reflex — and it simply failed against the cluster. The runner is now mode-aware: on DSQL it runs each statement as its own auto-commit and records the `_migrations` row separately; on local Postgres it stays atomic. Same migration files, two execution strategies.

**2. A living grid wants to write thousands of rows a tick.** The cellular automaton runs *in memory* and persists only the cells that changed — that's the single most important cost decision in the build (writing all 4,096 cells every 3 seconds would be ruinous). But a busy early generation can still change a few thousand cells at once, and a single DSQL transaction has a bounded row count. I hit that ceiling. The fix was to chunk the delta-persist into transaction-sized batches — keeping the "deltas only, never the full grid" rule while staying inside DSQL's envelope.

**3. No foreign keys.** DSQL doesn't do FK constraints, so referential integrity is enforced in application logic and secondary indexes are created `ASYNC`. Designing the schema *DSQL-shaped from day one* — no FKs, short transactions, async indexes, optimistic concurrency — was far easier than retrofitting it would have been.

## The bug that nearly hollowed out the pitch

The scariest moment wasn't a crash. During a local dogfood on a two-day-old world, I looked at the leaderboard and one bot — `scout` — had run away to ~122 million net worth, while *every other bot sat at exactly its 1,500,000 starting credits*. They had never made a single trade.

The matching engine was correct. The settlement transaction was correct. The bug was a **circular dependency in agent behavior**: the momentum, value and arbitrage agents each key their decisions off the recent trade tape — but only a trade *writes* the tape, so it never bootstrapped, and even once warmed it could re-freeze at equilibrium. A market whose whole premise is "the machines trade against you" was a frozen book with one bot eating the world.

The fix kept the ledger core untouched: I gave the momentum agent an anchor-reverting cold-start probe (cross the spread toward a stable anchor when there's no trend to follow), and seeded every commodity with a full maker + momentum + value ecology. Now all four commodities trade every generation, oscillating bounded near the anchor, no runaway. I caught it because the demo's argument depends on it — and that's the lesson: verify the thing your pitch rests on, live, before you call it done.

## Why this isn't just a game

Strip the resource-world theme and what's left is a **reference implementation of a correctness-critical settlement ledger on Aurora DSQL**. The same engine is the spine of event ticketing (N seats, never N+1), limited-inventory drops (oversell impossible by construction), payments and marketplace escrow (debit-buyer / credit-seller as one atomic fact), and virtual economies. Anyone who has ever written "balance can't go negative" and then babysat a reconciliation job has fought this exact problem. Orbis is the version where the database owns the invariant and the reconciliation job never gets written.

## What I actually learned

I stopped trying to *prove* global scale and started *guaranteeing* it. Once the database owns "no double-spend, no oversell," an entire category of code I'd write by reflex — distributed locks, reconciliation passes, the bookkeeping that double-checks the bookkeeping — simply never existed. And "global scale" read far more credibly as a **consistency story** (one correct ledger, reachable from any region, active-active by design) than it ever would have as a throughput graph.

That was the bet. I think it paid off.

---

*Orbis Exchange — built solo for **#H0Hackathon** (H0: Hack the Zero Stack with Vercel and AWS Databases). Stack: Amazon Aurora DSQL · Vercel · Next.js · React · TypeScript · node-postgres · Server-Sent Events · pnpm · Vitest. Live: https://orbis-exchange.vercel.app · Code: https://github.com/sgharlow/orbis-exchange*
