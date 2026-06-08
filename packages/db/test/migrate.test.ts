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
