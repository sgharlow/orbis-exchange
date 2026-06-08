# Orbis Exchange — Phase 0 Foundations: Design Spec

**Date:** 2026-06-07
**Status:** Approved (design); pending implementation plan
**Source of truth:** `orbis-exchange-spec.md` (the build contract). This document refines spec §13 "Phase 0 Foundations" into an actionable design. Where this doc and the build contract disagree, the build contract wins and this doc must be corrected.

---

## 1. Goal

Stand up the project skeleton and **prove the full cloud spine end to end** before any game logic exists: browser → Next.js route handler on Vercel → Aurora DSQL over IAM auth → back to the browser. Phase 0 ends with a deployed, live-DSQL-backed "hello-world" that exercises the riskiest integration in the whole project (DSQL auth from Vercel) on day one, plus the monorepo, schema, local dev loop, and cost guardrails the later phases build on.

This corresponds to the spec §13 Phase 0 deliverable ("DSQL cluster provisioned, schema applied, credits requested, Next.js scaffolded, hello-world deployed to Vercel, budgets and spend caps on"), target **by June 9**.

## 2. Key decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| AWS/DSQL starting point | Account exists, no DSQL yet → provision single-region in Phase 0 | Matches §13; verify DSQL region availability first |
| Local dev database | **Dockerized Postgres locally; real DSQL in cloud** | Fast/offline loop; keep SQL to the DSQL-safe subset; smoke-test against the real cluster before deploy |
| Hello-world shape | **Thin vertical slice (B), not a static page** | Retires the scariest unknown (DSQL IAM auth from a Vercel route handler) before game logic exists |
| Repo layout | **pnpm monorepo** (`apps/web`, `apps/worker`, `packages/db`) | One place for shared schema + types across three runtimes; single install |
| Worker runtime | **Local Node process for now**; choose Lambda-on-schedule vs Fargate at deploy time (Phase 2/3) | Defer AWS plumbing until the engine exists |
| Auth | **Handle + signed session token** (scaffold only in Phase 0) | Enough to attribute a player to orders/credits/leaderboard; magic link deferred |
| UI scaffold tool | **`create-next-app` now; bring v0 in at Phase 1–2** | Phase 0 has almost no UI; v0 earns its keep on the world-view/market-panel screens (and still gives the real "scaffolded in v0" story) |

## 3. Repository structure

```
orbis-exchange/
  apps/
    web/          Next.js App Router (TypeScript) — UI + route handlers + SSE (SSE later)
    worker/       Node process: CA tick engine + matching engine + agents (later phases; empty shell in Phase 0)
  packages/
    db/           schema migrations, migration runner, seed script, shared TS types,
                  pg connection module (local Postgres OR DSQL by config)
  docker-compose.yml   local Postgres for dev
  orbis-exchange-spec.md
  CLAUDE.md
  docs/superpowers/specs/
```

pnpm workspaces. `packages/db` is the keystone: it owns the schema, the DSQL-safe conventions, the shared types, and the one connection module both `web` and `worker` import — preventing schema/type drift across runtimes.

## 4. Database layer (`packages/db`)

The highest-DSQL-risk component, designed deliberately.

### 4.1 Connection module
A single factory returning a `node-postgres` pool, driven by env:
- **Local mode:** plain `postgres://` connection string to the Docker container.
- **DSQL mode:** host + region + IAM **auth-token** generation. The DSQL auth token is short-lived (~15 min), so it is minted per new connection, not stored as a static password.

Same SQL runs against both modes.

### 4.2 Migrations
Plain `.sql` files applied by a small in-house runner backed by a `migrations` tracking table — **not** a heavyweight ORM/migration framework.

Reasons: DSQL requires **asynchronous index creation** and **no foreign-key constraints**, which generic tools fight. Hand-written SQL keeps us inside the DSQL-safe subset on purpose. The runner applies cleanly to both targets; on local Postgres the async-index syntax is normalized to a normal `CREATE INDEX`.

### 4.3 Schema
All tables from spec §6 created in Phase 0 even though most stay empty until later: `players`, `cells`, `inventory`, `orders`, `trades`, `market_state`, `ticks`, `agents`. Applying the full schema now is what lets the cloud smoke test prove DSQL accepts our real DDL.

### 4.4 Seed script
Inserts a tiny fixture: a couple of `players` and the four `market_state` rows (Ore, Energy, Biomass, Rare), enough for `GET /api/leaderboard` to return real data.

