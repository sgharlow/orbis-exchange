# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Pre-implementation. The repository currently contains only `orbis-exchange-spec.md`, the authoritative build contract. There is no `package.json`, source tree, or tooling yet. **`orbis-exchange-spec.md` is the source of truth** — when implementing, follow it; if you must deviate, update the spec in the same change so the two never disagree.

This is a hackathon entry: **H0 "Hack the Zero Stack," Track 3 (Million-scale Global App). Submission deadline June 29, 2026, 5:00pm PDT.** The schedule and scope discipline in spec §13 and §15 are part of the contract, not suggestions.

## Commands

None exist yet. Once the Next.js app is scaffolded (planned: v0 → `next` App Router, TypeScript), expect the standard `next dev` / `next build` / `next lint` plus a test runner to be added. **Do not invent or assume commands** — read `package.json` once it exists and update this section with the real scripts (including how to run a single test).

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
