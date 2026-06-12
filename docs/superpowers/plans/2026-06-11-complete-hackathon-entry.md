# Complete the Hackathon Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every open gap between `orbis-exchange-spec.md` and the implementation — single-flight worker fit for scheduled Lambda, listing-initiation UI, richer price chart, `world?since=`, edge-cached reads, mobile pass — then execute the user-gated cloud track (DSQL, Vercel, Lambda, guardrails, multi-region capture) and the submission, by **2026-06-29 5:00pm PDT**.

**Architecture:** Unchanged from the spec (§5): Next.js on Vercel + Aurora DSQL + an off-Vercel simulation/agent worker. Part A makes the worker invocation-safe (the `ticks` row becomes the generation lock) and finishes the demo-visible UX. Part B provisions net-new cloud resources only — no existing system is touched.

**Tech Stack:** TypeScript, pnpm monorepo, Next.js App Router, node-postgres, `@aws-sdk/dsql-signer`, Vitest, esbuild (new devDep, worker only), AWS Lambda + EventBridge Scheduler, Vercel.

**Conventions that bind every task:**
- Money is `BIGINT` in SQL, `string` in TS — never `number`.
- `@orbis/db` and `apps/worker` use explicit `.js` import extensions (NodeNext).
- DB tests need Docker up and `TEST_DATABASE_URL`. PowerShell: `$env:TEST_DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis_test'`.
- Run db/worker tests from the repo root: `pnpm --filter @orbis/db test` / `pnpm --filter @orbis/worker test` / `pnpm --filter @orbis/web test`.
- **Commit messages: NO `Co-Authored-By: Claude` trailer, no "Generated with Claude" line — ever.** (User policy; overrides the harness default.)
- After the last code task, run `pnpm -r lint` and the full `pnpm -r test` (expect ≥ 104, all green).

**File structure (what changes where):**

| File | Responsibility / change |
|---|---|
| `packages/db/src/queries.ts` | + `claimGeneration`; `persistTick` upserts completion; `getWorld` adds `list_price` |
| `packages/db/src/index.ts` | export `claimGeneration` |
| `packages/db/src/market.ts` | `recent_trades` LIMIT 20 → 60 (feeds the chart) |
| `packages/db/test/tick.test.ts` | tests for claim/complete; `getWorld` expectation gains `list_price` |
| `apps/worker/src/tick.ts` | `runTick` claims its generation first; result gains `skipped` |
| `apps/worker/src/index.ts` | dev loop derives generation from the DB each tick |
| `apps/worker/src/handler.ts` | **new** — Lambda entry: in-invocation 3s heartbeat with a time budget |
| `apps/worker/test/tick.test.ts` | single-flight test; updated result assertion |
| `apps/worker/test/handler.test.ts` | **new** — handler runs ≥1 tick in budget |
| `apps/worker/package.json` | + esbuild devDep, `bundle` script |
| `apps/web/src/app/api/world/route.ts` | `?since=` + CDN cache header |
| `apps/web/src/app/api/market/[commodity]/route.ts` | CDN cache header |
| `apps/web/src/app/api/leaderboard/route.ts` | CDN cache header + 503 catch |
| `apps/web/src/lib/world-view.ts` | + `outlineFor` (own/listed/other) |
| `apps/web/src/lib/market-view.ts` | + `chartGeometry`; remove `sparklinePath` |
| `apps/web/src/components/WorldView.tsx` | listed-cell outlines, sell/unlist form, mobile canvas sizing |
| `apps/web/src/components/MarketPanel.tsx` | sparkline → real chart with fill + min/max scale |
| `apps/web/src/app/world/world.css` | `.list-form`, `.chart-*`, mobile media query |
| `apps/web/test/world-view.test.ts` | `outlineFor` tests |
| `apps/web/test/market-view.test.ts` | `chartGeometry` tests replace sparkline tests |
| `docs/superpowers/runbooks/phase-0-cloud-provisioning.md` | migration-list drift fix (0001–0004) |
| `LICENSE` | **new** — MIT |

---

# Part A — Code (local, no cloud credentials needed)

### Task 1: `claimGeneration` — the generation lock

The `ticks` row becomes the single-flight lock: exactly one worker can insert generation N (`ticks_pkey`), so overlapping scheduled invocations skip instead of colliding (the collision was observed locally as a `ticks_pkey` violation).

**Files:**
- Modify: `packages/db/src/queries.ts` (append after `persistTick`, ~line 377)
- Modify: `packages/db/src/index.ts:5-23` (add to the queries export list)
- Test: `packages/db/test/tick.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/db/test/tick.test.ts` (inside the file, after the `persistTick` describe block) and add `claimGeneration` to the import from `../src/queries.js`:

```ts
describe("claimGeneration", () => {
  it("claims a fresh generation exactly once — the second claimant is told no", async () => {
    expect(await claimGeneration(pool, 1)).toBe(true);
    expect(await claimGeneration(pool, 1)).toBe(false);
    const { rows } = await pool.query("SELECT generation, completed_at FROM ticks");
    expect(rows).toEqual([{ generation: "1", completed_at: null }]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```powershell
$env:TEST_DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis_test'; pnpm --filter @orbis/db test tick
```
Expected: FAIL — `claimGeneration` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/db/src/queries.ts`:

```ts
// Atomically claim a generation before computing a tick. The ticks row IS the
// lock: ticks_pkey lets exactly one worker insert generation N, so overlapping
// scheduled invocations skip cleanly instead of colliding mid-tick (spec §5.2).
// persistTick later completes the same row (completed_at + cells_changed).
export async function claimGeneration(pool: pg.Pool, generation: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO ticks (generation, started_at) VALUES ($1, now())
       ON CONFLICT (generation) DO NOTHING`,
    [generation]
  );
  return (rowCount ?? 0) > 0;
}
```

In `packages/db/src/index.ts`, add `claimGeneration,` to the export block from `./queries.js` (after `persistTick,`).

- [ ] **Step 4: Run the tests and make sure they pass**

```powershell
$env:TEST_DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis_test'; pnpm --filter @orbis/db test tick
```
Expected: PASS (all describe blocks in the file).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/queries.ts packages/db/src/index.ts packages/db/test/tick.test.ts
git commit -m "feat(db): claimGeneration — the ticks row as a single-flight generation lock"
```

### Task 2: `persistTick` completes a claimed generation

`persistTick` currently INSERTs the ticks row; after Task 1 the row may already exist (claimed). Make it an upsert: insert when standalone (keeps every existing test green), complete the claim when one exists.

