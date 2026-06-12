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
// from pg), grid coordinates, current density, owner (null = unclaimed), and
// resource type (so mining credits the right commodity). x/y/density are
// INT/SMALLINT so pg returns them as numbers.
export interface RegionCell {
  id: string;
  x: number;
  y: number;
  density: number;
  owner_id: string | null;
  resource_type: string;
}

export async function loadRegionCells(pool: pg.Pool, region: string): Promise<RegionCell[]> {
  const { rows } = await pool.query<RegionCell>(
    `SELECT id, x, y, density, owner_id, resource_type FROM cells WHERE region = $1 ORDER BY y, x`,
    [region]
  );
  return rows;
}

// Cost in credits to claim an unclaimed cell (spec §4.4).
export const CLAIM_COST = 500;

// Claim an unclaimed cell: assert it is unowned and the player can afford it,
// set ownership and debit credits, all in one transaction (conditional writes,
// DSQL-safe). No double-claim, no negative balance.
export async function claimCell(
  pool: pg.Pool,
  playerId: string,
  cellId: string | number
): Promise<{ claimed: boolean; reason?: "taken" | "insufficient_credits" | "unknown_cell" }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claim = await client.query(
      "UPDATE cells SET owner_id = $1 WHERE id = $2 AND owner_id IS NULL",
      [playerId, cellId]
    );
    if ((claim.rowCount ?? 0) === 0) {
      const exists = await client.query("SELECT 1 FROM cells WHERE id = $1", [cellId]);
      await client.query("ROLLBACK");
      return { claimed: false, reason: (exists.rowCount ?? 0) > 0 ? "taken" : "unknown_cell" };
    }
    const debit = await client.query(
      "UPDATE players SET credits = credits - $1::bigint WHERE id = $2 AND credits >= $1::bigint",
      [CLAIM_COST, playerId]
    );
    if ((debit.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return { claimed: false, reason: "insufficient_credits" };
    }
    await client.query("COMMIT");
    return { claimed: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Everything the player dashboard shows: balance, extraction level, holdings,
// and how many cells they own (spec §10).
export interface PlayerState {
  handle: string;
  credits: string;
  level: number;
  inventory: { commodity: string; qty: string }[];
  owned_cells: number;
}

export async function getPlayerState(pool: pg.Pool, playerId: string): Promise<PlayerState | null> {
  const p = await pool.query<{ handle: string; credits: string; level: number }>(
    "SELECT handle, credits, COALESCE(extract_level, 0) AS level FROM players WHERE id = $1",
    [playerId]
  );
  if (!p.rows[0]) return null;
  const inv = await pool.query<{ commodity: string; qty: string }>(
    "SELECT commodity, qty FROM inventory WHERE player_id = $1 AND qty > 0 ORDER BY commodity",
    [playerId]
  );
  const owned = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM cells WHERE owner_id = $1",
    [playerId]
  );
  return {
    handle: p.rows[0].handle,
    credits: p.rows[0].credits,
    level: p.rows[0].level,
    inventory: inv.rows,
    owned_cells: owned.rows[0].n,
  };
}

// Base credit cost to raise extraction by one level; the Nth upgrade costs N×base.
export const INVEST_BASE_COST = 1000;

// Buy one extraction level: escalating cost computed + asserted in one statement
// (DSQL-safe OCC). Returns the new level + balance, or why it failed.
export async function investExtraction(
  pool: pg.Pool,
  playerId: string
): Promise<{ ok: true; level: number; credits: string } | { ok: false; reason: "insufficient_credits" | "unknown_player" }> {
  const { rows } = await pool.query<{ extract_level: number; credits: string }>(
    `UPDATE players
        SET extract_level = COALESCE(extract_level, 0) + 1,
            credits = credits - ((COALESCE(extract_level, 0) + 1) * $2::bigint)
      WHERE id = $1 AND credits >= ((COALESCE(extract_level, 0) + 1) * $2::bigint)
      RETURNING extract_level, credits`,
    [playerId, INVEST_BASE_COST]
  );
  if (rows[0]) return { ok: true, level: rows[0].extract_level, credits: rows[0].credits };
  const exists = await pool.query("SELECT 1 FROM players WHERE id = $1", [playerId]);
  return { ok: false, reason: (exists.rowCount ?? 0) > 0 ? "insufficient_credits" : "unknown_player" };
}

// Extraction level for every player that owns a cell in the region (for mining).
export async function loadOwnerLevels(
  pool: pg.Pool,
  region: string
): Promise<{ owner_id: string; level: number }[]> {
  const { rows } = await pool.query<{ owner_id: string; level: number }>(
    `SELECT p.id AS owner_id, COALESCE(p.extract_level, 0) AS level
       FROM players p
      WHERE p.id IN (SELECT DISTINCT owner_id FROM cells WHERE region = $1 AND owner_id IS NOT NULL)`,
    [region]
  );
  return rows;
}

// The most attractive unclaimed cell in a region (highest density) — what a
// scout agent goes after.
export async function findClaimableCell(
  pool: pg.Pool,
  region: string
): Promise<{ id: string; density: number } | null> {
  const { rows } = await pool.query<{ id: string; density: number }>(
    `SELECT id, density FROM cells
       WHERE region = $1 AND owner_id IS NULL
       ORDER BY density DESC, id ASC LIMIT 1`,
    [region]
  );
  return rows[0] ?? null;
}

// List (or, with price=null, unlist) an owned cell for sale (spec §4.4).
export async function listCell(
  pool: pg.Pool,
  playerId: string,
  cellId: string | number,
  price: number | null
): Promise<{ listed: boolean; reason?: "not_owner" }> {
  const { rowCount } = await pool.query(
    "UPDATE cells SET list_price = $1 WHERE id = $2 AND owner_id = $3",
    [price, cellId, playerId]
  );
  if ((rowCount ?? 0) === 0) return { listed: false, reason: "not_owner" };
  return { listed: price !== null };
}

// Buy a listed cell from its owner: pay the list price and transfer ownership in
// one transaction (conditional writes; DSQL-safe). The new owner then mines it.
export async function buyListedCell(
  pool: pg.Pool,
  buyerId: string,
  cellId: string | number
): Promise<{ bought: boolean; reason?: "not_listed" | "own_cell" | "insufficient_credits" | "conflict"; price?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cell = (
      await client.query<{ owner_id: string | null; list_price: string | null }>(
        "SELECT owner_id, list_price FROM cells WHERE id = $1",
        [cellId]
      )
    ).rows[0];
    if (!cell || cell.list_price === null) {
      await client.query("ROLLBACK");
      return { bought: false, reason: "not_listed" };
    }
    if (cell.owner_id === buyerId) {
      await client.query("ROLLBACK");
      return { bought: false, reason: "own_cell" };
    }
    const price = cell.list_price;
    const seller = cell.owner_id!;
    const debit = await client.query(
      "UPDATE players SET credits = credits - $1::bigint WHERE id = $2 AND credits >= $1::bigint",
      [price, buyerId]
    );
    if ((debit.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return { bought: false, reason: "insufficient_credits" };
    }
    const xfer = await client.query(
      "UPDATE cells SET owner_id = $1, list_price = NULL WHERE id = $2 AND list_price = $3::bigint AND owner_id = $4",
      [buyerId, cellId, price, seller]
    );
    if ((xfer.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return { bought: false, reason: "conflict" };
    }
    await client.query("UPDATE players SET credits = credits + $1::bigint WHERE id = $2", [price, seller]);
    await client.query("COMMIT");
    return { bought: true, price };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Credit mined resource to owners' inventories (one short transaction).
export async function persistYields(
  pool: pg.Pool,
  yields: { player_id: string; commodity: string; qty: number }[]
): Promise<void> {
  if (yields.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const y of yields) {
      await client.query(
        `INSERT INTO inventory (player_id, commodity, qty) VALUES ($1, $2, $3::bigint)
           ON CONFLICT (player_id, commodity) DO UPDATE SET qty = inventory.qty + EXCLUDED.qty`,
        [y.player_id, y.commodity, y.qty]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// An agent and its owning player's spendable balance, for the agent runner.
export interface AgentRow {
  player_id: string;
  strategy: string;
  params: {
    commodity: string;
    size: number;
    margin?: number;
    band?: number;
    lookback?: number;
    region?: string;
  };
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

// One cell as the world view needs it: id (to claim by), position, type (hue),
// density (brightness), and owner (null = unclaimed; drives the outline).
export interface WorldCell {
  id: string;
  x: number;
  y: number;
  resource_type: string;
  density: number;
  owner_id: string | null;
}

export async function getWorld(pool: pg.Pool, region: string): Promise<WorldCell[]> {
  const { rows } = await pool.query<WorldCell>(
    `SELECT id, x, y, resource_type, density, owner_id FROM cells WHERE region = $1 ORDER BY y, x`,
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

// Atomically claim a generation before computing a tick. The ticks row IS the
// lock: ticks_pkey lets exactly one worker insert generation N, so overlapping
// scheduled invocations skip cleanly instead of colliding mid-tick (spec §5.2).
// persistTick later completes the same row (completed_at + cells_changed).
export async function claimGeneration(pool: pg.Pool, generation: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO ticks (generation, started_at) VALUES ($1, now())
       ON CONFLICT (generation) DO NOTHING`,
    [generation]
  );
  return (rowCount ?? 0) > 0;
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
         VALUES ($1, now(), now(), $2)
         ON CONFLICT (generation) DO UPDATE
           SET completed_at = now(), cells_changed = EXCLUDED.cells_changed`,
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
