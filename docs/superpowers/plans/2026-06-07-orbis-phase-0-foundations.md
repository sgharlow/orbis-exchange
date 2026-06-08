# Orbis Exchange — Phase 0 Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Orbis Exchange monorepo and prove the full cloud spine end to end — browser → Next.js route handler on Vercel → Aurora DSQL over IAM auth → browser — before any game logic exists.

**Architecture:** pnpm monorepo (`apps/web`, `apps/worker`, `packages/db`). `packages/db` owns the schema, a hand-rolled SQL migration runner, shared types, and one `node-postgres` connection module that targets local Postgres or Aurora DSQL by config. `apps/web` is a Next.js App Router app with a thin vertical-slice (`/`, `/api/health`, `/api/leaderboard`) that reads the live database.

**Tech Stack:** pnpm workspaces, TypeScript, Next.js (App Router), node-postgres (`pg`), `@aws-sdk/dsql-signer` (DSQL IAM auth tokens), Vitest, Docker Compose (local Postgres).

**Reference spec:** `docs/superpowers/specs/2026-06-07-phase-0-foundations-design.md`. **Build contract:** `orbis-exchange-spec.md` (§6 schema, §11 guardrails, §13 Phase 0). Where this plan and the build contract disagree, the build contract wins.

**Conventions used throughout:**
- **Shell:** commands are written in bash `VAR=value cmd` inline-env form. This repo is on Windows — run them via the Bash tool, or translate to PowerShell (`$env:VAR='value'; cmd`) when running in pwsh. The one-off env vars (`TEST_DATABASE_URL`, `DATABASE_URL`, `DB_MODE`, …) must be set the same way either shell.
- Money is `BIGINT` in SQL and is read/written as a JavaScript `string` in TS — never `number`. `pg` already returns `int8` as a string by default; do not override that.
- No foreign-key constraints (DSQL); referential integrity is application-enforced.
- All commands are run from the repo root unless stated otherwise.

---

## File structure (created across the plan)

```
orbis-exchange/
  package.json                      root workspace + scripts
  pnpm-workspace.yaml               workspace globs
  tsconfig.base.json                shared TS config
  .gitignore
  .env.example                      documents required env vars
  docker-compose.yml                local Postgres
  packages/db/
    package.json
    tsconfig.json
    vitest.config.ts
    src/
      env.ts                        reads + validates DB env
      connection.ts                 pool factory (local | dsql modes)
      migrate.ts                    migration runner (CLI + lib)
      seed.ts                       fixture loader (CLI)
      smoke.ts                      live-cluster pre-deploy gate (CLI)
      queries.ts                    leaderboard query (shared by web)
      types.ts                      shared row types
    migrations/
      0001_init.sql                 all §6 tables
      0002_indexes.sql             secondary indexes
    test/
      connection.test.ts
      migrate.test.ts
      queries.test.ts
  apps/web/
    package.json
    next.config.ts
    tsconfig.json
    vitest.config.ts
    src/
      app/
        page.tsx                    leaderboard list
        api/health/route.ts
        api/leaderboard/route.ts
      lib/session.ts                handle + signed-cookie scaffold
    test/
      session.test.ts
  apps/worker/
    package.json                    empty shell (Phase 1+)
    src/index.ts
docs/superpowers/runbooks/
  phase-0-cloud-provisioning.md     manual AWS/Vercel steps (Task 15)
```

---

## Task 1: Initialize pnpm monorepo skeleton

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "orbis-exchange",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "db:migrate": "pnpm --filter @orbis/db migrate",
    "db:seed": "pnpm --filter @orbis/db seed",
    "db:smoke": "pnpm --filter @orbis/db smoke",
    "dev": "pnpm --filter @orbis/web dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
.next/
dist/
*.tsbuildinfo
.env
.env.local
.DS_Store
```

- [ ] **Step 5: Create `.env.example`**

```
# Local development (Docker Postgres)
DB_MODE=local
DATABASE_URL=postgres://orbis:orbis@localhost:5433/orbis
TEST_DATABASE_URL=postgres://orbis:orbis@localhost:5433/orbis_test

# Aurora DSQL (cloud) — used when DB_MODE=dsql
# DB_MODE=dsql
# DSQL_HOST=<cluster-id>.dsql.<region>.on.aws
# DSQL_REGION=us-east-1
# AWS credentials come from the standard AWS provider chain (env/role)

