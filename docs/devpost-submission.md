# Orbis Exchange — Devpost submission

**Tagline:** A single living world and one global market, where AI and humans
trade on the exact same strongly-consistent ledger. Can you out-trade the machine?

**Hackathon:** H0 — Hack the Zero Stack with Vercel and AWS Databases · **Track 3:
Million-scale Global App** · deadline 2026-06-29 5:00pm PDT.

**▶ Live:** https://orbis-exchange.vercel.app · **🎬 Demo video:** https://youtu.be/beOVLYmNv0w

---

## Inspiration

Most "global app" demos prove scale with a load-test graph. We wanted to prove it
with an *invariant*: a single global market where balances and inventory can never
go wrong, no matter how many people and bots trade at once — and where that
guarantee comes from the database, not from application bookkeeping. Aurora DSQL's
strongly-consistent, active-active design made that the natural hero, so we built a
world worth trading in around it.

## What it does

Orbis Exchange is a persistent, single-world economic simulation.

- **Instant guest onboarding.** Opening the link auto-joins you as a guest —
  no login, no signup, no handle prompt (a signed per-browser cookie session that
  persists ~30 days and self-heals if the cookie is lost). Rename to any unique
  name inline whenever you want.
- **A living world.** A 64×64 grid of resource cells evolves every 3-second tick
  by Conway-style cellular-automaton rules — regions bloom, spread, overcrowd, and
  collapse. Scarcity is *emergent*, never authored. The field renders as a crisp
  single-hue density heatmap (brightness = abundance) — scroll to zoom in on a
  cell, then scroll or drag to pan — with on-demand reveal-layer chips per
  commodity, a "my cells" spotlight, hover tooltips, and an always-visible
  Enter → Claim → Sell objective rail.
- **One global market.** Every commodity has a single order book with price-time
  priority. Each fill settles as one short, strongly-consistent transaction:
  debit buyer, credit seller, move inventory, close both orders, record the trade
  — invariants asserted inside the transaction. No double-spend, no oversell, no
  reconciliation. The human trades as a market taker — Buy at best ask, Sell at
  best bid, quantity auto-bounded to what's executable, so orders always fill and
  never rest or fail (and disable with a reason when not viable); the order book
  is shown read-only as the AI market-makers' depth.
- **Claim & mine.** Click a cell to claim it (each player may own up to 12 cells);
  each tick it yields its resource into your inventory and depletes the land,
  feeding scarcity back into prices.
- **AI vs human, one ledger.** Every bot is a first-class player trading through
  the identical order path you do, at zero inference cost. Market-makers and a
  liquidity "pulse" keep the book two-sided and the tape warm even in a sparse
  room; momentum, value, and a cross-commodity arbitrage bot are the opponents
  you actually race. One net-worth leaderboard ranks you against those strategic
  bots — the liquidity layer runs the market from behind the scenes.

The screen is one world, two panels: the evolving map on the left and the moving
market on the right are visibly the same ledger seen two ways.

## Who it's for — and why the pattern ships

The game is the demo. The thing under it is a **reference implementation of a
correctness-critical settlement ledger on Aurora DSQL** — and that's the part
that's actually useful to real people.

Any team that has ever written "balance can't go negative" or "don't sell the
same seat twice" has fought this exact problem, usually with a row lock, a queue,
or a nightly reconciliation job that pages someone at 3am when it disagrees with
itself. Orbis shows the alternative: let a strongly-consistent, FK-less,
multi-region database own the invariant, settle in one short conditional-write
transaction, and the whole reconciliation category disappears.

Drop the resource-world theme and the same engine is the spine of:

- **Event ticketing** — N seats, never N+1 sold, even under a stampede.
- **Limited-inventory drops / flash sales** — oversell is impossible by
  construction, not by hoping the lock held.
- **Payments & marketplace escrow** — debit-buyer / credit-seller as one atomic
  fact, no double-spend, no money invented or lost.
- **In-game / virtual economies** — exactly what's modeled here, runnable at
  global scale on day one.

