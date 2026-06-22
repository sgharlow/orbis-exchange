# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

**Feature-complete and DEPLOYED LIVE (updated 2026-06-22).** Phases 0–3 of spec §13 are shipped: living world (CA tick + delta persistence + mining), strongly-consistent settlement engine, order book, leaderboard, player dashboard, investment/extraction, cell resale, the 14-agent ecology, SSE realtime. `pnpm -r test` = **134 green** (db 53 · web 36 · worker 45); `pnpm -r lint` clean; `next build` exit 0. **Player UX:** opening the link now **auto-joins as a guest (no login/signup/handle prompt)** with an inline rename; trades are **market-only ("only viable trades" — Buy at best ask / Sell at best bid, auto-bounded to always fill, no price field)**; and a **12-cell-per-player cap** bounds land accumulation (the order-book matching engine itself is unchanged). **Cloud is live:** Aurora DSQL cluster ACTIVE (migrated 0001–0004; production re-seeded clean 2026-06-22 with 14 agents), `apps/web` deployed at https://orbis-exchange.vercel.app, worker `orbis-heartbeat` (`rate(1 min)` → orbis-tick) **ENABLED — the world is advancing**. What remains is all user/interactive: multi-region capture + storage screenshots, demo video, Devpost submit (by 6-27; deadline 6-29). See `docs/SUBMISSION-STATUS.md` (ordered steps) + `docs/SUBMISSION-CHECKLIST.md` (live-verified). Provisioning runbook: `docs/superpowers/runbooks/phase-0-cloud-provisioning.md`.

**`orbis-exchange-spec.md` is the source of truth** — when implementing, follow it; if you must deviate, update the spec in the same change so the two never disagree.

This is a hackathon entry: **H0 "Hack the Zero Stack," Track 3 (Million-scale Global App). Submission deadline June 29, 2026, 5:00pm PDT.** The schedule and scope discipline in spec §13 and §15 are part of the contract, not suggestions.

## Commands

pnpm monorepo (`apps/web`, `apps/worker`, `packages/db`). Local DB runs in Docker.