# Web
SESSION_SECRET=dev-only-change-me
```

- [ ] **Step 6: Install pnpm and verify workspace resolves**

Run: `corepack enable && pnpm install`
Expected: completes with "Done" (no packages yet is fine; lockfile created).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: initialize pnpm monorepo skeleton"
```

---

## Task 2: Local Postgres via Docker Compose

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: orbis
      POSTGRES_PASSWORD: orbis
      POSTGRES_DB: orbis
    ports:
      - "5433:5432"
    volumes:
      - orbis_pg:/var/lib/postgresql/data
volumes:
  orbis_pg:
```

- [ ] **Step 2: Start Postgres and create the test database**

Run:
```bash
docker compose up -d
docker compose exec -T postgres psql -U orbis -d orbis -c "CREATE DATABASE orbis_test;"
```
Expected: `CREATE DATABASE`.

- [ ] **Step 3: Verify connectivity**

Run: `docker compose exec -T postgres psql -U orbis -d orbis -c "SELECT 1;"`
Expected: a row with `1`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add local Postgres docker-compose"
```

---

## Task 3: `packages/db` — env + connection module (local mode)

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/vitest.config.ts`, `packages/db/src/env.ts`, `packages/db/src/connection.ts`, `packages/db/test/connection.test.ts`

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@orbis/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "migrate": "tsx src/migrate.ts",
    "seed": "tsx src/seed.ts",
    "smoke": "tsx src/smoke.ts",
    "test": "vitest run",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "pg": "^8.13.0",
    "@aws-sdk/dsql-signer": "^3.700.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/db/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
```

- [ ] **Step 4: Install workspace deps**

Run: `pnpm install`
Expected: installs `pg`, `tsx`, `vitest`, etc.

- [ ] **Step 5: Write the failing test for the connection module**

Create `packages/db/test/connection.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { createPool } from "../src/connection.js";

const pool = createPool();

afterAll(async () => { await pool.end(); });

describe("createPool (local mode)", () => {
  it("connects and runs a trivial query", async () => {
    const { rows } = await pool.query("SELECT 1 AS n");
    expect(rows[0].n).toBe(1);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://orbis:orbis@localhost:5433/orbis_test pnpm --filter @orbis/db test`
Expected: FAIL — cannot find module `../src/connection.js`.

- [ ] **Step 7: Create `packages/db/src/env.ts`**

```ts
export type DbMode = "local" | "dsql";

export interface DbEnv {
  mode: DbMode;
  connectionString?: string;   // local
  host?: string;               // dsql
  region?: string;             // dsql
  database: string;
}

export function readDbEnv(): DbEnv {
  const mode = (process.env.DB_MODE ?? "local") as DbMode;
  if (mode === "dsql") {
    const host = required("DSQL_HOST");
    const region = required("DSQL_REGION");
    return { mode, host, region, database: process.env.DSQL_DATABASE ?? "postgres" };
  }
  // local: tests use TEST_DATABASE_URL when present
  const connectionString = process.env.TEST_DATABASE_URL ?? required("DATABASE_URL");
  return { mode: "local", connectionString, database: "orbis" };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
```

- [ ] **Step 8: Create `packages/db/src/connection.ts` (local mode only for now)**

```ts
import pg from "pg";
import { readDbEnv } from "./env.js";

const { Pool } = pg;

export function createPool(): pg.Pool {
  const env = readDbEnv();
  if (env.mode === "local") {
    return new Pool({ connectionString: env.connectionString, max: 5 });
  }
  // DSQL mode implemented in a later task
  throw new Error("DSQL mode not yet implemented");
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `TEST_DATABASE_URL=postgres://orbis:orbis@localhost:5433/orbis_test pnpm --filter @orbis/db test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/db
git commit -m "feat(db): connection module (local mode) + env"
```

---

## Task 4: `packages/db` — migration runner

**Files:**
- Create: `packages/db/src/migrate.ts`, `packages/db/test/migrate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/test/migrate.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createPool } from "../src/connection.js";
import { applyMigrations, appliedVersions } from "../src/migrate.js";

const pool = createPool();

beforeEach(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
});
afterAll(async () => { await pool.end(); });