So the real "who": the engineer who needs a ledger that's right under concurrency
and across regions, and would rather prove it with an invariant than babysit a
reconciliation pass. Orbis is that proof you can click on.

## How we built it

- **Database (the hero): Amazon Aurora DSQL** — PostgreSQL-compatible, accessed
  via `node-postgres` with the IAM auth-token flow. The schema is DSQL-shaped:
  no foreign keys (app-enforced integrity), short transactions, `CREATE INDEX
  ASYNC`, and optimistic concurrency via **conditional writes** (e.g.
  `UPDATE players SET credits = credits - cost WHERE credits >= cost`) instead of
  `SELECT … FOR UPDATE`. Money is `BIGINT`; all money math runs in SQL.
- **Frontend: Next.js (App Router) on Vercel** — a canvas world view that renders
  density as a crisp single-hue heatmap (pixel-accurate at any zoom), a read-only
  order-book depth display with one-click taker trading (pick a size, Buy at best
  ask / Sell at best bid, quantity auto-bounded so orders always fill), and Server-Sent Events
  (`/api/stream`) pushing tick / world-delta / market events, with a poll fallback.
- **Simulation + agent worker (off-Vercel)** — the heartbeat: each tick runs the
  CA in memory, mines owned cells, matches + settles crossing orders, and
  **persists only deltas**. In the cloud this is a scheduled invocation.
- **Monorepo:** pnpm workspaces (`apps/web`, `apps/worker`, `packages/db`),
  TypeScript end to end, 143 tests (db 55 · web 36 · worker 52 — CA rules,
  settlement, matching, mining, claims, agents, SSE, single-flight scheduling),
  all green.

## Challenges we ran into

These are the three that actually cost us time — the ones where DSQL made us
unlearn a Postgres habit.

- **DSQL is optimistic, not pessimistic — so the lock I reached for doesn't
  exist.** My instinct on the settlement transaction was `SELECT … FOR UPDATE`
  the buyer's row, check the balance, debit. DSQL has no `FOR UPDATE`. The fix
  was better than the habit: assert the invariant *in the write itself* —
  `UPDATE players SET credits = credits - :cost WHERE credits >= :cost` — and
  read the affected-row count. Zero rows means someone else moved first; the
  matching loop re-reads and retries once. The database, not my application code,
  is now the thing guaranteeing nobody double-spends.
- **The migration runner had to be rewritten around DSQL's DDL rules.** DSQL
  allows exactly **one DDL statement per transaction**, and DDL and DML can't
  share a transaction at all. Our first migration runner (one atomic
  transaction, the Postgres way) just failed against the cluster. So the runner
  is now mode-aware: on DSQL it runs each statement as its own auto-commit and
  records `_migrations` separately; on local Postgres it stays atomic. Same
  migrations, two execution strategies.
- **A "living grid" tried to write 4,096 rows a tick — until DSQL's row limit
  stopped it.** The CA already runs in memory and persists only changed cells,
  but a busy early generation can still change a few thousand at once, and a
  single DSQL transaction has a bounded row count. We hit it. The fix
  (`fix(db): chunk persistTick cell writes to respect Aurora DSQL row limit`) was
  to chunk the delta persist into transaction-sized batches — keeping the
  "deltas only, never the full grid" rule while staying inside DSQL's envelope.
