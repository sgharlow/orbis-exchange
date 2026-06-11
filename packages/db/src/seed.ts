import type pg from "pg";
import { createPool } from "./connection.js";
import { generateWorld, type CellSeed } from "./world.js";

const COMMODITIES = ["ore", "energy", "biomass", "rare"] as const;

// Algorithmic agents that seed liquidity and act as the opponent (spec §4.5).
// A market maker per commodity plus a momentum and a value bot on the demo
// commodity. Each starts well-capitalised and holding inventory so makers can
// quote both sides from the first tick.
const AGENT_CREDITS = 1_000_000;
const AGENT_INVENTORY = 5_000;
const AGENTS = [
  { id: "a0000000-0000-0000-0000-0000000000a1", handle: "mm-ore", strategy: "maker", params: { commodity: "ore", size: 5, margin: 2 } },
  { id: "a0000000-0000-0000-0000-0000000000a2", handle: "mm-energy", strategy: "maker", params: { commodity: "energy", size: 5, margin: 2 } },
  { id: "a0000000-0000-0000-0000-0000000000a3", handle: "mm-biomass", strategy: "maker", params: { commodity: "biomass", size: 5, margin: 2 } },
  { id: "a0000000-0000-0000-0000-0000000000a4", handle: "mm-rare", strategy: "maker", params: { commodity: "rare", size: 5, margin: 2 } },
  { id: "a0000000-0000-0000-0000-0000000000a5", handle: "momentum-ore", strategy: "momentum", params: { commodity: "ore", size: 3, lookback: 5 } },
  { id: "a0000000-0000-0000-0000-0000000000a6", handle: "value-ore", strategy: "value", params: { commodity: "ore", size: 3, band: 0.04, lookback: 10 } },
  { id: "a0000000-0000-0000-0000-0000000000a7", handle: "scout-r0", strategy: "scout", params: { commodity: "ore", size: 1, region: "r0" } },
  { id: "a0000000-0000-0000-0000-0000000000a8", handle: "arb-bot", strategy: "arb", params: { commodity: "ore", size: 3, lookback: 10 } },
] as const;

async function seedAgents(pool: pg.Pool): Promise<void> {
  for (const a of AGENTS) {
    await pool.query(
      `INSERT INTO players (id, handle, kind, credits, home_region, created_at)
         VALUES ($1, $2, 'agent', $3::bigint, 'us-east', now())
         ON CONFLICT (id) DO NOTHING`,
      [a.id, a.handle, AGENT_CREDITS]
    );
    await pool.query(
      `INSERT INTO agents (player_id, strategy, params) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (player_id) DO NOTHING`,
      [a.id, a.strategy, JSON.stringify(a.params)]
    );
    await pool.query(
      `INSERT INTO inventory (player_id, commodity, qty) VALUES ($1, $2, $3::bigint)
         ON CONFLICT (player_id, commodity) DO NOTHING`,
      [a.id, a.params.commodity, AGENT_INVENTORY]
    );
  }
}

// Insert cells in bounded batches: keeps each statement well under pg's parameter
// cap and each transaction short (DSQL-friendly). Idempotent via ON CONFLICT.
async function insertCells(pool: pg.Pool, cells: CellSeed[], batchSize = 500): Promise<void> {
  for (let i = 0; i < cells.length; i += batchSize) {
    const batch = cells.slice(i, i + batchSize);
    const values: string[] = [];
    const params: unknown[] = [];
    batch.forEach((c, j) => {
      const b = j * 7;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`);
      params.push(c.id, c.region, c.x, c.y, c.resource_type, c.density, c.updated_gen);
    });
    await pool.query(
      `INSERT INTO cells (id, region, x, y, resource_type, density, updated_gen)
       VALUES ${values.join(",")}
       ON CONFLICT (id) DO NOTHING`,
      params
    );
  }
}

async function seed(): Promise<void> {
  const pool = createPool();
  try {
    await pool.query(
      `INSERT INTO players (id, handle, kind, credits, home_region, created_at) VALUES
         ('11111111-1111-1111-1111-111111111111','alice','human', 10000,'us-east', now()),
         ('22222222-2222-2222-2222-222222222222','bot-maker','agent', 10000,'us-east', now())
       ON CONFLICT (id) DO NOTHING`
    );
    for (const c of COMMODITIES) {
      await pool.query(
        `INSERT INTO market_state (commodity, last_price, best_bid, best_ask, generation)
         VALUES ($1, 100, NULL, NULL, 0)
         ON CONFLICT (commodity) DO NOTHING`,
        [c]
      );
    }

    // The bounded demo world: one 64x64 region (spec §4.1, §11).
    const world = generateWorld();
    await insertCells(pool, world);

    await seedAgents(pool);

    console.log(`seed complete (${world.length} cells, ${AGENTS.length} agents)`);
  } finally {
    await pool.end();
  }
}

seed().catch((e) => { console.error(e); process.exit(1); });
