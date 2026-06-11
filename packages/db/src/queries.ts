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

// One cell as the simulation worker needs it for a tick: id (BIGINT -> string
// from pg), grid coordinates, and current density. x/y/density are INT/SMALLINT
// so pg returns them as numbers.
export interface RegionCell {
  id: string;
  x: number;
  y: number;
  density: number;
}

export async function loadRegionCells(pool: pg.Pool, region: string): Promise<RegionCell[]> {
  const { rows } = await pool.query<RegionCell>(
    `SELECT id, x, y, density FROM cells WHERE region = $1 ORDER BY y, x`,
    [region]
  );
  return rows;
}

export interface CellUpdate {
  id: string | number;
  density: number;
}

// Persist one tick: write ONLY the changed cells (the cost guardrail — never the
// full grid; spec §5.2/§11) and record the tick. One short transaction; the
// region's single worker is the only writer, so no OCC contention here (that
// matters for settlement, §6.1, not for cell deltas).
export async function persistTick(
  pool: pg.Pool,
  generation: number,
  updates: CellUpdate[]
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO ticks (generation, started_at, completed_at, cells_changed)
       VALUES ($1, now(), now(), $2)`,
      [generation, updates.length]
    );
    for (const u of updates) {
      await client.query(`UPDATE cells SET density = $2, updated_gen = $3 WHERE id = $1`, [
        u.id,
        u.density,
        generation,
      ]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
