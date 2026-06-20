import {
  loadAgents,
  getMarket,
  placeOrder,
  findClaimableCell,
  claimCell,
  RESOURCE_TYPES,
  type Pool,
} from "@orbis/db";
import { decide, pickArb, type Strategy, type ArbMarket } from "./agents.js";

export interface RunAgentsResult {
  placed: number;
  fills: number;
  claimed: number;
}

// One agent round: each agent reads its commodity's market + its own position,
// decides intents (pure strategy), and places them through the human order path.
// An order the agent can't back is simply skipped (placeOrder rejects it).
export async function runAgents(pool: Pool): Promise<RunAgentsResult> {
  const agents = await loadAgents(pool);
  let placed = 0;
  let fills = 0;
  let claimed = 0;

  for (const agent of agents) {
    const params = agent.params;

    // Scout (Design B — bounded supplier): keep a small footprint of active
    // cells, and SELL the mined output into the market each tick. Wealth is
    // realized through real trades on the ledger (and bounded by what the
    // market will pay) rather than accumulating as unrealizable paper inventory.
    if (agent.strategy === "scout") {
      const SCOUT_CELL_CAP = 5; // small footprint → mining within organic demand
      const SCOUT_BUFFER = 100; // keep a small working inventory
      const SCOUT_SELL_SIZE = 12; // modest per-commodity supply per tick

      const owned = (
        await pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM cells WHERE owner_id = $1",
          [agent.player_id]
        )
      ).rows[0].n;
      if (owned < SCOUT_CELL_CAP) {
        const cell = await findClaimableCell(pool, params.region ?? "r0");
        if (cell) {
          const res = await claimCell(pool, agent.player_id, cell.id);
          if (res.claimed) claimed++;
        }
      }
      // Sell everything above the working buffer, hitting the best bid.
      const inv = await pool.query<{ commodity: string; qty: string }>(
        "SELECT commodity, qty FROM inventory WHERE player_id = $1 AND qty > $2",
        [agent.player_id, SCOUT_BUFFER]
      );
      for (const row of inv.rows) {
        const m = await getMarket(pool, row.commodity);
        // Post supply PASSIVELY at the going offer (join the best ask) instead
        // of hitting the bid — adds liquidity and fills on real demand without
        // crashing the price.
        const ask = m.asks[0]
          ? Number(m.asks[0].price)
          : m.last_price !== null
            ? Number(m.last_price)
            : 100;
        const sellQty = Math.min(Number(row.qty) - SCOUT_BUFFER, SCOUT_SELL_SIZE);
        if (sellQty <= 0) continue;
        try {
          const res = await placeOrder(pool, {
            player_id: agent.player_id,
            commodity: row.commodity,
            side: "sell",
            price: ask,
            qty: sellQty,
          });
          placed++;
          fills += res.fills.reduce((sum, f) => sum + Number(f.qty), 0);
        } catch {
          /* skip if it can't back the sell */
        }
      }
      continue;
    }

    let intents;
    if (agent.strategy === "arb") {
      // Arb spans all commodities: read every book + the agent's full holdings.
      const markets: ArbMarket[] = [];
      for (const c of RESOURCE_TYPES) {
        const m = await getMarket(pool, c);
        markets.push({
          commodity: c,
          lastPrice: m.last_price !== null ? Number(m.last_price) : null,
          bestBid: m.bids[0] ? Number(m.bids[0].price) : null,
          bestAsk: m.asks[0] ? Number(m.asks[0].price) : null,
          recentPrices: [...m.recent_trades].reverse().map((t) => Number(t.price)),
        });
      }
      const invAll = await pool.query<{ commodity: string; qty: string }>(
        "SELECT commodity, qty FROM inventory WHERE player_id = $1",
        [agent.player_id]
      );
      const holdings = Object.fromEntries(invAll.rows.map((r) => [r.commodity, Number(r.qty)]));
      intents = pickArb(markets, {
        size: params.size,
        credits: Number(agent.credits),
        holdings,
        lookback: params.lookback,
      });
    } else {
      const market = await getMarket(pool, params.commodity);
      const invRow = await pool.query<{ qty: string }>(
        "SELECT qty FROM inventory WHERE player_id = $1 AND commodity = $2",
        [agent.player_id, params.commodity]
      );
      intents = decide(agent.strategy as Strategy, params, {
        lastPrice: market.last_price !== null ? Number(market.last_price) : null,
        bestBid: market.bids[0] ? Number(market.bids[0].price) : null,
        bestAsk: market.asks[0] ? Number(market.asks[0].price) : null,
        recentPrices: [...market.recent_trades].reverse().map((t) => Number(t.price)),
        inventory: Number(invRow.rows[0]?.qty ?? "0"),
        credits: Number(agent.credits),
      });
    }

    for (const intent of intents) {
      try {
        const res = await placeOrder(pool, { player_id: agent.player_id, ...intent });
        placed++;
        fills += res.fills.reduce((sum, f) => sum + Number(f.qty), 0);
      } catch {
        // agent declines this round (e.g. insufficient funds after a prior fill)
      }
    }
  }

  return { placed, fills, claimed };
}