**Files:**
- Modify: `packages/db/src/queries.ts:358-362` (the ticks INSERT inside `persistTick`)
- Test: `packages/db/test/tick.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("persistTick", ...)` block:

```ts
  it("completes a previously claimed generation instead of colliding", async () => {
    await claimGeneration(pool, 9);
    await persistTick(pool, 9, [{ id: 1, density: 41 }]);
    const { rows } = await pool.query(
      "SELECT generation, cells_changed, (completed_at IS NOT NULL) AS done FROM ticks"
    );
    expect(rows).toEqual([{ generation: "9", cells_changed: 1, done: true }]);
  });
```

- [ ] **Step 2: Run it to make sure it fails**

```powershell
$env:TEST_DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis_test'; pnpm --filter @orbis/db test tick
```
Expected: FAIL — duplicate key value violates unique constraint "ticks_pkey".

- [ ] **Step 3: Implement**

In `persistTick`, replace the ticks INSERT statement with:

```ts
    await client.query(
      `INSERT INTO ticks (generation, started_at, completed_at, cells_changed)
         VALUES ($1, now(), now(), $2)
         ON CONFLICT (generation) DO UPDATE
           SET completed_at = now(), cells_changed = EXCLUDED.cells_changed`,
      [generation, updates.length]
    );
```

- [ ] **Step 4: Run the full db suite (the old INSERT-shape tests must stay green)**

```powershell
$env:TEST_DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis_test'; pnpm --filter @orbis/db test
```
Expected: PASS — 8 files, 51 tests (49 baseline + Task 1's + this one).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/queries.ts packages/db/test/tick.test.ts
git commit -m "feat(db): persistTick completes a claimed generation (upsert, single-flight safe)"
```

### Task 3: `runTick` claims first; dev loop derives generation from the DB

Claim before the CA compute so a losing worker does zero work and — critically — never double-mines (`persistYields` runs after the claim gate).

**Files:**
- Modify: `apps/worker/src/tick.ts`
- Modify: `apps/worker/src/index.ts`
- Test: `apps/worker/test/tick.test.ts`

- [ ] **Step 1: Update the existing assertion + write the failing single-flight test**

In `apps/worker/test/tick.test.ts`, the first test's result assertion becomes:

```ts
    expect(result).toEqual({ generation: 1, cellsChanged: 3, mined: 0, skipped: false });
```

Append a new test inside the same describe block:

```ts
  it("skips a generation another worker already claimed (single-flight)", async () => {
    const first = await runTick(pool, "rt", 1);
    expect(first.skipped).toBe(false);

    const second = await runTick(pool, "rt", 1); // overlapping invocation, same gen
    expect(second).toEqual({ generation: 1, cellsChanged: 0, mined: 0, skipped: true });

    // the world advanced exactly once — one ticks row, densities written once
    const ticks = await pool.query("SELECT count(*)::int AS n FROM ticks");
    expect(ticks.rows[0].n).toBe(1);
  });
```

- [ ] **Step 2: Run it to make sure it fails**

```powershell
$env:TEST_DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis_test'; pnpm --filter @orbis/worker test tick
```
Expected: FAIL — the first test's `toEqual` misses the new `skipped` key, and the new test gets `second.skipped === undefined` (after Task 2, the second runTick no longer throws — it silently re-applies the CA, which is exactly the bug this task closes).

- [ ] **Step 3: Implement**

In `apps/worker/src/tick.ts`:

1. Extend the import: `import { loadRegionCells, persistTick, persistYields, loadOwnerLevels, claimGeneration, type Pool } from "@orbis/db";`
2. Add `skipped: boolean;` to `RunTickResult`.
3. At the top of `runTick` (before `loadRegionCells`):

```ts
  // Claim the generation before any work: if another invocation owns it, do
  // nothing — no CA compute, no mining, no persistence (single-flight).
  const claimed = await claimGeneration(pool, generation);
  if (!claimed) return { generation, cellsChanged: 0, mined: 0, skipped: true };
```

4. The final return becomes `return { generation, cellsChanged: updates.length, mined, skipped: false };`

Replace `apps/worker/src/index.ts` in full (the loop now derives the generation from the DB each tick instead of incrementing in memory, so any number of concurrent workers interleave correctly):

```ts
// Orbis simulation worker — the heartbeat (spec §5.2). On a fixed interval it
// advances the cellular-automaton world by one generation (persisting only
// deltas) and runs one algorithmic-agent round so the market stays liquid and
// alive. Off-Vercel by design; the cloud runs the same body via the Lambda
// handler (handler.ts). The generation is derived from the DB and claimed
// atomically each tick, so multiple workers never collide — extras skip.

import { createPool, getLatestGeneration } from "@orbis/db";
import { runTick } from "./tick.js";
import { runAgents } from "./run-agents.js";

const TICK_MS = Number(process.env.TICK_MS ?? 3000);
const REGION = process.env.REGION ?? "r0";

async function main(): Promise<void> {
  const pool = createPool();
  console.log(`orbis worker: ticking ${REGION} every ${TICK_MS}ms`);

  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // never overlap ticks within this process
    running = true;
    let generation = -1;
    try {
      generation = (await getLatestGeneration(pool)) + 1;
      const tick = await runTick(pool, REGION, generation);
      if (tick.skipped) {
        console.log(`gen ${generation}: claimed by another worker, skipped`);
        return;
      }
      const agents = await runAgents(pool);
      console.log(
        `gen ${generation}: ${tick.cellsChanged} cells changed, mined ${tick.mined}; ` +
          `agents placed ${agents.placed} / filled ${agents.fills} / claimed ${agents.claimed}`
      );
    } catch (err) {
      console.error(`gen ${generation} failed:`, (err as Error).message);
    } finally {
      running = false;
    }
  }, TICK_MS);

  const shutdown = async () => {
    clearInterval(timer);
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Run the worker suite**

```powershell
$env:TEST_DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis_test'; pnpm --filter @orbis/worker test
```
Expected: PASS — 35 tests (34 + 1 new).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/tick.ts apps/worker/src/index.ts apps/worker/test/tick.test.ts
git commit -m "feat(worker): single-flight ticks — claim the generation before any work"
```

### Task 4: Lambda handler — the in-invocation heartbeat

EventBridge Scheduler's finest rate is 1 minute, but the tick is 3 seconds. So the handler is invoked every minute and runs the heartbeat *inside* the invocation for a time budget (~55s), then exits. Overlap between invocations is safe because of Task 3.

**Files:**
- Create: `apps/worker/src/handler.ts`
- Test: `apps/worker/test/handler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/worker/test/handler.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createPool, applyMigrations } from "@orbis/db";
import { handler } from "../src/handler.js";

