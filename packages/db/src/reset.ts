import { createPool } from "./connection.js";

// One-off world reset: return the live world to the clean seeded baseline (agents
// only, empty field, fresh prices) after the no-cap claiming runaway distorted it.
// Releases every cell, clears the order book + all inventory, removes human
// players, and resets agents to their seed credits/inventory. Trade history is
// left in place (it refreshes naturally) to avoid large DSQL delete transactions.
const AGENT_CREDITS = 1_000_000;
const AGENT_INVENTORY = 5_000;

// Delete a (large) table in bounded batches so a single statement never exceeds
// the DSQL per-transaction row cap.
async function batchDelete(pool: import("pg").Pool, table: string, batch = 500): Promise<number> {
  let total = 0;
  for (;;) {
    const r = await pool.query(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} LIMIT ${batch})`);
    const n = r.rowCount ?? 0;
    total += n;
    if (n < batch) break;
  }
  return total;
}

async function reset(): Promise<void> {
  const pool = createPool();
  try {
    const cells = await pool.query(
      "UPDATE cells SET owner_id = NULL, list_price = NULL WHERE owner_id IS NOT NULL OR list_price IS NOT NULL"
    );
    console.log("cells released:", cells.rowCount);

    const orders = await batchDelete(pool, "orders");
    console.log("orders cleared:", orders);

    const inv = await pool.query("DELETE FROM inventory");
    console.log("inventory cleared:", inv.rowCount);

    const humans = await pool.query("DELETE FROM players WHERE kind = 'human'");
    console.log("human players removed:", humans.rowCount);

    // Reset both the strategic opponents ('agent') and the infrastructure liquidity
    // bots ('market' — makers + pulse) so the whole bot economy returns to baseline.
    const ag = await pool.query("UPDATE players SET credits = $1::bigint WHERE kind IN ('agent', 'market')", [
      AGENT_CREDITS,
    ]);
    console.log("agents reset to baseline credits:", ag.rowCount);

    const reinv = await pool.query(
      `INSERT INTO inventory (player_id, commodity, qty)
         SELECT player_id, params->>'commodity', $1::bigint FROM agents
         ON CONFLICT (player_id, commodity) DO UPDATE SET qty = $1::bigint`,
      [AGENT_INVENTORY]
    );
    console.log("agent inventory re-seeded:", reinv.rowCount);

    const ms = await pool.query("UPDATE market_state SET last_price = 100, best_bid = NULL, best_ask = NULL");
    console.log("market_state reset:", ms.rowCount);

    console.log("world reset complete");
  } finally {
    await pool.end();
  }
}

reset().catch((e) => {
  console.error(e);
  process.exit(1);
});