describe("applyMigrations", () => {
  it("applies all migration files and is idempotent", async () => {
    await applyMigrations(pool, "local");
    const first = await appliedVersions(pool);
    expect(first).toContain("0001_init");
    expect(first).toContain("0002_indexes");

    // running again applies nothing new
    await applyMigrations(pool, "local");
    const second = await appliedVersions(pool);
    expect(second).toEqual(first);
  });

  it("creates the players table", async () => {
    await applyMigrations(pool, "local");
    const { rows } = await pool.query(
      "SELECT to_regclass('public.players') AS t"
    );
    expect(rows[0].t).toBe("players");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://orbis:orbis@localhost:5433/orbis_test pnpm --filter @orbis/db test migrate`
Expected: FAIL — cannot find `../src/migrate.js`.

- [ ] **Step 3: Create `packages/db/src/migrate.ts`**

```ts
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { createPool } from "./connection.js";
import type { DbMode } from "./env.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function appliedVersions(pool: pg.Pool): Promise<string[]> {
  await ensureTable(pool);
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM _migrations ORDER BY id"
  );
  return rows.map((r) => r.id);
}

export async function applyMigrations(pool: pg.Pool, mode: DbMode): Promise<void> {
  await ensureTable(pool);
  const done = new Set(await appliedVersions(pool));
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const id = file.replace(/\.sql$/, "");
    if (done.has(id)) continue;
    let sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    sql = transformForMode(sql, mode);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (id, applied_at) VALUES ($1, now())", [id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${id} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
    console.log(`applied ${id}`);
  }
}

// Aurora DSQL creates secondary indexes asynchronously via CREATE INDEX ASYNC.
// Local Postgres uses plain CREATE INDEX. Migrations are authored with plain
// CREATE INDEX; in dsql mode we rewrite to the ASYNC form.
function transformForMode(sql: string, mode: DbMode): string {
  if (mode !== "dsql") return sql;
  return sql.replace(/CREATE\s+INDEX\s+/gi, "CREATE INDEX ASYNC ");
}

async function ensureTable(pool: pg.Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
       id TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL
     )`
  );
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = (process.env.DB_MODE ?? "local") as DbMode;
  const pool = createPool();
  applyMigrations(pool, mode)
    .then(() => pool.end())
    .then(() => console.log("migrations complete"))
    .catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Create placeholder migration files so the runner has input (real content in Task 5)**

Create `packages/db/migrations/0001_init.sql`:

```sql
CREATE TABLE players (id UUID PRIMARY KEY, handle TEXT NOT NULL);
```

Create `packages/db/migrations/0002_indexes.sql`:

```sql
CREATE INDEX players_by_handle ON players (handle);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `TEST_DATABASE_URL=postgres://orbis:orbis@localhost:5433/orbis_test pnpm --filter @orbis/db test migrate`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): SQL migration runner with dsql async-index transform"
```

---

## Task 5: `packages/db` — real schema migrations (spec §6)

**Files:**
- Modify: `packages/db/migrations/0001_init.sql`, `packages/db/migrations/0002_indexes.sql`

- [ ] **Step 1: Replace `packages/db/migrations/0001_init.sql` with the full schema**

```sql
-- Participants, human and agent alike. Money is BIGINT credits, never float.
CREATE TABLE players (
    id           UUID PRIMARY KEY,
    handle       TEXT NOT NULL,
    kind         TEXT NOT NULL,          -- 'human' | 'agent'
    credits      BIGINT NOT NULL,
    home_region  TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL
);

-- World cells; demo grid plus region shard key. owner_id is app-enforced (no FK).
CREATE TABLE cells (
    id            BIGINT PRIMARY KEY,
    region        TEXT NOT NULL,
    x             INT NOT NULL,
    y             INT NOT NULL,
    resource_type TEXT NOT NULL,         -- 'ore'|'energy'|'biomass'|'rare'
    density       SMALLINT NOT NULL,     -- 0..100
    owner_id      UUID,
    updated_gen   BIGINT NOT NULL
);

CREATE TABLE inventory (
    player_id   UUID NOT NULL,
    commodity   TEXT NOT NULL,
    qty         BIGINT NOT NULL,
    PRIMARY KEY (player_id, commodity)
);

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

CREATE TABLE market_state (
    commodity   TEXT PRIMARY KEY,
    last_price  BIGINT NOT NULL,
    best_bid    BIGINT,
    best_ask    BIGINT,
    generation  BIGINT NOT NULL
);

CREATE TABLE ticks (
    generation    BIGINT PRIMARY KEY,
    started_at    TIMESTAMPTZ NOT NULL,
    completed_at  TIMESTAMPTZ,
    cells_changed INT
);

CREATE TABLE agents (
    player_id  UUID PRIMARY KEY,
    strategy   TEXT NOT NULL,            -- 'maker'|'momentum'|'value'|'scout'|'arb'
    params     JSONB NOT NULL
);
```

- [ ] **Step 2: Replace `packages/db/migrations/0002_indexes.sql` with the real indexes**

```sql
CREATE INDEX cells_by_region ON cells (region);
CREATE INDEX cells_by_owner ON cells (owner_id);
CREATE INDEX orders_book ON orders (commodity, side, price);
CREATE INDEX trades_by_commodity ON trades (commodity, executed_at);
```

- [ ] **Step 3: Run the migration tests against a clean DB**

Run: `TEST_DATABASE_URL=postgres://orbis:orbis@localhost:5433/orbis_test pnpm --filter @orbis/db test migrate`
Expected: PASS — all 8 tables created, idempotent.

- [ ] **Step 4: Apply migrations to the local dev DB**

Run: `DATABASE_URL=postgres://orbis:orbis@localhost:5433/orbis pnpm db:migrate`
Expected: `applied 0001_init`, `applied 0002_indexes`, `migrations complete`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations
git commit -m "feat(db): full Phase 0 schema and indexes (spec §6)"
```

---

## Task 6: `packages/db` — shared types

**Files:**
- Create: `packages/db/src/types.ts`, `packages/db/src/index.ts`

- [ ] **Step 1: Create `packages/db/src/types.ts`**

```ts
// Money fields (credits, price, qty) are BIGINT in SQL and surface as string in TS.
export interface PlayerRow {
  id: string;
  handle: string;
  kind: "human" | "agent";
  credits: string;
  home_region: string;
  created_at: string;
}

export interface MarketStateRow {
  commodity: string;
  last_price: string;
  best_bid: string | null;
  best_ask: string | null;
  generation: string;
}

export interface LeaderboardEntry {
  id: string;
  handle: string;
  kind: "human" | "agent";
  net_worth: string;
}
```

- [ ] **Step 2: Create `packages/db/src/index.ts` (package barrel)**

```ts
export { createPool } from "./connection.js";
export { applyMigrations, appliedVersions } from "./migrate.js";
export { getLeaderboard } from "./queries.js";
export type { PlayerRow, MarketStateRow, LeaderboardEntry } from "./types.js";
```

> Note: `./queries.js` is created in Task 7. Do not run `lint` until then.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/types.ts packages/db/src/index.ts
git commit -m "feat(db): shared row types + package barrel"
```

---

## Task 7: `packages/db` — leaderboard query

**Files:**
- Create: `packages/db/src/queries.ts`, `packages/db/test/queries.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/test/queries.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool } from "../src/connection.js";
import { applyMigrations } from "../src/migrate.js";
import { getLeaderboard } from "../src/queries.js";

const pool = createPool();

beforeAll(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await applyMigrations(pool, "local");
  await pool.query(
    `INSERT INTO players (id, handle, kind, credits, home_region, created_at) VALUES
       ('11111111-1111-1111-1111-111111111111','alice','human', 5000,'us-east','2026-06-07T00:00:00Z'),
       ('22222222-2222-2222-2222-222222222222','bot-maker','agent', 9000,'us-east','2026-06-07T00:00:00Z')`
  );
});
afterAll(async () => { await pool.end(); });

describe("getLeaderboard", () => {
  it("returns players ranked by net worth (credits) descending", async () => {
    const board = await getLeaderboard(pool);
    expect(board.map((e) => e.handle)).toEqual(["bot-maker", "alice"]);
    expect(board[0].net_worth).toBe("9000");
    expect(board[0].kind).toBe("agent");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://orbis:orbis@localhost:5433/orbis_test pnpm --filter @orbis/db test queries`
Expected: FAIL — cannot find `../src/queries.js`.

- [ ] **Step 3: Create `packages/db/src/queries.ts`**

```ts
import type pg from "pg";
import type { LeaderboardEntry } from "./types.js";

// Net worth = credits + inventory valued at last market price.
// In Phase 0 inventory is empty, so net worth = credits. The inventory join
// is added in a later phase; keeping credits-only here is intentional.
export async function getLeaderboard(pool: pg.Pool): Promise<LeaderboardEntry[]> {
  const { rows } = await pool.query<LeaderboardEntry>(
    `SELECT id, handle, kind, credits AS net_worth
       FROM players
      ORDER BY credits DESC, handle ASC
      LIMIT 100`
  );
  return rows;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `TEST_DATABASE_URL=postgres://orbis:orbis@localhost:5433/orbis_test pnpm --filter @orbis/db test queries`
Expected: PASS.

- [ ] **Step 5: Typecheck the package**

Run: `pnpm --filter @orbis/db lint`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): leaderboard query (credits-based net worth)"
```

---

## Task 8: `packages/db` — seed script

**Files:**
- Create: `packages/db/src/seed.ts`

- [ ] **Step 1: Create `packages/db/src/seed.ts`**

```ts
import { createPool } from "./connection.js";

const COMMODITIES = ["ore", "energy", "biomass", "rare"] as const;

async function seed(): Promise<void> {
  const pool = createPool();
  try {
    await pool.query(
      `INSERT INTO players (id, handle, kind, credits, home_region, created_at) VALUES
         ('11111111-1111-1111-1111-111111111111','alice','human', 10000,'us-east', now()),
         ('22222222-2222-2222-2222-222222222222','bot-maker','agent', 10000,'us-east', now())
       ON CONFLICT (id) DO NOTHING`
    );
    for (const c of COMMODITIES) {
      await pool.query(
        `INSERT INTO market_state (commodity, last_price, best_bid, best_ask, generation)
         VALUES ($1, 100, NULL, NULL, 0)
         ON CONFLICT (commodity) DO NOTHING`,
        [c]
      );
    }
    console.log("seed complete");
  } finally {
    await pool.end();
  }
}

seed().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the seed against the local dev DB**

Run: `DATABASE_URL=postgres://orbis:orbis@localhost:5433/orbis pnpm db:seed`
Expected: `seed complete`.

- [ ] **Step 3: Verify rows exist**

Run: `docker compose exec -T postgres psql -U orbis -d orbis -c "SELECT handle, credits FROM players ORDER BY credits DESC;"`
Expected: `bot-maker`/`alice` both `10000`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/seed.ts
git commit -m "feat(db): seed script (players + market_state fixtures)"
```

---

## Task 9: `packages/db` — DSQL mode in connection module

**Files:**
- Modify: `packages/db/src/connection.ts`

- [ ] **Step 1: Replace `packages/db/src/connection.ts` with local + DSQL support**

```ts
import pg from "pg";
import { DsqlSigner } from "@aws-sdk/dsql-signer";
import { readDbEnv } from "./env.js";

const { Pool } = pg;

export function createPool(): pg.Pool {
  const env = readDbEnv();

  if (env.mode === "local") {
    return new Pool({ connectionString: env.connectionString, max: 5 });
  }

  // DSQL: mint a short-lived IAM auth token per new connection.
  // `password` accepts an async function, so the pool refreshes it automatically.
  const signer = new DsqlSigner({ hostname: env.host!, region: env.region! });
  return new Pool({
    host: env.host,
    port: 5432,
    user: "admin",
    database: env.database,
    ssl: { rejectUnauthorized: true },
    max: 5,
    password: async () => signer.getDbConnectAdminAuthToken(),
  });
}
```

- [ ] **Step 2: Verify local tests still pass (no regression)**

Run: `TEST_DATABASE_URL=postgres://orbis:orbis@localhost:5433/orbis_test pnpm --filter @orbis/db test`
Expected: PASS — connection, migrate, queries suites all green.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @orbis/db lint`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/connection.ts
git commit -m "feat(db): DSQL mode with per-connection IAM auth token"
```

> Live DSQL connectivity is verified in Task 15 (cloud runbook), not here — there is no local DSQL emulator.

---

## Task 10: `packages/db` — live-cluster smoke script

**Files:**
- Create: `packages/db/src/smoke.ts`

- [ ] **Step 1: Create `packages/db/src/smoke.ts`**

```ts
import { createPool } from "./connection.js";
import { appliedVersions } from "./migrate.js";

// Pre-deploy gate: connect to whatever DB_MODE points at, confirm migrations
// are applied and a trivial read works. Run with DB_MODE=dsql before deploying.
async function smoke(): Promise<void> {
  const pool = createPool();
  try {
    const versions = await appliedVersions(pool);
    if (!versions.includes("0001_init")) {
      throw new Error(`schema not migrated; applied=[${versions.join(",")}]`);
    }
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM players");
    console.log(`smoke OK — migrations=[${versions.join(",")}] players=${rows[0].n}`);
  } finally {
    await pool.end();
  }
}

smoke().catch((e) => { console.error("smoke FAILED:", e.message); process.exit(1); });
```

- [ ] **Step 2: Verify the smoke script passes against the local DB**

Run: `DATABASE_URL=postgres://orbis:orbis@localhost:5433/orbis pnpm db:smoke`
Expected: `smoke OK — migrations=[0001_init,0002_indexes] players=2`.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/smoke.ts
git commit -m "feat(db): pre-deploy smoke script"
```

---

## Task 11: `apps/web` — Next.js scaffold

**Files:**
- Create: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@orbis/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@orbis/db": "workspace:*",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `apps/web/next.config.ts`**

```ts
import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@orbis/db"],
};
export default config;
```

- [ ] **Step 3: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "noEmit": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "next-env.d.ts", ".next/types/**/*.ts"]
}
```

- [ ] **Step 4: Create `apps/web/src/app/layout.tsx`**

```tsx
export const metadata = { title: "Orbis Exchange" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 5: Create a temporary placeholder `apps/web/src/app/page.tsx`**

```tsx
export default function Home() {
  return <main>Orbis Exchange — Phase 0</main>;
}
```

- [ ] **Step 6: Install and verify dev server boots**

Run: `pnpm install && pnpm --filter @orbis/web dev`
Expected: Next.js starts; `http://localhost:3000` shows "Orbis Exchange — Phase 0". Stop the server (Ctrl-C) after confirming.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): Next.js App Router scaffold"
```

---

## Task 12: `apps/web` — `/api/health` route

**Files:**
- Create: `apps/web/src/app/api/health/route.ts`

- [ ] **Step 1: Create `apps/web/src/app/api/health/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createPool, appliedVersions } from "@orbis/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const pool = createPool();
  try {
    const versions = await appliedVersions(pool);
    return NextResponse.json({ ok: true, migrations: versions });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 503 }
    );
  } finally {
    await pool.end();
  }
}
```

- [ ] **Step 2: Verify the route returns OK against the local DB**

Run (in one terminal): `DATABASE_URL=postgres://orbis:orbis@localhost:5433/orbis pnpm --filter @orbis/web dev`
Run (in another): `curl -s http://localhost:3000/api/health`
Expected: `{"ok":true,"migrations":["0001_init","0002_indexes"]}`. Stop the dev server after confirming.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/health/route.ts
git commit -m "feat(web): /api/health DB-connectivity route"
```

---

## Task 13: `apps/web` — `/api/leaderboard` route + `/` page

**Files:**
- Create: `apps/web/src/app/api/leaderboard/route.ts`
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Create `apps/web/src/app/api/leaderboard/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createPool, getLeaderboard } from "@orbis/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const pool = createPool();
  try {
    const board = await getLeaderboard(pool);
    return NextResponse.json({ leaderboard: board });
  } finally {
    await pool.end();
  }
}
```

- [ ] **Step 2: Replace `apps/web/src/app/page.tsx` to render the leaderboard**

```tsx
import { createPool, getLeaderboard } from "@orbis/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const pool = createPool();
  let board;
  try {
    board = await getLeaderboard(pool);
  } finally {
    await pool.end();
  }
  return (
    <main>
      <h1>Orbis Exchange — Leaderboard</h1>
      <ol>
        {board.map((e) => (
          <li key={e.id}>
            {e.handle} {e.kind === "agent" ? "(AI)" : ""} — {e.net_worth}
          </li>
        ))}
      </ol>
    </main>
  );
}
```

- [ ] **Step 3: Verify the page and route render seeded data**

Run: `DATABASE_URL=postgres://orbis:orbis@localhost:5433/orbis pnpm --filter @orbis/web dev`
Then: `curl -s http://localhost:3000/api/leaderboard`
Expected: JSON listing `bot-maker` and `alice`. Visiting `http://localhost:3000` shows the ranked list with `(AI)` next to `bot-maker`. Stop the server after confirming.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app
git commit -m "feat(web): leaderboard route + home page (live DB read)"
```

---

## Task 14: `apps/web` — handle + signed-session scaffold

**Files:**
- Create: `apps/web/src/lib/session.ts`, `apps/web/src/app/api/session/route.ts`, `apps/web/test/session.test.ts`, `apps/web/vitest.config.ts`

- [ ] **Step 1: Create `apps/web/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/test/session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "../src/lib/session.js";