describe("lambda handler", () => {
  it("runs ticks on the heartbeat within its budget, then exits cleanly", async () => {
    const pool = createPool();
    try {
      await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
      await applyMigrations(pool, "local");
      await pool.query(
        `INSERT INTO cells (id, region, x, y, resource_type, density, owner_id, updated_gen)
           VALUES (1,'r0',0,0,'ore',50,NULL,0)`
      );

      process.env.RUN_BUDGET_MS = "2500";
      process.env.TICK_MS = "1000";
      const out = await handler();

      expect(out.ticks).toBeGreaterThanOrEqual(1);
      expect(out.skipped).toBe(0); // nothing else is ticking this test DB
      const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM ticks WHERE completed_at IS NOT NULL"
      );
      expect(rows[0].n).toBe(out.ticks);
    } finally {
      delete process.env.RUN_BUDGET_MS;
      delete process.env.TICK_MS;
      await pool.end();
    }
  }, 15_000);
});
```

- [ ] **Step 2: Run it to make sure it fails**

```powershell
$env:TEST_DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis_test'; pnpm --filter @orbis/worker test handler
```
Expected: FAIL — cannot find module `../src/handler.js`.

- [ ] **Step 3: Implement**

Create `apps/worker/src/handler.ts` (env is read inside the function so tests and Lambda can both configure it):

```ts
// AWS Lambda entry. EventBridge Scheduler invokes this every minute (its
// finest rate); the handler runs the 3-second heartbeat INSIDE the invocation
// for RUN_BUDGET_MS, then exits. Overlapping invocations are safe: runTick
// claims its generation via the ticks row, so a duplicate worker skips —
// never collides, never double-mines (spec §5.2).

import { createPool, getLatestGeneration } from "@orbis/db";
import { runTick } from "./tick.js";
import { runAgents } from "./run-agents.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function handler(): Promise<{ ticks: number; skipped: number }> {
  const TICK_MS = Number(process.env.TICK_MS ?? 3000);
  const RUN_BUDGET_MS = Number(process.env.RUN_BUDGET_MS ?? 55_000);
  const REGION = process.env.REGION ?? "r0";

  const pool = createPool();
  const deadline = Date.now() + RUN_BUDGET_MS;
  let ticks = 0;
  let skipped = 0;
  try {
    for (;;) {
      const startedAt = Date.now();
      try {
        const generation = (await getLatestGeneration(pool)) + 1;
        const tick = await runTick(pool, REGION, generation);
        if (tick.skipped) {
          skipped += 1;
        } else {
          await runAgents(pool);
          ticks += 1;
        }
      } catch (err) {
        console.error("tick failed:", (err as Error).message);
      }
      const wait = Math.max(0, TICK_MS - (Date.now() - startedAt));
      // stop if there isn't room for another full tick before the deadline
      if (Date.now() + wait + TICK_MS > deadline) break;
      await sleep(wait);
    }
    console.log(`handler done: ${ticks} ticks, ${skipped} skipped`);
    return { ticks, skipped };
  } finally {
    await pool.end();
  }
}
```

- [ ] **Step 4: Run the tests**

```powershell
$env:TEST_DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis_test'; pnpm --filter @orbis/worker test
```
Expected: PASS — 36 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/handler.ts apps/worker/test/handler.test.ts
git commit -m "feat(worker): Lambda handler — budgeted in-invocation heartbeat"
```

### Task 5: Bundle the handler for Lambda (esbuild)

One self-contained CJS file; the zip carries no `package.json`, so Lambda treats `.js` as CJS regardless of the workspace's `"type": "module"`.

**Files:**
- Modify: `apps/worker/package.json`

- [ ] **Step 1: Add the devDep and script**

In `apps/worker/package.json`, add to `devDependencies`: `"esbuild": "^0.24.0"` and to `scripts`:

```json
"bundle": "esbuild src/handler.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/handler.js --external:pg-native"
```

Then:

```powershell
pnpm install
```

- [ ] **Step 2: Build and verify the bundle loads and exports `handler`**

```powershell
pnpm --filter @orbis/worker bundle
node -e "const h = require('./apps/worker/dist/handler.js'); if (typeof h.handler !== 'function') { throw new Error('no handler export'); } console.log('bundle OK')"
```
Expected: `bundle OK`. (`dist/` is already gitignored at the repo root.)

- [ ] **Step 3: Smoke the bundle against the local DB (a real 2-tick run)**

```powershell
$env:DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis'; $env:RUN_BUDGET_MS='2500'; $env:TICK_MS='1000'; node -e "require('./apps/worker/dist/handler.js').handler().then(r => console.log('smoke', JSON.stringify(r)))"
```
Expected: `smoke {"ticks":2,"skipped":0}` (ticks ≥ 1; it advances the local dev world, which is harmless). Unset after: `Remove-Item Env:DATABASE_URL, Env:RUN_BUDGET_MS, Env:TICK_MS`.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/package.json pnpm-lock.yaml
git commit -m "build(worker): esbuild bundle target for the Lambda handler"
```

### Task 6: `getWorld` carries `list_price`; `/api/world` gains `?since=` + CDN caching

`list_price` in the world payload powers the listing UI (Task 7). `?since=` completes the documented API surface (spec §9). The cache header implements §12 read scaling: the world only changes every 3s, so `s-maxage=2` keeps read pressure off the write path.

**Files:**
- Modify: `packages/db/src/queries.ts` (the `WorldCell` interface ~line 302 and `getWorld` ~line 311)
- Modify: `packages/db/test/tick.test.ts` (the `getWorld` expectation in "world view reads")
- Modify: `apps/web/src/app/api/world/route.ts` (full replacement below)

- [ ] **Step 1: Write the failing test**

In `packages/db/test/tick.test.ts`, update the `getWorld` expectation to include the new field:

```ts
    expect(world).toEqual([
      { id: "1", x: 0, y: 0, resource_type: "ore", density: 50, owner_id: null, list_price: null },
      { id: "2", x: 1, y: 0, resource_type: "ore", density: 20, owner_id: null, list_price: null },
      { id: "3", x: 2, y: 0, resource_type: "ore", density: 80, owner_id: null, list_price: null },
    ]);