### 4.5 Shared types
Hand-written TypeScript interfaces mirroring the tables, exported for `web` and `worker`. No codegen in Phase 0.

### 4.6 Money convention (encoded day one)
Money is `BIGINT` integer credits in SQL, surfaced as `bigint`/string in TS — **never `number`** — so float money can never be introduced accidentally. (spec §6: "integer credits, no floats for money".)

## 5. Web app and the vertical slice (`apps/web`)

Next.js App Router, TypeScript. Phase 0 builds the spine, not the game.

- **`GET /api/leaderboard`** — imports the `packages/db` connection module, queries `players` ordered by a net-worth expression (credits only for now, since inventory is empty), returns JSON. This is the real DSQL read.
- **`/` page** — server component that fetches the leaderboard and renders a plain list. No world grid or market panel yet (Phases 1–2). Exists only to prove browser → route → DSQL → browser works deployed.
- **`GET /api/health`** — returns DB connectivity + current migration version. What the pre-deploy smoke test hits against the live cluster.

Auth in Phase 0 is the handle+token **scaffold only**: sign a session cookie and attribute a player; not a full login flow.

## 6. Local dev, cloud provisioning, guardrails

### 6.1 Local loop
1. `docker-compose up` → Postgres container.
2. `pnpm db:migrate` → applies schema locally.
3. `pnpm db:seed` → fixtures.
4. `pnpm --filter web dev` → app at `localhost:3000` reading the local DB.

### 6.2 Cloud provisioning (one-time, documented runbook steps — run/approved by the user, not silently applied)
1. Verify Aurora DSQL **region availability** for the account, then create a **single-region** cluster in the cheapest available region.
2. Create the IAM role/policy for the DSQL auth-token flow; capture the cluster endpoint.
3. Run the **same migrations** against DSQL via the connection module in `dsql` mode → proves DDL is DSQL-legal.
4. Deploy `apps/web` to **Vercel**; set DB env vars (endpoint, region, IAM creds) in Vercel project settings; redeploy.
5. Hit deployed `/api/health` → confirms the live spine.

### 6.3 Cost guardrails (done in Phase 0, before anything can run away — spec §11)
- **AWS Budgets** alert at a low dollar threshold (runaway loop pages, not bills).
- **Vercel Spend Management** auto-pause as a hard ceiling.
- Stay **single-region**; multi-region cluster is a Phase 3 step purely for demo footage/screenshots.

All provisioning is net-new resources on a fresh project — no changes to any existing working system.

## 7. Definition of done

**Local**
1. `docker-compose up` + `pnpm db:migrate` + `pnpm db:seed` succeed from a clean clone.
2. `pnpm --filter web dev` serves `/` showing seeded players; `/api/health` returns OK + migration version.
3. Lint + a minimal test runner wired and green (unit test for the net-worth ordering query; a test that migrations apply to a throwaway Postgres).

**Cloud**
4. DSQL cluster provisioned single-region; the **same migrations apply cleanly** against it.
5. `apps/web` deployed to Vercel; deployed `/api/health` returns OK reading the **live DSQL cluster** over IAM auth — the full spine proven.
6. `pnpm db:smoke` connects to the live cluster, checks migration version, runs a trivial read — the pre-deploy gate.

**Guardrails**
7. AWS Budgets alert active; Vercel Spend Management auto-pause set.

## 8. Explicitly out of scope for Phase 0

Deferred to hold scope (each has a later phase): CA tick engine, world-grid UI, matching engine + settlement transaction, AI agents, SSE realtime, claims/mining/investment loop, magic-link auth, multi-region cluster. v0-generated UI begins in Phase 1–2.

## 9. Risks specific to Phase 0

| Risk | Mitigation |
|------|------------|
| DSQL not available in an expected region / account access gaps | Step 6.2.1 verifies region availability before anything else |
| DSQL IAM auth-token flow from a Vercel route handler is fiddly | This is exactly why we do the thin vertical slice (B) on day one rather than deferring it |
| DSQL DDL rejects our schema (FKs, sync indexes) | DSQL-safe subset encoded in migrations; step 6.2.3 applies the real schema to the real cluster early |
| Local Postgres masks DSQL-only behavior | `pnpm db:smoke` against live DSQL is a required pre-deploy gate |
| Cost runaway | Budgets + Vercel auto-pause set in Phase 0 before any loop runs |
