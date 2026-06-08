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