```

- [ ] **Step 2: Run it to make sure it fails**

```powershell
$env:TEST_DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis_test'; pnpm --filter @orbis/db test tick
```
Expected: FAIL — received objects lack `list_price`.

- [ ] **Step 3: Implement the db side**

In `packages/db/src/queries.ts`, add to `WorldCell`:

```ts
  list_price: string | null; // BIGINT — set when the owner has listed the cell for sale
```

and change the `getWorld` query to:

```ts
    `SELECT id, x, y, resource_type, density, owner_id, list_price FROM cells WHERE region = $1 ORDER BY y, x`,
```

- [ ] **Step 4: Run db tests — expect PASS, then replace the world route**

```powershell
$env:TEST_DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis_test'; pnpm --filter @orbis/db test
```

Replace `apps/web/src/app/api/world/route.ts` in full:

```ts
import { NextResponse } from "next/server";
import { createPool, getWorld, getWorldSince, getLatestGeneration } from "@orbis/db";

export const dynamic = "force-dynamic";

// Snapshots are CDN-cacheable for one tick (spec §12 read scaling): the world
// only changes every 3 seconds, so a 2s edge TTL keeps reads off the write path.
const CACHE = { "Cache-Control": "public, s-maxage=2, stale-while-revalidate=4" };

// GET /api/world?region=r0[&since=GEN] — full world snapshot, or only the cells
// changed strictly after generation GEN (spec §9).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const region = url.searchParams.get("region") ?? "r0";
  const sinceRaw = url.searchParams.get("since");
  const pool = createPool();
  try {
    const generation = await getLatestGeneration(pool);
    if (sinceRaw !== null) {
      const since = Number(sinceRaw);
      if (!Number.isInteger(since) || since < 0) {
        return NextResponse.json(
          { ok: false, error: "since must be a non-negative integer" },
          { status: 400 }
        );
      }
      const cells = await getWorldSince(pool, region, since);
      return NextResponse.json({ region, generation, since, cells }, { headers: CACHE });
    }
    const cells = await getWorld(pool, region);
    return NextResponse.json({ region, generation, cells }, { headers: CACHE });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  } finally {
    await pool.end();
  }
}
```

- [ ] **Step 5: Verify by hand against the dev server**

```powershell
# terminal 1 (leave running): $env:DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis'; $env:SESSION_SECRET='dev'; pnpm dev
Invoke-RestMethod "http://localhost:3000/api/world?region=r0&since=0" | ConvertTo-Json -Depth 3 | Select-Object -First 1
Invoke-RestMethod "http://localhost:3000/api/world?since=abc" -SkipHttpErrorCheck -StatusCodeVariable sc; $sc
```
Expected: first returns `{region, generation, since: 0, cells: [...]}`; second sets `$sc` = 400. Then `pnpm --filter @orbis/web lint` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/queries.ts packages/db/test/tick.test.ts apps/web/src/app/api/world/route.ts
git commit -m "feat: world payload carries list_price; /api/world?since= deltas + edge cache (spec §9, §12)"
```

### Task 7: Listing UI — sell/unlist your cell from the world view; listed cells glow gold

Closes the last §4.4 residual. Clicking **your own** cell opens a small sell form (list/unlist); clicking **another player's listed** cell buys it (existing `/api/claims` path — unchanged contract). Listed cells get a gold outline so the secondary market is visible.

**Files:**
- Modify: `apps/web/src/lib/world-view.ts` (append `outlineFor`)
- Modify: `apps/web/src/components/WorldView.tsx`
- Modify: `apps/web/src/app/world/world.css` (append `.list-form` styles)
- Test: `apps/web/test/world-view.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/world-view.test.ts` (add `outlineFor` to the import from `@/lib/world-view` — match the file's existing import path style):

```ts
describe("outlineFor", () => {
  it("your own cell outlines as own, even when listed", () => {
    expect(outlineFor("p1", "p1", null)).toBe("own");
    expect(outlineFor("p1", "p1", "500")).toBe("own");
  });
  it("another player's listed cell reads as listed", () => {
    expect(outlineFor("p2", "p1", "500")).toBe("listed");
  });
  it("another player's unlisted cell is other", () => {
    expect(outlineFor("p2", "p1", null)).toBe("other");
  });
  it("unclaimed cells get no outline", () => {
    expect(outlineFor(null, "p1", null)).toBe(null);
    expect(outlineFor(null, null, null)).toBe(null);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```powershell
pnpm --filter @orbis/web test world-view
```
Expected: FAIL — `outlineFor` is not exported.

- [ ] **Step 3: Implement the pure helper**

Append to `apps/web/src/lib/world-view.ts`:

```ts
// Which outline a cell gets: your cells outline bright (white), cells another
// player has listed for sale outline gold, other owned cells a faint grey.
export type Outline = "own" | "listed" | "other" | null;
export function outlineFor(
  ownerId: string | null,
  myId: string | null,
  listPrice: string | null
): Outline {
  const own = ownershipOf(ownerId, myId);
  if (own === 1) return "own";
  if (own === 2) return listPrice !== null ? "listed" : "other";
  return null;
}
```

Run: `pnpm --filter @orbis/web test world-view` → PASS.

- [ ] **Step 4: Wire it into WorldView**

In `apps/web/src/components/WorldView.tsx`, make these changes:

1. Imports: add `outlineFor` to the `@/lib/world-view` import; add `import { formatCredits } from "@/lib/market-view";` and `useCallback` to the react import if not present.

2. New refs/state (next to `ownerIdsRef`):

```ts
  const listPricesRef = useRef<(string | null)[]>([]);
  const [sel, setSel] = useState<{ idx: number; cellId: string; price: string | null } | null>(null);
  const [askPrice, setAskPrice] = useState("");
```

3. In the one-time buffer seeding block (`if (typesRef.current.length === 0)`), add a prices array seeded alongside owners:

```ts
    const prices = new Array<string | null>(n).fill(null);
    // inside the for-loop over initialCells:
    prices[i] = c.list_price;
    // after the loop:
    listPricesRef.current = prices;
```

4. In `draw()`, replace the `ownershipOf`-based outline block with:

```ts
        const o = outlineFor(owners[i], me, listPricesRef.current[i]);
        if (o !== null) {
          ctx.strokeStyle =
            o === "own"
              ? "rgba(238,243,255,0.95)"
              : o === "listed"
                ? "rgba(245,196,80,0.95)"
                : "rgba(150,170,210,0.5)";
          ctx.lineWidth = o === "other" ? 1 : 1.5;
          ctx.strokeRect(x + 0.75, y + 0.75, CELL - 2.1, CELL - 2.1);
        }
```

5. In the `poll()` cell loop, refresh prices too: `listPricesRef.current[i] = c.list_price;`

6. In `handleClaim`, after resolving `cellId` and before the POST, branch on ownership — your own cell opens the sell form instead of claiming:

```ts
    const meNow = myIdRef.current ?? window.localStorage.getItem("orbis_player_id");
    if (ownerIdsRef.current[idx] !== null && meNow !== null && ownerIdsRef.current[idx] === meNow) {
      const price = listPricesRef.current[idx];
      setAskPrice(price ?? "");
      setSel({ idx, cellId, price });
      setClaimMsg(null);
      return;
    }
```

7. Add the submit function (above the `return`):

```ts
  async function submitListing(price: number | null) {
    if (!sel) return;
    try {
      const res = await fetch(`/api/claims/${sel.cellId}/list`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ price }),
      });
      if (res.status === 401) {
        setClaimMsg({ kind: "err", text: "join via the market panel first" });
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setClaimMsg({ kind: "err", text: data.error ?? "could not list" });
        return;
      }
      listPricesRef.current[sel.idx] = price === null ? null : String(price);
      redrawRef.current?.();
      setClaimMsg({
        kind: "ok",
        text: price === null ? "cell unlisted" : `listed for ${formatCredits(price)} cr — gold outline marks it for sale`,
      });
      setSel(null);
    } catch {
      setClaimMsg({ kind: "err", text: "network error" });
    }
  }
