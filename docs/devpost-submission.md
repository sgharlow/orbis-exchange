# Orbis Exchange — Devpost submission

**Tagline:** A single living world and one global market, where AI and humans
trade on the exact same strongly-consistent ledger. Can you out-trade the machine?

**Hackathon:** H0 — Hack the Zero Stack with Vercel and AWS Databases · **Track 3:
Million-scale Global App** · deadline 2026-06-29 5:00pm PDT.

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

- **A living world.** A 64×64 grid of resource cells evolves every 3-second tick
  by Conway-style cellular-automaton rules — regions bloom, spread, overcrowd, and
  collapse. Scarcity is *emergent*, never authored.
- **One global market.** Every commodity has a single order book with price-time
  priority. Each fill settles as one short, strongly-consistent transaction:
  debit buyer, credit seller, move inventory, close both orders, record the trade
  — invariants asserted inside the transaction. No double-spend, no oversell, no
  reconciliation.
- **Claim & mine.** Click a cell to claim it; each tick it yields its resource
  into your inventory and depletes the land, feeding scarcity back into prices.
- **AI vs human, one ledger.** Algorithmic agents (market-maker, momentum, value,
  scout) are first-class players that trade through the identical order path you
  do, at zero inference cost. They keep the world liquid and alive — and they're
  the opponent. One net-worth leaderboard ranks everyone.

The screen is one world, two panels: the evolving map on the left and the moving
market on the right are visibly the same ledger seen two ways.

## How we built it

- **Database (the hero): Amazon Aurora DSQL** — PostgreSQL-compatible, accessed
  via `node-postgres` with the IAM auth-token flow. The schema is DSQL-shaped:
  no foreign keys (app-enforced integrity), short transactions, `CREATE INDEX
  ASYNC`, and optimistic concurrency via **conditional writes** (e.g.
  `UPDATE players SET credits = credits - cost WHERE credits >= cost`) instead of
  `SELECT … FOR UPDATE`. Money is `BIGINT`; all money math runs in SQL.
- **Frontend: Next.js (App Router) on Vercel** — a canvas world view that renders
  density as luminance, a live order book with depth and one-click trading, and
  Server-Sent Events (`/api/stream`) pushing tick / world-delta / market events,
  with a poll fallback.
- **Simulation + agent worker (off-Vercel)** — the heartbeat: each tick runs the
  CA in memory, mines owned cells, matches + settles crossing orders, and
  **persists only deltas**. In the cloud this is a scheduled invocation.
- **Monorepo:** pnpm workspaces (`apps/web`, `apps/worker`, `packages/db`),
  TypeScript end to end, 120+ tests (CA rules, settlement, matching, mining,
  claims, agents, SSE, single-flight scheduling), all green.

## Challenges we ran into

- **DSQL is optimistic, not pessimistic.** No `SELECT … FOR UPDATE`, so we
  enforce every invariant with conditional UPDATEs whose row count reveals a
  conflict, and let the matching loop re-read and retry. It's a cleaner model
  once you stop fighting it.
- **Persisting a living grid cheaply.** Writing 4,096 cells every tick would be
  ruinous, so the CA runs in memory and we persist only the cells that changed —
  the single most important cost decision in the build.
- **Realtime without sockets.** Vercel won't hold long-lived connections, so we
  push changes (not full snapshots) over SSE and reconcile deltas on the client.

## Accomplishments we're proud of

The settlement transaction: a single short, strongly-consistent write that makes
"no double-spend / no oversell" true by construction — demonstrated live with AI
and human orders crossing on the same book — and a world that's genuinely
*hypnotic* to watch evolve while the market moves underneath it.

## What we learned

Letting the database own the invariant collapses a whole category of
application-level complexity (no reconciliation, no distributed-lock dance), and
that "global scale" reads far more credibly as a consistency story than as a
benchmark.

## What's next

Investment/extraction upgrades and arbitrage agents, the multi-region cluster lit
up for the headline demo, and a Bedrock "analyst" agent that narrates its
reasoning — kept off the critical path for cost.

## Built with

`amazon-aurora-dsql` · `vercel` · `next.js` · `react` · `typescript` ·
`node-postgres` · `server-sent-events` · `pnpm` · `vitest`

---

## Submission checklist (H0 requirements)

- [x] Text description names **Amazon Aurora DSQL** as the database.
- [x] Architecture diagram — `docs/architecture.svg` / `docs/architecture.md`.
- [ ] **3–5 min demo video** — show the world evolving, a trade settling instantly,
      reveal that traders are AI, then the leaderboard + the DSQL/consistency
      walkthrough. *(record before submit)*
- [ ] **Published Vercel project link + Vercel Team ID.** *(after deploy)*
- [ ] **Storage screenshots** proving Aurora DSQL usage (cluster + connection
      config). *(after cloud provisioning — see `docs/superpowers/runbooks/phase-0-cloud-provisioning.md`)*
- [ ] Optional: build write-up published with the event hashtag + required
      attribution.

> Status at draft time: the game is feature-complete and tested locally
> (world + market + settlement + AI agents + scheduler + SSE + claims/mining).
> Remaining before submit are the **cloud provisioning** step (live DSQL + Vercel
> deploy + storage screenshots) and the **demo video** — both intentionally
> user-driven.
