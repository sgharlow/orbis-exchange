import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createPool, applyMigrations } from "@orbis/db";
import { runAgents } from "../src/run-agents.js";

const pool = createPool();

const MAKER = "a0000000-0000-0000-0000-000000000001";
const VALUE = "a0000000-0000-0000-0000-000000000002";
const SELLER = "b0000000-0000-0000-0000-000000000003";

async function addAgent(id: string, handle: string, strategy: string, params: object, credits = 100000) {
  await pool.query(
    `INSERT INTO players (id, handle, kind, credits, home_region, created_at)
       VALUES ($1, $2, 'agent', $3::bigint, 'us-east', now())`,
    [id, handle, credits]
  );
  await pool.query("INSERT INTO agents (player_id, strategy, params) VALUES ($1, $2, $3::jsonb)", [
    id,
    strategy,
    JSON.stringify(params),
  ]);
}

beforeEach(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await applyMigrations(pool, "local");
});
afterAll(async () => {
  await pool.end();
});

describe("runAgents", () => {
  it("a market maker posts two-sided liquidity", async () => {
    await addAgent(MAKER, "mm", "maker", { commodity: "ore", size: 5, margin: 2 });
    await pool.query("INSERT INTO inventory (player_id, commodity, qty) VALUES ($1,'ore',1000)", [MAKER]);
    await pool.query(
      "INSERT INTO market_state (commodity, last_price, best_bid, best_ask, generation) VALUES ('ore',100,NULL,NULL,0)"
    );

    const res = await runAgents(pool);
    expect(res.placed).toBe(2);
    expect(res.fills).toBe(0);

    const orders = await pool.query(
      "SELECT side, price, qty_open FROM orders WHERE player_id = $1 ORDER BY side",
      [MAKER]
    );
    expect(orders.rows).toEqual([
      { side: "buy", price: "98", qty_open: "5" },
      { side: "sell", price: "102", qty_open: "5" },
    ]);
  });

  it("an agent order that crosses a resting sell settles", async () => {
    // a non-agent seller resting an ask at 95, backed by inventory
    await pool.query(
      `INSERT INTO players (id, handle, kind, credits, home_region, created_at)
         VALUES ($1,'seller','human',0,'us-east', now())`,
      [SELLER]
    );
    await pool.query("INSERT INTO inventory (player_id, commodity, qty) VALUES ($1,'ore',100)", [SELLER]);
    await pool.query(
      `INSERT INTO orders (id, player_id, commodity, side, price, qty_open, status, created_at)
         VALUES (gen_random_uuid(), $1, 'ore', 'sell', 95, 10, 'open', now())`,
      [SELLER]
    );
    // recent trades make the rolling mean ~100; market last_price 80 => undervalued
    await pool.query(
      "INSERT INTO market_state (commodity, last_price, best_bid, best_ask, generation) VALUES ('ore',80,NULL,NULL,0)"
    );
    for (const p of [100, 100, 100]) {
      await pool.query(
        `INSERT INTO trades (id, commodity, buy_order_id, sell_order_id, price, qty, generation, executed_at)
           VALUES (gen_random_uuid(),'ore',gen_random_uuid(),gen_random_uuid(),$1,1,0,now())`,
        [p]
      );
    }
    await addAgent(VALUE, "va", "value", { commodity: "ore", size: 4, band: 0.05, lookback: 10 });

    const res = await runAgents(pool);
    expect(res.fills).toBe(4); // value bot buys 4 @ the resting ask

    const inv = await pool.query("SELECT qty FROM inventory WHERE player_id = $1 AND commodity = 'ore'", [VALUE]);
    expect(inv.rows[0].qty).toBe("4");
    const sellerCredits = await pool.query("SELECT credits FROM players WHERE id = $1", [SELLER]);
    expect(sellerCredits.rows[0].credits).toBe("380"); // 4 * 95
  });
});