```

8. In the JSX, inside the `claim-line` div, render the form when a cell is selected (the existing message/hint becomes the `: ...` branch):

```tsx
        {sel ? (
          <span className="list-form">
            <span className="list-cell">cell {sel.cellId}{sel.price ? ` · listed at ${formatCredits(sel.price)}` : ""}</span>
            <input
              inputMode="numeric"
              placeholder="price"
              value={askPrice}
              onChange={(e) => setAskPrice(e.target.value)}
              aria-label="list price"
            />
            <button
              onClick={() => {
                const p = Number(askPrice);
                if (!Number.isInteger(p) || p <= 0) {
                  setClaimMsg({ kind: "err", text: "enter a positive whole price" });
                  return;
                }
                submitListing(p);
              }}
            >
              list
            </button>
            {sel.price !== null && <button onClick={() => submitListing(null)}>unlist</button>}
            <button onClick={() => setSel(null)} aria-label="close">✕</button>
          </span>
        ) : claimMsg ? (
          <span className={`claim-msg ${claimMsg.kind}`}>{claimMsg.text}</span>
        ) : (
          <span className="claim-hint">click a cell to claim it — claimed cells mine resources each tick · click your own cell to sell it</span>
        )}
```

9. Add a legend entry after the "your cell" item:

```tsx
        <li className="legend-item">
          <span className="legend-swatch legend-listed" />
          for sale
        </li>
```

Append to `apps/web/src/app/world/world.css`:

```css
.list-form {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.7rem;
}
.list-form input {
  width: 5.5em;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(150, 170, 210, 0.35);
  border-radius: 4px;
  color: inherit;
  padding: 0.15rem 0.4rem;
  font: inherit;
}
.list-form button {
  background: rgba(245, 196, 80, 0.12);
  border: 1px solid rgba(245, 196, 80, 0.5);
  border-radius: 4px;
  color: #f5c450;
  padding: 0.15rem 0.55rem;
  font: inherit;
  cursor: pointer;
}
.legend-listed {
  background: transparent;
  border: 1.5px solid rgba(245, 196, 80, 0.95);
}
```

- [ ] **Step 5: Verify — tests, lint, and a live click-through**

```powershell
pnpm --filter @orbis/web test; pnpm --filter @orbis/web lint
```
Expected: PASS / clean. Then with `pnpm dev` + the worker running, in the browser: join → claim a cell → click it again → the sell form appears → list at 750 → gold outline appears → click your cell → unlist works. (Two-browser buy check happens in the cloud dogfood, Task 17.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/world-view.ts apps/web/src/components/WorldView.tsx apps/web/src/app/world/world.css apps/web/test/world-view.test.ts
git commit -m "feat(web): sell/unlist your cell from the world view; listed cells outline gold (spec §4.4)"
```

### Task 8: Real price chart — area fill, min/max scale, last-price dot

The sparkline is the weakest visual in the demo's money shot. Replace it with a chart: gradient area fill, price line, last-trade dot, min/max labels. Feed it more history (trades LIMIT 20 → 60; the tape still slices 8).

**Files:**
- Modify: `apps/web/src/lib/market-view.ts` (add `chartGeometry`, **delete** `sparklinePath`)
- Modify: `apps/web/test/market-view.test.ts` (chart tests replace the sparkline tests)
- Modify: `apps/web/src/components/MarketPanel.tsx` (the `price-row` block)
- Modify: `packages/db/src/market.ts:345` (`LIMIT 20` → `LIMIT 60` on recent trades)
- Modify: `apps/web/src/app/world/world.css` (chart styles)

- [ ] **Step 1: Write the failing tests**

In `apps/web/test/market-view.test.ts`: delete the `sparklinePath` describe block (and its import) and add:

```ts
describe("chartGeometry", () => {
  it("returns null with no trades", () => {
    expect(chartGeometry([], 220, 84)).toBeNull();
  });

  it("maps min to the bottom and max to the top of the padded box", () => {
    const g = chartGeometry([10, 20], 220, 80, 4)!;
    expect(g.min).toBe(10);
    expect(g.max).toBe(20);
    expect(g.line).toBe("M 4.0 76.0 L 216.0 4.0");
    expect(g.lastX).toBeCloseTo(216);
    expect(g.lastY).toBeCloseTo(4);
  });

  it("closes the area path down to the baseline", () => {
    const g = chartGeometry([10, 20], 220, 80, 4)!;
    expect(g.area).toBe("M 4.0 76.0 L 216.0 4.0 L 216.0 76.0 L 4.0 76.0 Z");
  });

  it("centers a single trade as a flat reference", () => {
    const g = chartGeometry([15], 220, 80, 4)!;
    expect(g.min).toBe(15);
    expect(g.max).toBe(15);
    expect(g.lastX).toBeCloseTo(110); // pad + innerW/2
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```powershell
pnpm --filter @orbis/web test market-view
```
Expected: FAIL — `chartGeometry` is not exported.

- [ ] **Step 3: Implement**

In `apps/web/src/lib/market-view.ts`, delete `sparklinePath` and add:

```ts
export interface ChartGeometry {
  line: string; // SVG path of the price line (chronological)
  area: string; // the line closed down to the baseline, for the gradient fill
  min: number;
  max: number;
  lastX: number; // last trade's point, for the marker dot
  lastY: number;
}

