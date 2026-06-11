// Algorithmic trading agents (spec §4.5). Each strategy is a PURE decision
// function: given the current market context and the agent's position, it
// returns the limit orders the agent wants to place this round. Agents are
// first-class players — these intents go through the exact same placeOrder path
// as humans. Zero inference cost by design; they exist to keep the market liquid
// during a sparse demo and to be the opponent.

export type Strategy = "maker" | "momentum" | "value" | "scout" | "arb";

export interface AgentParams {
  commodity: string;
  size: number; // order quantity
  margin?: number; // maker: credits offset from the reference price
  band?: number; // value: fractional deviation from the mean to act on
  lookback?: number; // momentum/value: trades to consider
}

export interface AgentContext {
  lastPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  recentPrices: number[]; // chronological (oldest -> newest)
  inventory: number; // agent's holding of the commodity
  credits: number; // agent's spendable credits
}

export interface OrderIntent {
  commodity: string;
  side: "buy" | "sell";
  price: number;
  qty: number;
}

function canBuy(ctx: AgentContext, price: number, qty: number): boolean {
  return price > 0 && qty > 0 && ctx.credits >= price * qty;
}
function canSell(ctx: AgentContext, qty: number): boolean {
  return qty > 0 && ctx.inventory >= qty;
}

export function decide(strategy: Strategy, params: AgentParams, ctx: AgentContext): OrderIntent[] {
  const commodity = params.commodity;
  const size = params.size;
  const out: OrderIntent[] = [];

  if (strategy === "maker") {
    // Quote both sides around the reference price to provide liquidity.
    const ref = ctx.lastPrice ?? 100;
    const margin = params.margin ?? 2;
    const bid = Math.max(1, Math.round(ref - margin));
    const ask = Math.max(bid + 1, Math.round(ref + margin));
    if (canBuy(ctx, bid, size)) out.push({ commodity, side: "buy", price: bid, qty: size });
    if (canSell(ctx, size)) out.push({ commodity, side: "sell", price: ask, qty: size });
    return out;
  }

  if (strategy === "momentum") {
    // Buy into rising prices, sell into falling ones, taking resting liquidity.
    const recent = ctx.recentPrices.slice(-(params.lookback ?? 5));
    if (recent.length < 2) return out;
    const first = recent[0];
    const last = recent[recent.length - 1];
    if (last > first) {
      const price = ctx.bestAsk ?? last;
      if (canBuy(ctx, price, size)) out.push({ commodity, side: "buy", price, qty: size });
    } else if (last < first) {
      const price = ctx.bestBid ?? last;
      if (canSell(ctx, size)) out.push({ commodity, side: "sell", price, qty: size });
    }
    return out;
  }

  if (strategy === "value") {
    // Buy below the rolling mean, sell above it.
    const recent = ctx.recentPrices.slice(-(params.lookback ?? 10));
    if (recent.length === 0 || ctx.lastPrice === null) return out;
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const band = params.band ?? 0.05;
    if (ctx.lastPrice < mean * (1 - band)) {
      const price = ctx.bestAsk ?? ctx.lastPrice;
      if (canBuy(ctx, price, size)) out.push({ commodity, side: "buy", price, qty: size });
    } else if (ctx.lastPrice > mean * (1 + band)) {
      const price = ctx.bestBid ?? ctx.lastPrice;
      if (canSell(ctx, size)) out.push({ commodity, side: "sell", price, qty: size });
    }
    return out;
  }

  // scout (mining) and arb are Phase 3 stretch — no trading intent yet.
  return out;
}
