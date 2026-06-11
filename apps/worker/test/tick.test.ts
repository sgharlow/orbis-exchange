import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createPool, applyMigrations } from "@orbis/db";
import { runTick } from "../src/tick.js";

const pool = createPool();

beforeEach(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await applyMigrations(pool, "local");
  // region 'rt': a "T" of three healthy cells over one fallthrough cell.
  // After one tick: (1,1) & (3,1) wither (n=1), (2,1) blooms (n=2),
  // (2,2)=37 is unchanged (sits between REGEN_FLOOR and HEALTHY_THRESHOLD).
  await pool.query(
    `INSERT INTO cells (id, region, x, y, resource_type, density, owner_id, updated_gen) VALUES
       (1,'rt',1,1,'ore', 50, NULL, 0),
       (2,'rt',2,1,'ore', 50, NULL, 0),
       (3,'rt',3,1,'ore', 50, NULL, 0),
       (4,'rt',2,2,'ore', 37, NULL, 0)`
  );
});
afterAll(async () => {
  await pool.end();
});

describe("runTick (load -> CA -> persist deltas)", () => {
  it("persists only changed cells, stamps the generation, and records the tick", async () => {
    const result = await runTick(pool, "rt", 1);
    expect(result).toEqual({ generation: 1, cellsChanged: 3 });

    const { rows } = await pool.query(
      "SELECT id, density, updated_gen FROM cells ORDER BY id"
    );
    expect(rows).toEqual([
      { id: "1", density: 44, updated_gen: "1" }, // wither
      { id: "2", density: 54, updated_gen: "1" }, // bloom
      { id: "3", density: 44, updated_gen: "1" }, // wither
      { id: "4", density: 37, updated_gen: "0" }, // unchanged -> never written
    ]);

    const tick = await pool.query("SELECT generation, cells_changed FROM ticks");
    expect(tick.rows).toEqual([{ generation: "1", cells_changed: 3 }]);
  });

  it("applies extraction pressure on the loaded grid", async () => {
    // 4 extra draw on the blooming center: 54 - 4 = 50
    const ext = new Map([["2,1", 4]]);
    await runTick(pool, "rt", 1, { extraction: ext });
    const { rows } = await pool.query("SELECT density FROM cells WHERE id = 2");
    expect(rows[0].density).toBe(50);
  });
});
