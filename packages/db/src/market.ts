// The market: one order book per commodity, price-time priority, and the
// strongly-consistent settlement transaction that is the technical centerpiece
// of the entry (spec §4.3, §6.1).
//
// Concurrency model: Aurora DSQL is optimistic and does NOT support
// SELECT ... FOR UPDATE, so invariants are enforced with conditional UPDATEs
// whose WHERE clause re-asserts the precondition and whose row count reveals a
// conflict (e.g. `UPDATE players SET credits = credits - cost WHERE credits >=
// cost`). A fill that loses a race rolls back and the matching loop re-reads and
// retries. Money is BIGINT and all money arithmetic happens in SQL — never as a
// JS number (precision) — so prices/quantities travel as strings.

import { randomUUID } from "node:crypto";
import type pg from "pg";

export type Side = "buy" | "sell";

export class OrderError extends Error {
  constructor(
    public code:
      | "invalid_input"
      | "unknown_player"
      | "insufficient_credits"
      | "insufficient_inventory",
    message?: string
  ) {
    super(message ?? code);
    this.name = "OrderError";
  }
}

export interface PlaceOrderInput {
  player_id: string;
  commodity: string;
  side: Side;
  price: number; // credits per unit, integer > 0
  qty: number; // integer > 0
}

export interface Fill {
  buy_order_id: string;
  sell_order_id: string;
  price: string;
  qty: string;
}

export interface PlaceOrderResult {
  order_id: string;
  status: "open" | "filled" | "cancelled";
  fills: Fill[];
}

export interface MatchResult {
  fills: Fill[];
  cancelled: string[];
}

interface BookOrder {
  id: string;
  player_id: string;
  price: string;
  qty_open: string;
  created_at: string;
}

type SettleResult =
  | { settled: true; fill: Fill }
  | { settled: false; reason: "conflict" | "insufficient_credits" | "insufficient_inventory" };

const BEST_BID =
  `SELECT id, player_id, price, qty_open, created_at FROM orders
     WHERE commodity = $1 AND side = 'buy' AND status = 'open' AND qty_open > 0
     ORDER BY price DESC, created_at ASC LIMIT 1`;
const BEST_ASK =
  `SELECT id, player_id, price, qty_open, created_at FROM orders
     WHERE commodity = $1 AND side = 'sell' AND status = 'open' AND qty_open > 0
     ORDER BY price ASC, created_at ASC LIMIT 1`;

async function cancelById(pool: pg.Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status = 'open'",
    [id]
  );
  return (rowCount ?? 0) > 0;
}

