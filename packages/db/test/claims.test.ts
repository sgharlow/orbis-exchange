import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createPool } from "../src/connection.js";
import { applyMigrations } from "../src/migrate.js";
import { claimCell, findClaimableCell, persistYields, CLAIM_COST } from "../src/queries.js";

const pool = createPool();
const P = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

async function owner(id: number): Promise<string | null> {
  return (await pool.query("SELECT owner_id FROM cells WHERE id = $1", [id])).rows[0]?.owner_id ?? null;
}
async function credits(id: string): Promise<string> {
  return (await pool.query("SELECT credits FROM players WHERE id = $1", [id])).rows[0].credits;
}

beforeEach(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await applyMigrations(pool, "local");
  await pool.query(
    `INSERT INTO players (id, handle, kind, credits, home_region, created_at)
       VALUES ($1,'p','human',600,'us-east', now())`,
    [P]
  );
  await pool.query(
    `INSERT INTO cells (id, region, x, y, resource_type, density, owner_id, updated_gen) VALUES
       (1,'rc',0,0,'ore',    90, NULL,   0),
       (2,'rc',1,0,'energy', 70, NULL,   0),
       (3,'rc',2,0,'ore',    50, $1,     0)`,
    [OTHER]
  );
});
afterAll(async () => {
  await pool.end();
});

describe("claimCell", () => {
  it("claims an unowned cell and debits the claim cost", async () => {
    expect(await claimCell(pool, P, 1)).toEqual({ claimed: true });
    expect(await owner(1)).toBe(P);
    expect(await credits(P)).toBe(String(600 - CLAIM_COST));
  });

  it("rejects a cell already owned by someone else", async () => {
    expect(await claimCell(pool, P, 3)).toEqual({ claimed: false, reason: "taken" });
    expect(await owner(3)).toBe(OTHER);
    expect(await credits(P)).toBe("600"); // not charged
  });

  it("rejects an unknown cell", async () => {
    expect(await claimCell(pool, P, 999)).toEqual({ claimed: false, reason: "unknown_cell" });
  });

  it("rejects (and does not claim) when the player can't afford it", async () => {
    await claimCell(pool, P, 1); // 600 -> 100
    expect(await claimCell(pool, P, 2)).toEqual({ claimed: false, reason: "insufficient_credits" });
    expect(await owner(2)).toBeNull(); // rolled back — still unclaimed
    expect(await credits(P)).toBe("100");
  });
});

describe("findClaimableCell", () => {
  it("returns the highest-density unclaimed cell", async () => {
    expect(await findClaimableCell(pool, "rc")).toEqual({ id: "1", density: 90 });
  });

  it("returns null when nothing is claimable", async () => {
    expect(await findClaimableCell(pool, "empty")).toBeNull();
  });
});

describe("persistYields", () => {
  it("accumulates mined resource into inventory", async () => {
    await persistYields(pool, [{ player_id: P, commodity: "ore", qty: 8 }]);
    await persistYields(pool, [{ player_id: P, commodity: "ore", qty: 5 }]);
    const inv = await pool.query("SELECT qty FROM inventory WHERE player_id=$1 AND commodity='ore'", [P]);
    expect(inv.rows[0].qty).toBe("13");
  });
});
