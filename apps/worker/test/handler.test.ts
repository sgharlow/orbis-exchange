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
