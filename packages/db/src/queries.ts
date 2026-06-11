import type pg from "pg";
import type { LeaderboardEntry } from "./types.js";

// Net worth = credits + inventory valued at last market price (spec §4.3).
// Commodities with no trade yet have a NULL last_price and contribute nothing.
export async function getLeaderboard(pool: pg.Pool): Promise<LeaderboardEntry[]> {
  const { rows } = await pool.query<LeaderboardEntry>(
    `SELECT p.id, p.handle, p.kind,
            (p.credits + COALESCE(SUM(i.qty * ms.last_price), 0))::text AS net_worth
       FROM players p
       LEFT JOIN inventory i ON i.player_id = p.id
       LEFT JOIN market_state ms ON ms.commodity = i.commodity
      GROUP BY p.id, p.handle, p.kind, p.credits
      ORDER BY (p.credits + COALESCE(SUM(i.qty * ms.last_price), 0)) DESC, p.handle ASC
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

// An agent and its owning player's spendable balance, for the agent runner.
export interface AgentRow {
  player_id: string;
  strategy: string;
  params: { commodity: string; size: number; margin?: number; band?: number; lookback?: number };
  credits: string;
}

export async function loadAgents(pool: pg.Pool): Promise<AgentRow[]> {
  const { rows } = await pool.query<AgentRow>(
    `SELECT a.player_id, a.strategy, a.params, p.credits
       FROM agents a JOIN players p ON p.id = a.player_id
      ORDER BY a.player_id`
  );
  return rows;
}

// Credits a fresh human player starts with so a new session can trade.
export const STARTING_CREDITS = 10_000;

// Idempotently create a player row for a session identity. New players join with
// STARTING_CREDITS and no inventory; existing players are left untouched.
export async function ensurePlayer(
  pool: pg.Pool,
  player: { id: string; handle: string; home_region?: string }
): Promise<void> {
  await pool.query(
    `INSERT INTO players (id, handle, kind, credits, home_region, created_at)
       VALUES ($1, $2, 'human', $3::bigint, $4, now())
       ON CONFLICT (id) DO NOTHING`,
    [player.id, player.handle, STARTING_CREDITS, player.home_region ?? "us-east"]
  );
}

// One cell as the world view needs it: position, type (for hue), density (for
// brightness). Read-only render path; keeps owner/id out of the snapshot.
export interface WorldCell {
  x: number;
  y: number;
  resource_type: string;
  density: number;
}

export async function getWorld(pool: pg.Pool, region: string): Promise<WorldCell[]> {
  const { rows } = await pool.query<WorldCell>(
    `SELECT x, y, resource_type, density FROM cells WHERE region = $1 ORDER BY y, x`,
    [region]
  );
  return rows;
}

// Cells changed strictly after `sinceGen` — the delta the realtime stream pushes
// (resource_type never changes, so x/y/density is enough to patch the client).
export async function getWorldSince(
  pool: pg.Pool,
  region: string,
  sinceGen: number
): Promise<{ x: number; y: number; density: number }[]> {
  const { rows } = await pool.query<{ x: number; y: number; density: number }>(
    `SELECT x, y, density FROM cells WHERE region = $1 AND updated_gen > $2 ORDER BY y, x`,
    [region, sinceGen]
  );
  return rows;
}

// The most recent committed generation (0 if the world has never ticked).
export async function getLatestGeneration(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ gen: string | null }>(
    "SELECT max(generation)::text AS gen FROM ticks"
  );
  return rows[0]?.gen ? Number(rows[0].gen) : 0;
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
