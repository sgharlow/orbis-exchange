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

    // Scout: claim the best unclaimed cell in its region; the tick mines it,
    // so the scout's net worth grows through holdings rather than trading.
    if (agent.strategy === "scout") {
      const cell = await findClaimableCell(pool, params.region ?? "r0");
      if (cell) {
        const res = await claimCell(pool, agent.player_id, cell.id);
        if (res.claimed) claimed++;
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