- **The bots placed orders but never traded — and it nearly shipped.** During a
  local dogfood (gen ~837, two-day-old world) the leaderboard had one bot,
  `scout`, runaway at ~122M net worth while *every other bot sat at exactly its
  1,500,000 starting credits* — they had never made a single trade. Root cause: a
  circular dependency. The momentum/value/arb agents each key off the recent
  trade tape, but only a trade writes the tape, so it never bootstrapped — and at
  equilibrium it could re-freeze. The matching engine and settlement transaction
  were correct the whole time; the bug was in agent behavior. We added an
  anchor-reverting cold-start probe to momentum (cross the spread toward a stable
  anchor when there's no trend) and gave every commodity a full maker+momentum+
  value ecology. All four commodities now trade every generation, bounded near
  the anchor, no runaway. We caught it because "the machines trade against you"
  is the whole pitch — a frozen book would have hollowed out the demo.
- **Realtime without sockets.** Vercel won't hold long-lived connections, so we
  push changes (not full snapshots) over SSE and reconcile deltas on the client,
  with a short-poll fallback.

## Accomplishments we're proud of

The settlement transaction: a single short, strongly-consistent write that makes
"no double-spend / no oversell" true by construction — demonstrated live with AI
and human orders crossing on the same book — and a world that's genuinely
*hypnotic* to watch evolve while the market moves underneath it.

## What we learned

The biggest one is a reframe: we stopped trying to *prove* global scale with a
load-test graph and started *guaranteeing* it with an invariant. Once the
database owns "no double-spend, no oversell," a whole category of code we'd have
written by reflex — distributed locks, a reconciliation pass, the bookkeeping
that double-checks the bookkeeping — simply never got written. "Global scale"
turned out to read far more credibly as a consistency story (one correct ledger,
reachable from any region) than as a benchmark.

## What's next

Lighting up DSQL's active-active multi-region path with a live peered region
(the architecture is built for it — today's deploy is single-region by choice,
for cost); the civic-governance layer (spec §4.6, a documented stretch); and a
Bedrock "analyst" agent that narrates its reasoning, kept deliberately off the
critical settlement path.

## Built with

`amazon-aurora-dsql` · `aws-sdk-dsql-signer` · `vercel` · `next.js` · `react` ·
`typescript` · `node-postgres` · `server-sent-events` · `pnpm` · `vitest`

---

## Submission checklist (H0 requirements)

- [x] Text description names **Amazon Aurora DSQL** as the database.
- [x] Architecture diagram — `docs/architecture.svg` / `docs/architecture.md`.
- [x] **3–5 min demo video** — world evolving, a trade settling instantly, reveal
      that traders are AI, then the leaderboard + the DSQL/consistency walkthrough.
      **Published:** https://youtu.be/beOVLYmNv0w
- [ ] **Published Vercel project link + Vercel Team ID.** *(app is deployed live at
      https://orbis-exchange.vercel.app — paste the project link + Team ID)*
- [x] **Storage screenshots** proving Aurora DSQL usage — `docs/gallery/orbis-dsql-us-east-1.jpg`
      + `docs/gallery/orbis-dsql-us-west-2.jpg` (the active-active pair's console, both regions'
      Peers tabs). Upload both to the gallery; they're also spliced into the demo video at the
      multi-region beat (~2:24).
- [ ] **Bonus (+up to 0.6 on Stage-2 score):** publish the build write-up
      **before June 29** with `#H0Hackathon` + required attribution. **Draft ready
      at [`blog-post.md`](blog-post.md)** — paste into Dev.to / Medium / your blog,
      confirm the attribution wording against the Official Rules, then add the live
      URL here. This is nearly-free points; don't skip it.

> Status (updated 2026-06-24): the game is feature-complete, tested (143 green —
> db 55 · web 36 · worker 52), and **deployed live** at
> https://orbis-exchange.vercel.app on Aurora DSQL. The roster is **18 bots** — a
> per-commodity liquidity "pulse" plus market-makers and a mining scout run the
> market off the board, so the leaderboard shows the **9 strategic opponents**
> (momentum / value / arb). Production is re-seeded clean to the ~1.5M baseline and
> the worker `orbis-heartbeat` (rate(1 min) → orbis-tick) is **enabled — the world
> is advancing**. The site is public (no login wall) and auto-joins visitors as
> guests. **Storage screenshots are DONE** (`docs/gallery/orbis-dsql-{us-east-1,us-west-2}.jpg`,
> also spliced into the demo video). The demo video is published
> (https://youtu.be/beOVLYmNv0w); remaining before submit: the **Devpost form**.