// Settle one crossing pair as a single short transaction (spec §6.1). All
// invariants are re-asserted inside the transaction via conditional writes.
async function settleFill(
  pool: pg.Pool,
  buyOrderId: string,
  sellOrderId: string,
  qty: string,
  price: string,
  generation: number
): Promise<SettleResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const buy = (
      await client.query<{ player_id: string; commodity: string; qty_open: string; status: string }>(
        "SELECT player_id, commodity, qty_open, status FROM orders WHERE id = $1",
        [buyOrderId]
      )
    ).rows[0];
    const sell = (
      await client.query<{ player_id: string; commodity: string; qty_open: string; status: string }>(
        "SELECT player_id, commodity, qty_open, status FROM orders WHERE id = $1",
        [sellOrderId]
      )
    ).rows[0];

    const q = BigInt(qty);
    if (
      !buy ||
      !sell ||
      buy.status !== "open" ||
      sell.status !== "open" ||
      BigInt(buy.qty_open) < q ||
      BigInt(sell.qty_open) < q
    ) {
      await client.query("ROLLBACK");
      return { settled: false, reason: "conflict" };
    }
    const commodity = sell.commodity;

    // Debit buyer credits, asserting affordability in the WHERE clause.
    const debit = await client.query(
      `UPDATE players SET credits = credits - ($1::bigint * $2::bigint)
         WHERE id = $3 AND credits >= ($1::bigint * $2::bigint)`,
      [price, qty, buy.player_id]
    );
    if ((debit.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return { settled: false, reason: "insufficient_credits" };
    }

    // Debit seller inventory, asserting holdings.
    const draw = await client.query(
      `UPDATE inventory SET qty = qty - $1::bigint
         WHERE player_id = $2 AND commodity = $3 AND qty >= $1::bigint`,
      [qty, sell.player_id, commodity]
    );
    if ((draw.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return { settled: false, reason: "insufficient_inventory" };
    }

    await client.query(
      `UPDATE players SET credits = credits + ($1::bigint * $2::bigint) WHERE id = $3`,
      [price, qty, sell.player_id]
    );
    await client.query(
      `INSERT INTO inventory (player_id, commodity, qty) VALUES ($1, $2, $3::bigint)
         ON CONFLICT (player_id, commodity) DO UPDATE SET qty = inventory.qty + EXCLUDED.qty`,
      [buy.player_id, commodity, qty]
    );

    const closeBuy = `UPDATE orders
        SET qty_open = qty_open - $1::bigint,
            status = CASE WHEN qty_open - $1::bigint = 0 THEN 'filled' ELSE 'open' END
        WHERE id = $2`;
    await client.query(closeBuy, [qty, buyOrderId]);
    await client.query(closeBuy, [qty, sellOrderId]);

    await client.query(
      `INSERT INTO trades (id, commodity, buy_order_id, sell_order_id, price, qty, generation, executed_at)
         VALUES ($1, $2, $3, $4, $5::bigint, $6::bigint, $7, now())`,
      [randomUUID(), commodity, buyOrderId, sellOrderId, price, qty, generation]
    );
    await client.query(
      `INSERT INTO market_state (commodity, last_price, best_bid, best_ask, generation)
         VALUES ($1, $2::bigint, NULL, NULL, $3)
         ON CONFLICT (commodity) DO UPDATE
           SET last_price = EXCLUDED.last_price, generation = EXCLUDED.generation`,
      [commodity, price, generation]
    );

    await client.query("COMMIT");
    return { settled: true, fill: { buy_order_id: buyOrderId, sell_order_id: sellOrderId, price, qty } };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Match a commodity's book to exhaustion: repeatedly cross the best bid and best
// ask, settling each pair at the RESTING order's price (the earlier order by
// price-time priority). An order that can never settle (insufficient funds or
// holdings) is cancelled so the book makes progress.
export async function matchCommodity(
  pool: pg.Pool,
  commodity: string,
  generation: number
): Promise<MatchResult> {
  const fills: Fill[] = [];
  const cancelled: string[] = [];
  let guard = 0;

  while (guard++ < 10_000) {
    const bid = (await pool.query<BookOrder>(BEST_BID, [commodity])).rows[0];
    const ask = (await pool.query<BookOrder>(BEST_ASK, [commodity])).rows[0];
    if (!bid || !ask) break;
    if (BigInt(bid.price) < BigInt(ask.price)) break; // no cross

    const qty = (BigInt(bid.qty_open) < BigInt(ask.qty_open) ? bid.qty_open : ask.qty_open) as string;
    const bidResting = new Date(bid.created_at).getTime() <= new Date(ask.created_at).getTime();
    const price = bidResting ? bid.price : ask.price; // resting order sets the price

    const res = await settleFill(pool, bid.id, ask.id, qty, price, generation);
    if (res.settled) {
      fills.push(res.fill);
      continue;
    }
    if (res.reason === "insufficient_credits") {
      await cancelById(pool, bid.id);
      cancelled.push(bid.id);
      continue;
    }
    if (res.reason === "insufficient_inventory") {
      await cancelById(pool, ask.id);
      cancelled.push(ask.id);
      continue;
    }
    // conflict: re-read and retry (guard bounds the loop)
  }

  return { fills, cancelled };
}

function assertValidInput(input: PlaceOrderInput): void {
  if (input.side !== "buy" && input.side !== "sell") {
    throw new OrderError("invalid_input", "side must be 'buy' or 'sell'");
  }
  if (!input.commodity) throw new OrderError("invalid_input", "commodity is required");
  if (!Number.isInteger(input.price) || input.price <= 0) {
    throw new OrderError("invalid_input", "price must be a positive integer");
  }
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new OrderError("invalid_input", "qty must be a positive integer");
  }
}

// Place a limit order, then match its commodity's book. Rejects structurally
// invalid orders, unknown players, and orders the player obviously can't back
// (buy beyond credits / sell beyond inventory); the settlement asserts remain
// the authoritative guard against races.
export async function placeOrder(
  pool: pg.Pool,
  input: PlaceOrderInput
): Promise<PlaceOrderResult> {
  assertValidInput(input);

  const player = (
    await pool.query<{ credits: string }>("SELECT credits FROM players WHERE id = $1", [
      input.player_id,
    ])
  ).rows[0];
  if (!player) throw new OrderError("unknown_player");

  const notional = BigInt(input.price) * BigInt(input.qty);
  if (input.side === "buy" && BigInt(player.credits) < notional) {
    throw new OrderError("insufficient_credits");
  }
  if (input.side === "sell") {
    const inv = (
      await pool.query<{ qty: string }>(
        "SELECT qty FROM inventory WHERE player_id = $1 AND commodity = $2",
        [input.player_id, input.commodity]
      )
    ).rows[0];
    if (!inv || BigInt(inv.qty) < BigInt(input.qty)) {
      throw new OrderError("insufficient_inventory");
    }
  }

  const orderId = randomUUID();
  await pool.query(
    `INSERT INTO orders (id, player_id, commodity, side, price, qty_open, status, created_at)
       VALUES ($1, $2, $3, $4, $5::bigint, $6::bigint, 'open', now())`,
    [orderId, input.player_id, input.commodity, input.side, input.price, input.qty]
  );

  const { rows: gen } = await pool.query<{ gen: string | null }>(
    "SELECT max(generation)::text AS gen FROM ticks"
  );
  const generation = gen[0]?.gen ? Number(gen[0].gen) : 0;

  const match = await matchCommodity(pool, input.commodity, generation);

  const status = (
    await pool.query<{ status: PlaceOrderResult["status"] }>(
      "SELECT status FROM orders WHERE id = $1",
      [orderId]
    )
  ).rows[0].status;

  return { order_id: orderId, status, fills: match.fills };
}

export async function cancelOrder(pool: pg.Pool, orderId: string): Promise<{ cancelled: boolean }> {
  return { cancelled: await cancelById(pool, orderId) };
}

export interface MarketDepthLevel {
  price: string;
  qty_open: string;
}
export interface MarketTrade {
  price: string;
  qty: string;
  executed_at: string;
}
export interface MarketSnapshot {
  commodity: string;
  last_price: string | null;
  bids: MarketDepthLevel[];
  asks: MarketDepthLevel[];
  recent_trades: MarketTrade[];
}

export async function getMarket(pool: pg.Pool, commodity: string): Promise<MarketSnapshot> {
  const [bids, asks, last, trades] = await Promise.all([
    pool.query<MarketDepthLevel>(
      `SELECT price, qty_open FROM orders
         WHERE commodity = $1 AND side = 'buy' AND status = 'open' AND qty_open > 0
         ORDER BY price DESC, created_at ASC LIMIT 50`,
      [commodity]
    ),
    pool.query<MarketDepthLevel>(
      `SELECT price, qty_open FROM orders
         WHERE commodity = $1 AND side = 'sell' AND status = 'open' AND qty_open > 0
         ORDER BY price ASC, created_at ASC LIMIT 50`,
      [commodity]
    ),
    pool.query<{ last_price: string }>(
      "SELECT last_price FROM market_state WHERE commodity = $1",
      [commodity]
    ),
    pool.query<MarketTrade>(
      `SELECT price, qty, executed_at FROM trades
         WHERE commodity = $1 ORDER BY executed_at DESC LIMIT 60`,
      [commodity]
    ),
  ]);

  return {
    commodity,
    last_price: last.rows[0]?.last_price ?? null,
    bids: bids.rows,
    asks: asks.rows,
    recent_trades: trades.rows,
  };
}
