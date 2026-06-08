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
