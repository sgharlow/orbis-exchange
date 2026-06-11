import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createPool } from "../src/connection.js";
import { applyMigrations } from "../src/migrate.js";
import { investExtraction, loadOwnerLevels, getPlayerState, INVEST_BASE_COST } from "../src/queries.js";

const pool = createPool();
const RICH = "11111111-1111-1111-1111-111111111111";
const POOR = "22222222-2222-2222-2222-222222222222";

beforeEach(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await applyMigrations(pool, "local");
  await pool.query(
    `INSERT INTO players (id, handle, kind, credits, home_region, created_at) VALUES
       ($1,'rich','human',10000,'us-east',now()),
       ($2,'poor','human',500,'us-east',now())`,
    [RICH, POOR]
  );
});
afterAll(async () => {
  await pool.end();
});

describe("investExtraction", () => {
  it("raises the level with an escalating, in-SQL cost", async () => {
    const a = await investExtraction(pool, RICH);
    expect(a).toEqual({ ok: true, level: 1, credits: String(10000 - INVEST_BASE_COST) }); // -1000
    const b = await investExtraction(pool, RICH);
    expect(b).toEqual({ ok: true, level: 2, credits: String(10000 - INVEST_BASE_COST - 2 * INVEST_BASE_COST) }); // -1000 -2000
  });

  it("rejects when the player can't afford the next level", async () => {
    expect(await investExtraction(pool, POOR)).toEqual({ ok: false, reason: "insufficient_credits" });
    const c = await pool.query("SELECT credits, extract_level FROM players WHERE id=$1", [POOR]);
    expect(c.rows[0]).toEqual({ credits: "500", extract_level: null }); // untouched
  });

  it("reports an unknown player", async () => {
    expect(await investExtraction(pool, "00000000-0000-0000-0000-000000000000")).toEqual({
      ok: false,
      reason: "unknown_player",
    });
  });
});

describe("loadOwnerLevels", () => {
  it("returns the level for players who own a cell in the region", async () => {
    await investExtraction(pool, RICH); // level 1
    await pool.query(
      `INSERT INTO cells (id, region, x, y, resource_type, density, owner_id, updated_gen)
         VALUES (1,'r0',0,0,'ore',80,$1,0)`,
      [RICH]
    );
    expect(await loadOwnerLevels(pool, "r0")).toEqual([{ owner_id: RICH, level: 1 }]);
  });
});

describe("getPlayerState", () => {
  it("returns balance, level, holdings, and owned-cell count", async () => {
    await investExtraction(pool, RICH); // level 1, credits 9000
    await pool.query("INSERT INTO inventory (player_id, commodity, qty) VALUES ($1,'ore',12)", [RICH]);
    await pool.query(
      `INSERT INTO cells (id, region, x, y, resource_type, density, owner_id, updated_gen) VALUES
         (1,'r0',0,0,'ore',50,$1,0),(2,'r0',1,0,'ore',50,$1,0)`,
      [RICH]
    );
    expect(await getPlayerState(pool, RICH)).toEqual({
      handle: "rich",
      credits: "9000",
      level: 1,
      inventory: [{ commodity: "ore", qty: "12" }],
      owned_cells: 2,
    });
  });

  it("returns null for an unknown player", async () => {
    expect(await getPlayerState(pool, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
