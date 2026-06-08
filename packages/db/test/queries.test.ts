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