// Geometry for the price chart. Prices are chronological. Null when empty; a
// single trade renders as a centered flat point so the chart never looks broken.
export function chartGeometry(
  prices: number[],
  width: number,
  height: number,
  pad = 4
): ChartGeometry | null {
  if (prices.length === 0) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const single = prices.length === 1;
  const step = single ? 0 : innerW / (prices.length - 1);
  const pts = prices.map((p, i) => {
    const x = pad + (single ? innerW / 2 : i * step);
    const y = pad + innerH - ((p - min) / range) * innerH;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const base = (height - pad).toFixed(1);
  const area = `${line} L ${pts[pts.length - 1][0].toFixed(1)} ${base} L ${pts[0][0].toFixed(1)} ${base} Z`;
  const [lastX, lastY] = pts[pts.length - 1];
  return { line, area, min, max, lastX, lastY };
}
```

Run: `pnpm --filter @orbis/web test market-view` → PASS.

- [ ] **Step 4: Render it in MarketPanel and widen the history window**

In `packages/db/src/market.ts` line 345, change `LIMIT 20` to `LIMIT 60` (the comment "recent trades" stands; the chart wants ~3 minutes of history at one trade/tick).

In `apps/web/src/components/MarketPanel.tsx`:
1. Import `chartGeometry` instead of `sparklinePath`.
2. Replace the two pre-return lines computing `tradePrices`/`spark` with:

```ts
  const tradePrices = [...market.recent_trades].reverse().map((t) => Number(t.price));
  const chart = chartGeometry(tradePrices, 220, 84);
```

3. Replace the whole `<svg className="spark" ...>...</svg>` element with:

```tsx
        <div className="chart-wrap">
          <svg className="chart" viewBox="0 0 220 84" width="220" height="84" aria-hidden="true">
            <defs>
              <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#38e0f5" stopOpacity="0.28" />
                <stop offset="1" stopColor="#38e0f5" stopOpacity="0" />
              </linearGradient>
            </defs>
            {chart && (
              <>
                <path d={chart.area} fill="url(#chartFill)" />
                <path d={chart.line} fill="none" stroke="#38e0f5" strokeWidth="1.5" />
                <circle cx={chart.lastX} cy={chart.lastY} r="2.5" fill="#38e0f5" />
              </>
            )}
          </svg>
          {chart && (
            <div className="chart-scale" aria-hidden="true">
              <span>{formatCredits(chart.max)}</span>
              <span>{formatCredits(chart.min)}</span>
            </div>
          )}
        </div>
```

Append to `apps/web/src/app/world/world.css`:

```css
.chart-wrap {
  display: flex;
  align-items: stretch;
  gap: 0.4rem;
}
.chart-scale {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-size: 0.58rem;
  opacity: 0.65;
  font-variant-numeric: tabular-nums;
  padding: 2px 0;
}
```

- [ ] **Step 5: Run everything touched, then eyeball it**

```powershell
$env:TEST_DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis_test'; pnpm --filter @orbis/db test market; pnpm --filter @orbis/web test; pnpm --filter @orbis/web lint
```
Expected: all PASS/clean. With dev server + worker running and agents trading, the ore chart shows a filled line that moves tick by tick with a max/min scale.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/market.ts apps/web/src/lib/market-view.ts apps/web/test/market-view.test.ts apps/web/src/components/MarketPanel.tsx apps/web/src/app/world/world.css
git commit -m "feat(web): price chart with area fill, min/max scale, last-trade dot (spec §10)"
```

### Task 9: CDN cache headers on market + leaderboard reads

Completes the §12 read-scaling story (world route already done in Task 6). Market changes per tick (3s) → 2s TTL; leaderboard is less hot → 5s. The leaderboard route also gains the standard 503 catch (the only DB route without one).

**Files:**
- Modify: `apps/web/src/app/api/market/[commodity]/route.ts`
- Modify: `apps/web/src/app/api/leaderboard/route.ts`

- [ ] **Step 1: Apply both edits**

`apps/web/src/app/api/market/[commodity]/route.ts` — replace the try-body return with:

```ts
    return NextResponse.json(await getMarket(pool, commodity), {
      headers: { "Cache-Control": "public, s-maxage=2, stale-while-revalidate=4" },
    });
```

`apps/web/src/app/api/leaderboard/route.ts` — replace in full:

```ts
import { NextResponse } from "next/server";
import { createPool, getLeaderboard } from "@orbis/db";

export const dynamic = "force-dynamic";

// GET /api/leaderboard — net-worth ranking across humans and agents (spec §9).
export async function GET() {
  const pool = createPool();
  try {
    const board = await getLeaderboard(pool);
    return NextResponse.json(
      { leaderboard: board },
      { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" } }
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  } finally {
    await pool.end();
  }
}
```

- [ ] **Step 2: Verify**

```powershell
pnpm --filter @orbis/web lint
(Invoke-WebRequest "http://localhost:3000/api/market/ore").Headers["Cache-Control"]
```
Expected: lint clean; header `public, s-maxage=2, stale-while-revalidate=4` (dev server running).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/market/[commodity]/route.ts apps/web/src/app/api/leaderboard/route.ts
git commit -m "feat(web): edge-cacheable market + leaderboard reads (spec §12)"
```

### Task 10: Mobile layout pass

Judges may open the live link on a phone. The 880px breakpoint already stacks the panels; what doesn't adapt is the canvas (vmin-sized → undersized on portrait) and small-screen type/inputs.

**Files:**
- Modify: `apps/web/src/components/WorldView.tsx` (canvas inline size)
- Modify: `apps/web/src/app/world/world.css` (append a 600px media query)

- [ ] **Step 1: Capture the baseline**

With the dev server running, use the Playwright browser at 390×844 (`browser_resize` then `browser_navigate` to `http://localhost:3000/world`, `browser_take_screenshot`). Note: canvas size, overflow, tap targets.

- [ ] **Step 2: Apply the fixes**

In `WorldView.tsx`, change the canvas inline style to:

```ts
          width: "min(92vw, 72vh, 620px)",
          height: "min(92vw, 72vh, 620px)",
```

(Desktop is unchanged: 72vh ≈ 72vmin there and the 620px cap dominates; portrait phones now use 92% of the width.)

Append to `world.css`:

```css
@media (max-width: 600px) {
  .world-title {
    font-size: clamp(1.6rem, 8vw, 2.2rem);
  }
  .commodity-tabs {
    flex-wrap: wrap;
  }
  .ticket-inputs {
    flex-direction: column;
  }
  .ticket-inputs .field input,
  .join input {
    font-size: 16px; /* prevents iOS zoom-on-focus */
  }
  .claim-line {
    font-size: 0.78rem;
  }
}
```

If `.commodity-tabs` / `.ticket-inputs` are not flex containers in the existing CSS, match whatever display they use — the intent is: tabs wrap, ticket fields stack, inputs ≥16px.

- [ ] **Step 3: Verify against the expected changes**

Re-screenshot at 390×844 and compare against Step 1 explicitly: canvas now ~359px wide (was ~280), no horizontal scroll, tabs wrap instead of overflowing, ticket fields stacked. Also re-screenshot at 1280×800 and confirm the desktop layout is unchanged. `pnpm --filter @orbis/web lint` → clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/WorldView.tsx apps/web/src/app/world/world.css
git commit -m "feat(web): mobile layout pass — full-width canvas, stacked ticket, wrapping tabs"
```

### Task 11: Doc drift + LICENSE

**Files:**
- Modify: `docs/superpowers/runbooks/phase-0-cloud-provisioning.md` (steps D, F, H)
- Create: `LICENSE`

- [ ] **Step 1: Fix the runbook's expected outputs**

In the runbook: step D expected becomes `applied 0001_init … applied 0004_cell_listing, migrations complete`; step F expected becomes `smoke OK — migrations=[0001_init,0002_indexes,0003_invest,0004_cell_listing] players=2` **— first verify the smoke script's actual output format**: run `$env:DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis'; pnpm db:smoke` and paste the real line into the runbook (the seed count may differ now that seed includes agents — use what it actually prints); step H expected becomes `{"ok":true,"migrations":["0001_init","0002_indexes","0003_invest","0004_cell_listing"]}` (likewise verify against local `/api/health` first).

- [ ] **Step 2: Add the MIT license**

Create `LICENSE` at the repo root:

```
MIT License

Copyright (c) 2026 Steve Harlow

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Full-repo gate, then commit**

```powershell
$env:TEST_DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis_test'; pnpm -r test; pnpm -r lint
```
Expected: ≥ 110 tests (104 baseline + ~12 new − the deleted sparkline tests), all green; lint clean.

```bash
git add docs/superpowers/runbooks/phase-0-cloud-provisioning.md LICENSE
git commit -m "docs: runbook expected-outputs catch up to migrations 0003/0004; add MIT license"
git push origin phase-0-foundations
```

### Task 12: Default branch → `main` (USER-CONFIRM before force actions)

The judged repo currently defaults to `phase-0-foundations`; local `master` is a stale 2-commit ancestor.

- [ ] **Step 1: Verify master is an ancestor (safe to delete)**

```bash
git merge-base --is-ancestor master phase-0-foundations && echo SAFE
```
Expected: `SAFE`. If not, STOP and show the user what `master` contains.

- [ ] **Step 2: Create and push `main`, flip the default, clean up**

```bash
git branch main phase-0-foundations
git push origin main
gh repo edit sgharlow/orbis-exchange --default-branch main
git checkout main
git branch -d master
git push origin --delete phase-0-foundations
git branch -d phase-0-foundations
git remote set-head origin -a
```

- [ ] **Step 3: Verify**

```bash
gh repo view sgharlow/orbis-exchange --json defaultBranchRef -q .defaultBranchRef.name
```
Expected: `main`. Confirm GitHub still shows the full commit history and README renders.

---

# Part B — Cloud + ship (USER-GATED: stop and confirm before every AWS/Vercel mutation)

Everything below creates **net-new** resources only. The companion runbook is `docs/superpowers/runbooks/phase-0-cloud-provisioning.md` — follow it where referenced; this plan only adds what the runbook lacks (the Lambda worker, multi-region capture, submission). Region assumed `us-east-1` unless the user picks otherwise.

### Task 13: Provision Aurora DSQL + migrate + seed + smoke

- [ ] **Step 1 (USER):** Confirm AWS account + region; confirm hackathon AWS credits are applied.
- [ ] **Step 2:** Runbook sections A–C (create cluster, record `DSQL_HOST`, IAM `dsql:DbConnectAdmin`).
- [ ] **Step 3:** Runbook D–F with the worker's migrations now four deep:

```powershell
$env:DB_MODE='dsql'; $env:DSQL_HOST='<cluster-id>.dsql.us-east-1.on.aws'; $env:DSQL_REGION='us-east-1'
pnpm db:migrate   # applied 0001_init … 0004_cell_listing, migrations complete
pnpm db:seed
pnpm db:smoke     # smoke OK — migrations=[0001_init,0002_indexes,0003_invest,0004_cell_listing] …
```
- [ ] **Step 4:** Record the cluster ARN (needed for IAM in Task 16): `aws dsql list-clusters --region us-east-1`.

### Task 14: Deploy `apps/web` to Vercel

- [ ] **Step 1:** `vercel ls` / check for `.vercel/project.json` — do NOT create a duplicate project.
- [ ] **Step 2:** Runbook G: root `apps/web`, env vars `DB_MODE=dsql`, `DSQL_HOST`, `DSQL_REGION`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (key scoped to `dsql:DbConnectAdmin` on this cluster only), `AWS_REGION`, `SESSION_SECRET` (fresh random: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
- [ ] **Step 3:** Pre-deploy gate (user's global policy): local `pnpm -r test` green, `pnpm --filter @orbis/web exec next build` clean, env vars cross-checked against Vercel.
- [ ] **Step 4:** Deploy; verify per runbook H: `/api/health` returns `ok:true` with all four migrations; `/world` renders the seeded world.

### Task 15: Cost guardrails (BEFORE anything is left running — spec §11, mandatory)

- [ ] **Step 1:** AWS Budgets: monthly budget (suggest $10) with an email alert at 80%: `aws budgets create-budget …` or console. USER confirms the alert email arrives (AWS sends a confirmation).
- [ ] **Step 2:** Vercel: enable Spend Management with an auto-pause cap (suggest $20).
- [ ] **Step 3:** Confirm single-region only at this point.

### Task 16: Deploy the worker — Lambda + EventBridge Scheduler

- [ ] **Step 1: Build the artifact**

```powershell
pnpm --filter @orbis/worker bundle
Compress-Archive -Path apps\worker\dist\handler.js -DestinationPath function.zip -Force
```

- [ ] **Step 2: IAM (two roles)**

`trust-lambda.json`:
```json
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
```
`dsql-policy.json` (substitute account + cluster id):
```json
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"dsql:DbConnectAdmin","Resource":"arn:aws:dsql:us-east-1:<ACCOUNT_ID>:cluster/<CLUSTER_ID>"}]}
```
```powershell
aws iam create-role --role-name orbis-worker-lambda --assume-role-policy-document file://trust-lambda.json
aws iam attach-role-policy --role-name orbis-worker-lambda --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam put-role-policy --role-name orbis-worker-lambda --policy-name dsql-connect --policy-document file://dsql-policy.json
```
(The Lambda authenticates to DSQL via its role — no access keys in the function.)

- [ ] **Step 3: Create the function (timeout 90s > the 55s budget)**

```powershell
aws lambda create-function --function-name orbis-tick --runtime nodejs22.x --handler handler.handler --zip-file fileb://function.zip --role arn:aws:iam::<ACCOUNT_ID>:role/orbis-worker-lambda --timeout 90 --memory-size 512 --region us-east-1 --environment "Variables={DB_MODE=dsql,DSQL_HOST=<cluster-id>.dsql.us-east-1.on.aws,DSQL_REGION=us-east-1,REGION=r0,TICK_MS=3000,RUN_BUDGET_MS=55000}"
```

- [ ] **Step 4: Manual smoke before scheduling**

```powershell
aws lambda invoke --function-name orbis-tick --region us-east-1 out.json; Get-Content out.json
```
Expected: `{"ticks":18,"skipped":0}` (±1 tick). Then confirm via the live app: `/world` generation advanced and agents traded.

- [ ] **Step 5: Schedule it**

`trust-scheduler.json`: same shape with `"Service":"scheduler.amazonaws.com"`. `invoke-policy.json`: `"Action":"lambda:InvokeFunction","Resource":"arn:aws:lambda:us-east-1:<ACCOUNT_ID>:function:orbis-tick"`.
```powershell
aws iam create-role --role-name orbis-scheduler --assume-role-policy-document file://trust-scheduler.json
aws iam put-role-policy --role-name orbis-scheduler --policy-name invoke-orbis-tick --policy-document file://invoke-policy.json
aws scheduler create-schedule --name orbis-heartbeat --schedule-expression "rate(1 minute)" --flexible-time-window Mode=OFF --target '{"Arn":"arn:aws:lambda:us-east-1:<ACCOUNT_ID>:function:orbis-tick","RoleArn":"arn:aws:iam::<ACCOUNT_ID>:role/orbis-scheduler"}' --region us-east-1
```

- [ ] **Step 6: Verify continuity + single-flight in the wild**

Watch 3 minutes of CloudWatch logs (`aws logs tail /aws/lambda/orbis-tick --follow --region us-east-1`): generations strictly increasing, `skipped` counts appearing only at invocation boundaries, no errors. The live `/world` GEN counter climbs ~20/minute without stalls between invocations.

### Task 17: Cloud dogfood (the quality gate before any footage)

- [ ] With web + worker live: join with a fresh handle → claim a cell → watch inventory accrue → place a crossing order against a bot → see the fill animate + balance change → upgrade extraction → list a cell, buy it from a second browser/incognito with a second handle → leaderboard moves. On a phone too (Task 10's work).
- [ ] Watch specifically for: SSE behavior behind Vercel (does the stream hold or fall back to polling?), settlement latency to DSQL, auth-token refresh on long-idle pools (leave a tab open 20+ min, then trade).
- [ ] Fix what breaks; each fix lands as its own tested commit. Do not record the video until this list is clean. **Note (user's global policy): this dogfood is synthetic-E2E; say so explicitly in any "done" claim.**

### Task 18: Multi-region capture (brief, then tear down)

- [ ] **Step 1 (USER-CONFIRM):** Create the multi-region DSQL cluster pair (peered, e.g. us-east-1 + us-east-2) per current AWS docs — this exists only for footage + screenshots.
- [ ] **Step 2:** Apply migrations + seed to it; point a second Vercel env (or temporary deployment) at each regional endpoint; demonstrate a write in one region read from the other.
- [ ] **Step 3:** Capture: DSQL console storage/cluster config screenshots (submission requirement), multi-region cluster page, and 20–30s of screen recording for the video's scale section.
- [ ] **Step 4 (USER-CONFIRM):** Tear the multi-region pair down. Confirm AWS Budgets shows no surprise accrual the next day.

### Task 19: Demo video + Devpost submission (submit by June 27; June 28–29 are buffer only)

- [ ] Record per `docs/demo-video-script.md` against the **deployed** app: living world → trade settles → AI reveal → leaderboard → multi-region/consistency close. 3–5 minutes, hard cap.
- [ ] Publish the video (public/unlisted-public link). Update `README.md` with live URL + video link; update `docs/devpost-submission.md` with the real artifacts (Vercel project link, **Team ID**, video URL, screenshots).
- [ ] Devpost form: description naming Amazon Aurora DSQL, video link, Vercel link + Team ID, architecture diagram (`docs/architecture.png`), storage screenshots. Verify every link opens logged-out/incognito.
- [ ] Optional bonus: publish the build write-up with the event hashtag + required attribution.
- [ ] **SUBMIT** (USER does the final form submit). Re-verify the live app the morning of June 29.

---

## Out of scope (deliberate, per spec §15 "thin game, thick market")

- **Refine step (§3)** — invisible in a 4-minute demo; "refine = identity" is documented in the spec/roadmap as an intentional v1 simplification. Changing it now would touch the mining→inventory→market contract for zero demo value.
- **§16 stretch** (civic voting, Bedrock analyst, futures, replay, magic-link) — cut-first list; build only if every task above is done with ≥3 days to deadline.

## Self-review notes

- Spec coverage: §4.4 listing UI (T7), §5.2 single-flight (T1–T4), §8 worker deployment (T4–T5, T16), §9 `world?since=` (T6), §10 chart (T8), §11 guardrails (T15), §12 edge reads (T6, T9), §5.4 multi-region (T18), §14 submission (T19), §13 Phase 0 cloud (T13–T14). Refine + §16 explicitly out of scope.
- Type consistency: `RunTickResult.skipped` (T3) is what T4's handler and T3's index.ts branch on; `WorldCell.list_price: string | null` (T6) is what T7's `outlineFor`/refs consume; `chartGeometry` name is uniform across T8.
