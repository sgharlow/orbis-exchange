# Orbis Exchange

**A single living world. One global market. AI and humans trading on the exact
same strongly-consistent ledger.** Can you out-trade the machine?

> H0 — Hack the Zero Stack with Vercel and AWS Databases · **Track 3: Million-scale
> Global App.** Hero database: **Amazon Aurora DSQL.** Frontend: **Next.js on Vercel.**

**▶ Live:** https://orbis-exchange.vercel.app · **🎬 Demo video:** <!-- FILL AT SUBMISSION: paste the public YouTube/Vimeo URL here --> _(link added after recording)_

> **Submission status:** engineering complete · cloud **LIVE** (Aurora DSQL active, world ticking) · **134 tests green** (db 53 · web 36 · worker 45) · `next build` clean. Only user/interactive capture + submit remains. Turnkey paste sheet: [`docs/DEVPOST-PASTE-MAP.md`](docs/DEVPOST-PASTE-MAP.md). Ordered cliff-day path: [`docs/SUBMISSION-STATUS.md`](docs/SUBMISSION-STATUS.md).

A 64×64 resource world evolves every tick by cellular-automaton rules — regions
bloom and collapse, so scarcity is *emergent*, never authored. One global order
book per commodity turns that scarcity into price, and **every fill settles as one
short, strongly-consistent transaction**: no double-spend, no oversell, no
reconciliation. Algorithmic agents are first-class players that trade the same
book you do, at zero inference cost — they keep the world liquid and they're the
opponent on one net-worth leaderboard. Open the link and you're **dropped in as a
guest instantly — no login, no signup** — then rename to anything unique inline
whenever you like.

## Docs

- 📖 **[How to Play (PDF)](docs/user-guide.pdf)** — the illustrated guide.
- 🏗 **[Architecture](docs/architecture.md)** — diagram + the DSQL story.
- 🚀 **[Devpost submission](docs/devpost-submission.md)** — write-up + checklist.
- ✍️ **[Build write-up](docs/blog-post.md)** — the bonus blog post (`#H0Hackathon`).
- 🎬 **[Demo video script & shot-list](docs/demo-video-script.md)** — recording-ready.
- 🗺 **[Roadmap & spec QA](docs/roadmap.md)** — spec-vs-state gaps, prioritized.
- ✅ **[Submission status & next steps](docs/SUBMISSION-STATUS.md)** — what's done, what's left to submit.
- 🔎 **[Submission checklist](docs/SUBMISSION-CHECKLIST.md)** — live-verified requirement→evidence→gap→owner matrix.
- 📋 **[Devpost paste-map](docs/DEVPOST-PASTE-MAP.md)** — every Devpost form field → exact paste source.

## How it works

Three runtimes share **one database as the single source of truth**:

| Runtime | Role |
|---|---|
| **Next.js on Vercel** | World view + market panel; route handlers (`/api/orders`, `/api/claims`); SSE `/api/stream` |
| **Amazon Aurora DSQL** | Canonical world + ledger; strongly consistent; multi-region active-active |
| **Simulation + agent worker** | 3s heartbeat: CA tick (delta-persist) · mining · matching/settlement · agents |

Settlement enforces every invariant with **conditional writes** (e.g.
`UPDATE players SET credits = credits - cost WHERE credits >= cost`) — DSQL is
optimistic and has no `SELECT … FOR UPDATE`. Money is `BIGINT`; all money math
runs in SQL. The CA runs **in memory** and persists only changed cells.

## Monorepo

```
apps/web      Next.js app (world view, market panel, API routes, SSE)
apps/worker   simulation heartbeat: CA tick, mining, algorithmic agents
packages/db   schema, DSQL-safe migrations, queries, matching engine, world gen
```

## Run it locally

```bash
corepack enable && pnpm install
docker compose up -d                       # Postgres on localhost:5434
docker compose exec -T postgres psql -U orbis -d orbis -c "CREATE DATABASE orbis_test;"

DATABASE_URL=postgres://orbis:orbis@localhost:5434/orbis pnpm db:migrate
DATABASE_URL=postgres://orbis:orbis@localhost:5434/orbis pnpm db:seed   # world + agents

# terminal 1 — the app
DATABASE_URL=postgres://orbis:orbis@localhost:5434/orbis SESSION_SECRET=dev pnpm dev
# terminal 2 — the simulation heartbeat (world ticks + agents trade)
DATABASE_URL=postgres://orbis:orbis@localhost:5434/orbis pnpm --filter @orbis/worker dev
```

Open **http://localhost:3000** — you're auto-joined as a guest and redirected to
`/world`; click a cell to claim it (up to 12 cells per player). Tests: `pnpm -r test`
(needs Docker up) — **134 green** (db 53 · web 36 · worker 45). Cloud (Aurora DSQL +
Vercel): `docs/superpowers/runbooks/phase-0-cloud-provisioning.md`.

## Stack

Amazon Aurora DSQL (`@aws-sdk/dsql-signer` for IAM auth-token connect) · Vercel ·
Next.js (App Router) · React · TypeScript · node-postgres · Server-Sent Events ·
pnpm · Vitest.
