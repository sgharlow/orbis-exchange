import type pg from "pg";
import { createPool } from "./connection.js";
import { generateWorld, type CellSeed } from "./world.js";

const COMMODITIES = ["ore", "energy", "biomass", "rare"] as const;

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

    console.log(`seed complete (${world.length} cells)`);
  } finally {
    await pool.end();
  }
}

seed().catch((e) => { console.error(e); process.exit(1); });
