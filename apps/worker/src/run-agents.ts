import { loadAgents, getMarket, placeOrder, type Pool } from "@orbis/db";
import { decide, type Strategy } from "./agents.js";

export interface RunAgentsResult {
  placed: number;
  fills: number;
}

// One agent round: each agent reads its commodity's market + its own position,
// decides intents (pure strategy), and places them through the human order path.
// An order the agent can't back is simply skipped (placeOrder rejects it).
export async function runAgents(pool: Pool): Promise<RunAgentsResult> {
  const agents = await loadAgents(pool);
  let placed = 0;
  let fills = 0;

  for (const agent of agents) {
    const params = agent.params;
    const market = await getMarket(pool, params.commodity);
    const invRow = await pool.query<{ qty: string }>(
      "SELECT qty FROM inventory WHERE player_id = $1 AND commodity = $2",
      [agent.player_id, params.commodity]
    );

    const intents = decide(agent.strategy as Strategy, params, {
      lastPrice: market.last_price !== null ? Number(market.last_price) : null,
      bestBid: market.bids[0] ? Number(market.bids[0].price) : null,
      bestAsk: market.asks[0] ? Number(market.asks[0].price) : null,
      recentPrices: [...market.recent_trades].reverse().map((t) => Number(t.price)),
      inventory: Number(invRow.rows[0]?.qty ?? "0"),
      credits: Number(agent.credits),
    });

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

  return { placed, fills };
}
