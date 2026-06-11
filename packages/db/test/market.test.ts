import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createPool } from "../src/connection.js";
import { applyMigrations } from "../src/migrate.js";
import { placeOrder, cancelOrder, getMarket, OrderError } from "../src/market.js";
import { getLeaderboard } from "../src/queries.js";

const pool = createPool();

const ALICE = "11111111-1111-1111-1111-111111111111"; // buyer, 10000 credits
const BOB = "22222222-2222-2222-2222-222222222222"; //   seller, 500 credits, 100 ore
const CAROL = "33333333-3333-3333-3333-333333333333"; // poor buyer, 100 credits

async function credits(id: string): Promise<string> {
  return (await pool.query("SELECT credits FROM players WHERE id = $1", [id])).rows[0].credits;
}
async function inv(id: string, commodity: string): Promise<string> {
  const r = await pool.query("SELECT qty FROM inventory WHERE player_id = $1 AND commodity = $2", [
    id,
    commodity,
  ]);
  return r.rows[0]?.qty ?? "0";
}
async function orderStatus(id: string): Promise<{ status: string; qty_open: string }> {
  return (await pool.query("SELECT status, qty_open FROM orders WHERE id = $1", [id])).rows[0];
}

beforeEach(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await applyMigrations(pool, "local");
  await pool.query(
    `INSERT INTO players (id, handle, kind, credits, home_region, created_at) VALUES
       ($1,'alice','human',10000,'us-east', now()),
       ($2,'bob','human',500,'us-east', now()),
       ($3,'carol','human',100,'us-east', now())`,
    [ALICE, BOB, CAROL]
  );
  await pool.query(
    "INSERT INTO inventory (player_id, commodity, qty) VALUES ($1,'ore',100)",
    [BOB]
  );
});
afterAll(async () => {
  await pool.end();
});

describe("settlement", () => {
  it("settles a crossing buy and sell atomically", async () => {
    const sell = await placeOrder(pool, { player_id: BOB, commodity: "ore", side: "sell", price: 100, qty: 10 });
    expect(sell.fills).toEqual([]); // rests — no buyer yet

    const buy = await placeOrder(pool, { player_id: ALICE, commodity: "ore", side: "buy", price: 100, qty: 10 });
    expect(buy.fills).toHaveLength(1);
    expect(buy.status).toBe("filled");

    expect(await credits(ALICE)).toBe("9000"); // 10000 - 10*100
    expect(await credits(BOB)).toBe("1500"); //   500 + 10*100
    expect(await inv(ALICE, "ore")).toBe("10");
    expect(await inv(BOB, "ore")).toBe("90");
    expect((await orderStatus(sell.order_id)).status).toBe("filled");

    const trades = await pool.query("SELECT price, qty FROM trades");
    expect(trades.rows).toEqual([{ price: "100", qty: "10" }]);
    const ms = await pool.query("SELECT last_price FROM market_state WHERE commodity='ore'");
    expect(ms.rows[0].last_price).toBe("100");
  });

  it("executes at the resting order's price, not the aggressor's", async () => {
    await placeOrder(pool, { player_id: BOB, commodity: "ore", side: "sell", price: 90, qty: 5 }); // rests
    await placeOrder(pool, { player_id: ALICE, commodity: "ore", side: "buy", price: 110, qty: 5 }); // crosses

    // buyer pays the resting ask (90), not her 110 bid
    expect(await credits(ALICE)).toBe("9550"); // 10000 - 5*90
    expect(await credits(BOB)).toBe("950"); //    500 + 5*90
    const ms = await pool.query("SELECT last_price FROM market_state WHERE commodity='ore'");
    expect(ms.rows[0].last_price).toBe("90");
  });

  it("partially fills the larger order and leaves it open", async () => {
    const sell = await placeOrder(pool, { player_id: BOB, commodity: "ore", side: "sell", price: 100, qty: 10 });
    const buy = await placeOrder(pool, { player_id: ALICE, commodity: "ore", side: "buy", price: 100, qty: 4 });

    expect(buy.status).toBe("filled");
    const resting = await orderStatus(sell.order_id);
    expect(resting).toEqual({ status: "open", qty_open: "6" });
    expect(await inv(ALICE, "ore")).toBe("4");
  });

  it("does not cross when the bid is below the ask", async () => {
    const sell = await placeOrder(pool, { player_id: BOB, commodity: "ore", side: "sell", price: 100, qty: 5 });
    const buy = await placeOrder(pool, { player_id: ALICE, commodity: "ore", side: "buy", price: 90, qty: 5 });

    expect(buy.fills).toEqual([]);
    expect((await orderStatus(sell.order_id)).status).toBe("open");
    expect((await orderStatus(buy.order_id)).status).toBe("open");
    expect((await pool.query("SELECT count(*)::int n FROM trades")).rows[0].n).toBe(0);
  });
});

