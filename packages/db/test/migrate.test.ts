import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createPool } from "../src/connection.js";
import { applyMigrations, appliedVersions, splitStatements } from "../src/migrate.js";

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

describe("splitStatements", () => {
  it("splits multiple statements and ignores comment-only lines", () => {
    const sql = `-- leading comment
CREATE TABLE a (id int);
CREATE TABLE b (id int);
`;
    expect(splitStatements(sql)).toEqual([
      "CREATE TABLE a (id int)",
      "CREATE TABLE b (id int)",
    ]);
  });

  it("does not split on semicolons inside inline comments", () => {
    // Regression: '-- World cells; demo grid' must not produce a bare 'demo' statement.
    const sql = `-- World cells; demo grid
CREATE TABLE cells (id INT);
`;
    expect(splitStatements(sql)).toEqual(["CREATE TABLE cells (id INT)"]);
  });

  it("returns empty array for comment-only / blank input", () => {
    expect(splitStatements("-- just a comment\n")).toEqual([]);
    expect(splitStatements("   \n  ")).toEqual([]);
  });
});
