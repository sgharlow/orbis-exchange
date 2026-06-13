import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createPool } from "../src/connection.js";
import { applyMigrations } from "../src/migrate.js";
import {
  loadRegionCells,
  persistTick,
  getWorld,
  getWorldSince,
  getLatestGeneration,
  claimGeneration,
} from "../src/queries.js";

const pool = createPool();

// Recording proxy over a real pool: counts cell rows modified per committed
// transaction, so we can assert persistTick never exceeds Aurora DSQL's
// per-transaction modified-row limit (~3000). Local Postgres has no such cap, so
// we verify the CONTRACT (bounded transactions) rather than the DSQL error itself.
// Uses ONE dedicated client with a no-op release, so the shared pool's connections
// are never monkeypatched (which would leak across tests).
async function recordingPool(real: ReturnType<typeof createPool>) {
  const txCellRows: number[] = [];
  let current = 0;
  const client = await real.connect();
  const run = client.query.bind(client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instrumented = async (sql: any, params?: any) => {
    const text: string = typeof sql === "string" ? sql : sql.text;
    if (/^\s*BEGIN/i.test(text)) current = 0;
    const res = await run(sql, params);
    if (/\bcells\b/i.test(text) && /update|insert/i.test(text)) current += res?.rowCount ?? 0;
    if (/^\s*COMMIT/i.test(text)) txCellRows.push(current);
    return res;
  };
  const proxy = {
    connect: async () => ({ query: instrumented, release: () => {} }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: (sql: any, params?: any) => real.query(sql, params),
  };
  return {
    proxy: proxy as unknown as ReturnType<typeof createPool>,
    txCellRows,
    dispose: () => client.release(),
  };
}

async function seedCells() {
  // region 'rt': three cells at gen 0
  await pool.query(
    `INSERT INTO cells (id, region, x, y, resource_type, density, owner_id, updated_gen) VALUES
       (1,'rt',0,0,'ore', 50, NULL, 0),
       (2,'rt',1,0,'ore', 20, NULL, 0),
       (3,'rt',2,0,'ore', 80, NULL, 0)`
  );
}

beforeEach(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await applyMigrations(pool, "local");
  await seedCells();
});
afterAll(async () => {
  await pool.end();
});

describe("loadRegionCells", () => {
  it("returns a region's cells ordered by y, x with numeric x/y/density", async () => {
    const cells = await loadRegionCells(pool, "rt");
    expect(cells.map((c) => c.density)).toEqual([50, 20, 80]);
    expect(cells[0]).toMatchObject({ x: 0, y: 0, density: 50 });
    expect(typeof cells[0].id).toBe("string"); // BIGINT surfaces as string
  });

  it("scopes to the requested region", async () => {
    expect(await loadRegionCells(pool, "other")).toEqual([]);
  });
});

describe("persistTick", () => {
  it("writes only the changed cells, stamps updated_gen, and records the tick", async () => {
    await persistTick(pool, 1, [
      { id: 1, density: 44 },
      { id: 3, density: 76 },
    ]);

    const { rows } = await pool.query(
      "SELECT id, density, updated_gen FROM cells ORDER BY id"
    );
    expect(rows).toEqual([
      { id: "1", density: 44, updated_gen: "1" },
      { id: "2", density: 20, updated_gen: "0" }, // untouched — not in the delta set
      { id: "3", density: 76, updated_gen: "1" },
    ]);

    const tick = await pool.query("SELECT generation, cells_changed FROM ticks");
    expect(tick.rows).toEqual([{ generation: "1", cells_changed: 2 }]);
  });

  it("bounds each transaction to the batch size of cell rows (DSQL row-limit safety)", async () => {
    await pool.query(
      `INSERT INTO cells (id, region, x, y, resource_type, density, updated_gen) VALUES
         (10,'rb',0,1,'ore',10,0),(11,'rb',1,1,'ore',10,0),(12,'rb',2,1,'ore',10,0),
         (13,'rb',3,1,'ore',10,0),(14,'rb',4,1,'ore',10,0)`
    );
    const { proxy, txCellRows, dispose } = await recordingPool(pool);

    try {
      await persistTick(
        proxy,
        5,
        [
          { id: 10, density: 1 },
          { id: 11, density: 2 },
          { id: 12, density: 3 },
          { id: 13, density: 4 },
          { id: 14, density: 5 },
        ],
        2 // batchSize — force chunking with a tiny cap
      );
    } finally {
      dispose();
    }

    // The DSQL contract: no single transaction modifies more than the batch size.
    expect(Math.max(...txCellRows)).toBeLessThanOrEqual(2);
    // And it genuinely chunked: 5 cells / batch 2 => 3 cell-writing transactions.
    expect(txCellRows.filter((n) => n > 0).length).toBe(3);

    // Correctness preserved: every cell updated + stamped, tick recorded.
    const { rows } = await pool.query(
      "SELECT id, density, updated_gen FROM cells WHERE region='rb' ORDER BY id"
    );
    expect(rows).toEqual([
      { id: "10", density: 1, updated_gen: "5" },
      { id: "11", density: 2, updated_gen: "5" },
      { id: "12", density: 3, updated_gen: "5" },
      { id: "13", density: 4, updated_gen: "5" },
      { id: "14", density: 5, updated_gen: "5" },
    ]);
    const tick = await pool.query("SELECT generation, cells_changed FROM ticks");
    expect(tick.rows).toEqual([{ generation: "5", cells_changed: 5 }]);
  });

  it("records a no-op tick with zero changes", async () => {
    await persistTick(pool, 7, []);
    const tick = await pool.query("SELECT generation, cells_changed FROM ticks");
    expect(tick.rows).toEqual([{ generation: "7", cells_changed: 0 }]);
  });

  it("completes a previously claimed generation instead of colliding", async () => {
    await claimGeneration(pool, 9);
    await persistTick(pool, 9, [{ id: 1, density: 41 }]);
    const { rows } = await pool.query(
      "SELECT generation, cells_changed, (completed_at IS NOT NULL) AS done FROM ticks"
    );
    expect(rows).toEqual([{ generation: "9", cells_changed: 1, done: true }]);
  });
});

describe("claimGeneration", () => {
  it("claims a fresh generation exactly once — the second claimant is told no", async () => {
    expect(await claimGeneration(pool, 1)).toBe(true);
    expect(await claimGeneration(pool, 1)).toBe(false);
    const { rows } = await pool.query("SELECT generation, completed_at FROM ticks");
    expect(rows).toEqual([{ generation: "1", completed_at: null }]);
  });
});

describe("world view reads", () => {
  it("getWorld returns render fields ordered by y, x", async () => {
    const world = await getWorld(pool, "rt");
    expect(world).toEqual([
      { id: "1", x: 0, y: 0, resource_type: "ore", density: 50, owner_id: null, list_price: null },
      { id: "2", x: 1, y: 0, resource_type: "ore", density: 20, owner_id: null, list_price: null },
      { id: "3", x: 2, y: 0, resource_type: "ore", density: 80, owner_id: null, list_price: null },
    ]);
  });

  it("getLatestGeneration is 0 before any tick and tracks the newest after", async () => {
    expect(await getLatestGeneration(pool)).toBe(0);
    await persistTick(pool, 3, []);
    await persistTick(pool, 5, []);
    expect(await getLatestGeneration(pool)).toBe(5);
  });

  it("getWorldSince returns only cells changed after a generation (the SSE delta)", async () => {
    // tick id 1 -> gen 1 (updated_gen 1); the others stay at updated_gen 0
    await persistTick(pool, 1, [{ id: 1, density: 44 }]);
    const delta = await getWorldSince(pool, "rt", 0);
    expect(delta).toEqual([{ x: 0, y: 0, density: 44 }]);
    expect(await getWorldSince(pool, "rt", 1)).toEqual([]); // nothing after gen 1
  });
});