describe("order validation", () => {
  it("rejects a buy beyond the player's credits", async () => {
    await expect(
      placeOrder(pool, { player_id: CAROL, commodity: "ore", side: "buy", price: 100, qty: 5 })
    ).rejects.toMatchObject({ code: "insufficient_credits" });
  });

  it("rejects a sell beyond the player's inventory", async () => {
    await expect(
      placeOrder(pool, { player_id: BOB, commodity: "ore", side: "sell", price: 100, qty: 200 })
    ).rejects.toMatchObject({ code: "insufficient_inventory" });
  });

  it("rejects structurally invalid orders and unknown players", async () => {
    await expect(
      placeOrder(pool, { player_id: ALICE, commodity: "ore", side: "buy", price: 0, qty: 5 })
    ).rejects.toBeInstanceOf(OrderError);
    await expect(
      placeOrder(pool, { player_id: "00000000-0000-0000-0000-000000000000", commodity: "ore", side: "buy", price: 10, qty: 1 })
    ).rejects.toMatchObject({ code: "unknown_player" });
  });
});

describe("cancel", () => {
  it("cancels a resting order so it no longer trades", async () => {
    const sell = await placeOrder(pool, { player_id: BOB, commodity: "ore", side: "sell", price: 100, qty: 5 });
    expect(await cancelOrder(pool, sell.order_id)).toEqual({ cancelled: true });
    expect((await orderStatus(sell.order_id)).status).toBe("cancelled");

    const buy = await placeOrder(pool, { player_id: ALICE, commodity: "ore", side: "buy", price: 100, qty: 5 });
    expect(buy.fills).toEqual([]); // nothing open to cross
    // cancelling again (or a filled/missing order) is a no-op
    expect(await cancelOrder(pool, sell.order_id)).toEqual({ cancelled: false });
  });
});

describe("getMarket", () => {
  it("reports book depth, last price, and recent trades", async () => {
    await placeOrder(pool, { player_id: BOB, commodity: "ore", side: "sell", price: 100, qty: 10 });
    await placeOrder(pool, { player_id: ALICE, commodity: "ore", side: "buy", price: 100, qty: 4 });
    await placeOrder(pool, { player_id: ALICE, commodity: "ore", side: "buy", price: 80, qty: 3 }); // rests

    const m = await getMarket(pool, "ore");
    expect(m.last_price).toBe("100");
    expect(m.bids).toEqual([{ price: "80", qty_open: "3" }]); // the resting bid
    expect(m.asks).toEqual([{ price: "100", qty_open: "6" }]); // remainder of the sell
    expect(m.recent_trades).toHaveLength(1);
    expect(m.recent_trades[0]).toMatchObject({ price: "100", qty: "4" });
  });
});

describe("leaderboard net worth", () => {
  it("values inventory at the last market price", async () => {
    await placeOrder(pool, { player_id: BOB, commodity: "ore", side: "sell", price: 100, qty: 10 });
    await placeOrder(pool, { player_id: ALICE, commodity: "ore", side: "buy", price: 100, qty: 10 });

    const board = await getLeaderboard(pool);
    const byHandle = Object.fromEntries(board.map((e) => [e.handle, e.net_worth]));
    expect(byHandle["bob"]).toBe("10500"); // 1500 credits + 90 ore * 100
    expect(byHandle["alice"]).toBe("10000"); // 9000 credits + 10 ore * 100
    expect(board.map((e) => e.handle)).toEqual(["bob", "alice", "carol"]);
  });
});
