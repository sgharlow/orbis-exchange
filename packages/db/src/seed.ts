import { createPool } from "./connection.js";

const COMMODITIES = ["ore", "energy", "biomass", "rare"] as const;

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
    console.log("seed complete");
  } finally {
    await pool.end();
  }
}

seed().catch((e) => { console.error(e); process.exit(1); });