const secret = "test-secret";

describe("session token", () => {
  it("round-trips a player id and handle", () => {
    const token = signSession({ playerId: "p1", handle: "alice" }, secret);
    const claims = verifySession(token, secret);
    expect(claims).toEqual({ playerId: "p1", handle: "alice" });
  });

  it("rejects a tampered token", () => {
    const token = signSession({ playerId: "p1", handle: "alice" }, secret);
    expect(verifySession(token + "x", secret)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSession({ playerId: "p1", handle: "alice" }, secret);
    expect(verifySession(token, "other-secret")).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @orbis/web test`
Expected: FAIL — cannot find `../src/lib/session.js`.

- [ ] **Step 4: Create `apps/web/src/lib/session.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export interface SessionClaims {
  playerId: string;
  handle: string;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signSession(claims: SessionClaims, secret: string): string {
  const payload = b64url(Buffer.from(JSON.stringify(claims), "utf8"));
  const sig = b64url(createHmac("sha256", secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifySession(token: string, secret: string): SessionClaims | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", secret).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @orbis/web test`
Expected: PASS (all three cases).

- [ ] **Step 6: Create `apps/web/src/app/api/session/route.ts` (issues the cookie)**

```ts
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { signSession } from "@/lib/session";

export async function POST(req: Request) {
  const { handle } = (await req.json()) as { handle?: string };
  if (!handle || handle.length > 32) {
    return NextResponse.json({ error: "invalid handle" }, { status: 400 });
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }
  const playerId = randomUUID();
  const token = signSession({ playerId, handle }, secret);
  const res = NextResponse.json({ playerId, handle });
  res.cookies.set("orbis_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
  });
  return res;
}
```

> Phase 0 scope: this issues a signed identity cookie. Persisting the player row and reading the cookie on protected routes arrives with the order/claim endpoints in Phase 2. This is intentionally just the scaffold.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @orbis/web lint`
Expected: no type errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib apps/web/src/app/api/session apps/web/test apps/web/vitest.config.ts
git commit -m "feat(web): handle + signed-session scaffold"
```

---

## Task 15: `apps/worker` — empty shell

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/src/index.ts`

- [ ] **Step 1: Create `apps/worker/package.json`**

```json
{
  "name": "@orbis/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "test": "echo \"no worker tests yet\"",
    "lint": "tsc --noEmit"
  },
  "dependencies": { "@orbis/db": "workspace:*" },
  "devDependencies": { "tsx": "^4.19.0", "typescript": "^5.6.0" }
}
```

- [ ] **Step 2: Create `apps/worker/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/worker/src/index.ts`**

```ts
// Phase 1+: cellular-automaton tick engine, matching engine, and AI agents.
// Phase 0 placeholder so the workspace package exists and resolves @orbis/db.
console.log("orbis worker: not implemented until Phase 1");
```

- [ ] **Step 4: Install and typecheck the whole workspace**

Run: `pnpm install && pnpm -r lint`
Expected: all packages typecheck with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "chore(worker): empty Phase 0 shell package"
```

---

## Task 16: Cloud provisioning runbook (manual — DSQL, Vercel, guardrails)

These steps create live infrastructure and cannot be unit-tested; they are the Definition-of-Done cloud + guardrail items. Capture them as a runbook and execute with user approval (per the user's infra policy: net-new resources only, each step run/approved, not silently applied). **Stop and confirm with the user before each AWS/Vercel mutation.**

**Files:**
- Create: `docs/superpowers/runbooks/phase-0-cloud-provisioning.md`

- [ ] **Step 1: Write the runbook file** with the following content:

```markdown
# Phase 0 Cloud Provisioning Runbook

## A. Verify DSQL region availability
- [ ] Confirm Aurora DSQL is available in a low-cost region for this account
      (e.g., us-east-1). Record the chosen region.

## B. Create the DSQL cluster (single-region)
- [ ] Create an Aurora DSQL cluster via the AWS console or:
      `aws dsql create-cluster --region <region>`
- [ ] Record the cluster endpoint host: `<cluster-id>.dsql.<region>.on.aws`

## C. IAM for the auth-token flow
- [ ] Ensure the local/dev IAM identity can call `dsql:DbConnectAdmin`
      on the cluster, and that the same permission is available to the
      Vercel deployment (via access-key env vars for Phase 0).

## D. Apply migrations to the live cluster
- [ ] Run with DSQL env set:
      `DB_MODE=dsql DSQL_HOST=<host> DSQL_REGION=<region> pnpm db:migrate`
- [ ] Expected: `applied 0001_init`, `applied 0002_indexes`.
      (Runner rewrites CREATE INDEX -> CREATE INDEX ASYNC for DSQL.)
- [ ] If async index syntax is rejected, consult current DSQL docs for the
      exact secondary-index DDL and update `transformForMode` accordingly.

## E. Seed the live cluster
- [ ] `DB_MODE=dsql DSQL_HOST=<host> DSQL_REGION=<region> pnpm db:seed`

## F. Smoke-test the live cluster
- [ ] `DB_MODE=dsql DSQL_HOST=<host> DSQL_REGION=<region> pnpm db:smoke`
- [ ] Expected: `smoke OK — migrations=[0001_init,0002_indexes] players=2`

## G. Deploy apps/web to Vercel
- [ ] Check for an existing Vercel project first (`vercel ls` /
      `.vercel/project.json`) — do not create a duplicate.
- [ ] Set Vercel project root to `apps/web`; install command `pnpm install`
      at repo root; build `next build`.
- [ ] Set env vars in Vercel: DB_MODE=dsql, DSQL_HOST, DSQL_REGION,
      AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, SESSION_SECRET.
- [ ] Deploy.

## H. Verify the live spine
- [ ] `curl https://<deployment>/api/health`
      Expected: {"ok":true,"migrations":["0001_init","0002_indexes"]}
- [ ] Visit `https://<deployment>/` — leaderboard shows seeded players.

## I. Cost guardrails (do before leaving anything running)
- [ ] AWS Budgets: create a low monthly threshold alert on the account.
- [ ] Vercel: enable Spend Management with an auto-pause cap.
- [ ] Confirm single-region only (no multi-region cluster yet).
```

- [ ] **Step 2: Commit the runbook**

```bash
git add docs/superpowers/runbooks/phase-0-cloud-provisioning.md
git commit -m "docs: Phase 0 cloud provisioning runbook"
```

- [ ] **Step 3: Execute the runbook with the user**

Walk through sections A–I above with the user, pausing for approval at each AWS/Vercel mutation. Phase 0 is complete when section H passes (live `/api/health` reads DSQL) and section I guardrails are active.

---

## Definition of Done (maps to spec §7)

- [ ] Local: `docker compose up` + `pnpm db:migrate` + `pnpm db:seed` succeed from a clean clone (Tasks 2, 5, 8).
- [ ] Local: `pnpm dev` serves `/` with seeded players; `/api/health` returns OK + migration version (Tasks 12, 13).
- [ ] Local: lint + tests green — connection, migrate, queries, session suites (Tasks 3, 4, 7, 14).
- [ ] Cloud: DSQL cluster provisioned; same migrations apply cleanly (Task 16 B, D).
- [ ] Cloud: `apps/web` deployed to Vercel; live `/api/health` reads the DSQL cluster over IAM auth (Task 16 G, H).
- [ ] Cloud: `pnpm db:smoke` passes against the live cluster (Task 16 F).
- [ ] Guardrails: AWS Budgets alert + Vercel Spend Management auto-pause active (Task 16 I).
```