- **Local DB:** `docker compose up -d` — Postgres on host **port 5434** (NOT 5432/5433; a system Postgres occupies 5433 on the dev machine). Create the test DB once: `docker compose exec -T postgres psql -U orbis -d orbis -c "CREATE DATABASE orbis_test;"`.
- **Migrate / seed / smoke (local):** `DATABASE_URL=postgres://orbis:orbis@localhost:5434/orbis pnpm db:migrate` (then `db:seed`, `db:smoke`).
- **Run the app:** `DATABASE_URL=postgres://orbis:orbis@localhost:5434/orbis pnpm dev` → `localhost:3000` (auto-bumps to 3001 if 3000 is taken).
- **Tests:** `pnpm -r test` (all packages). DB tests need the env var: `TEST_DATABASE_URL=postgres://orbis:orbis@localhost:5434/orbis_test pnpm --filter @orbis/db test`. Single file: append the file name, e.g. `pnpm --filter @orbis/db test migrate`. Web crypto tests: `pnpm --filter @orbis/web test`.
- **Lint (typecheck):** `pnpm -r lint` (each package's `lint` is `tsc --noEmit`).
- **Cloud:** set `DB_MODE=dsql DSQL_HOST=… DSQL_REGION=…` instead of `DATABASE_URL` (see the runbook).

Shell: commands above are bash form; in PowerShell use `$env:VAR='value'; cmd`.

## Implementation conventions (learned in Phase 0 — keep consistent)

- **Money is `BIGINT` in SQL, `string` in TS — never `number`.** `pg` returns `int8` as a string; don't override it.
- **`@orbis/db` uses NodeNext resolution and explicit `.js` import extensions** in its `.ts` files (so it runs under `tsx`/Node). `apps/web` uses Bundler resolution; it consumes `@orbis/db` via `transpilePackages` + a webpack `extensionAlias` (`.js`→`.ts`) in `next.config.ts`. If Turbopack is ever enabled, add the Turbopack-equivalent resolver.
- **DSQL migration constraints (authoritative, from AWS docs):** a transaction may contain only **1 DDL statement**, and **DDL and DML must be in separate transactions**. The migration runner (`packages/db/src/migrate.ts`) is mode-aware: on DSQL it runs each statement as its own auto-commit and records `_migrations` separately; on local Postgres it uses one atomic transaction. Migrations must be DDL-only simple statements (no `$$` bodies, no string literals containing `--` or `;`) — the runtime splitter assumes this.
- **No foreign-key constraints** (DSQL doesn't support them); integrity is app-enforced. Indexes are authored as plain `CREATE INDEX` — the runner rewrites to `CREATE INDEX ASYNC` for DSQL.
- **DB access pattern:** create a pool with `createPool()`, use it, and **always `await pool.end()` in `finally`**. Route handlers that read the DB set `export const dynamic = "force-dynamic"`. The `/api/health` catch→`{ok:false}`/503 shape is the error-handling standard for new DB routes.

## Architecture (the big picture)

Orbis Exchange is a persistent single-world economic simulation. Three runtimes share **one database as the single source of truth** — that database-centric design is the whole point of the entry, so preserve it:

1. **Next.js on Vercel** (App Router) — UI plus route handlers. Reads favor edge cache with short TTL; writes go straight to the DB. An SSE route (`GET /api/stream`) pushes tick/fill/price events, with a 2s short-poll fallback (Vercel does not hold long-lived sockets).
2. **Simulation worker** (off-Vercel: scheduled Lambda first, Fargate only if the tick outgrows the Lambda window) — owns the heartbeat. See "The tick" below.
3. **AI agent worker** (same runtime) — algorithmic trading/mining strategies (maker, momentum, value, scout, arb). These are **first-class players: rows in the same `players` table, same order path as humans, zero inference cost by default.** They exist to keep the market liquid during a sparse demo and to be the opponent. A Bedrock LLM "analyst" agent is an optional stretch, kept off the critical path.

**Database: Amazon Aurora DSQL** (PostgreSQL wire protocol, via `node-postgres` with the DSQL auth-token flow). DSQL is the hero of the submission — do not replace it. DynamoDB is documented as a fallback (§7) but stays unused unless a *measured* bottleneck forces it.

### The tick (simulation heartbeat)

Default interval **3 seconds**. Each tick the simulation worker: (1) loads the latest world snapshot + open orders from DSQL, (2) applies cellular-automaton rules in memory to compute next densities, (3) applies accumulated extraction pressure, (4) runs the matching engine and settles crossing orders in short transactions, (5) **persists only changed cells as deltas** plus a per-commodity `market_state` row and `trade` records.

**The single most important performance/cost rule: simulate in memory, persist deltas. NEVER write the full grid cell-by-cell every tick.** (spec §5.2, §11). The CA rules and constants live in §4.2; commit all `next_density` values simultaneously, then clear extraction pressure (Conway-style synchronous update).

### The market and settlement (the technical centerpiece)

One global market, one order book per commodity, price-time priority, resting order sets the fill price. **Every fill settles as one short, strongly-consistent transaction** that debits buyer credits, credits the seller, transfers inventory, updates/closes both orders, and inserts a trade — with the balance/inventory invariants re-asserted *inside* the transaction and a single retry on OCC conflict (spec §6.1). Strong consistency is what makes the asserts trustworthy: no double-spend, no oversell, no reconciliation pass. This invariant is the demo's whole argument — guard it.

### Money and data-model conventions (DSQL-specific)

- **Money is integer `BIGINT` credits. No floating point, anywhere.**
- The schema (spec §6) is designed for DSQL operating characteristics: **referential integrity is enforced in application logic, not with foreign-key constraints**; transactions stay short (well within the DSQL txn time limit); secondary indexes are created asynchronously; write paths use optimistic concurrency with a bounded retry on conflict.
- Net worth (the single leaderboard metric across humans and agents) = credits + inventory valued at last market price.

## Cost guardrails (set on day one, non-negotiable — spec §11)

- In-memory simulation + delta persistence + per-commodity `market_state` row. Never write the full grid each tick.
- Bounded demo grid (64×64 visible, region-sharded) and tick no faster than 3s. The million-scale claim lives in the **architecture diagram**, not in a runaway tick.
- AWS Budgets alert at a low threshold; Vercel Spend Management auto-pause as a hard ceiling.
- Develop single-region. Stand up the multi-region active-active cluster only to capture demo footage and storage screenshots.

## Scope discipline

"Thin game, thick market." Get **one commodity working end to end before adding the rest.** Cut order, when behind: civic-governance voting (§4.6), Bedrock analyst agent, then other §16 stretch goals — these go first, before touching the market/ledger core.
