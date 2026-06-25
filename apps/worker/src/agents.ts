// Algorithmic trading agents (spec §4.5). Each strategy is a PURE decision
// function: given the current market context and the agent's position, it
// returns the limit orders the agent wants to place this round. Agents are
// first-class players — these intents go through the exact same placeOrder path
// as humans. Zero inference cost by design; they exist to keep the market liquid
// during a sparse demo and to be the opponent.

export type Strategy = "maker" | "momentum" | "value" | "scout" | "arb" | "pulse";

export interface AgentParams {
  commodity: string;
  size: number; // order quantity
  margin?: number; // maker: credits offset from the reference price
  band?: number; // value: fractional deviation from the mean to act on
  lookback?: number; // momentum/value: trades to consider
  anchor?: number; // momentum/pulse: price the probe reverts toward (default 100)
  region?: string; // scout: which region to claim cells in (default r0)
  invTarget?: number; // pulse: inventory the conserved trader rebalances toward (default 1000)
  invBand?: number; // pulse: deadband around invTarget before inventory forces a side (default 50)
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
    const first = recent[0];
    const last = recent[recent.length - 1];
    if (recent.length >= 2 && last !== first) {
      if (last > first) {
        const price = ctx.bestAsk ?? last;
        if (canBuy(ctx, price, size)) out.push({ commodity, side: "buy", price, qty: size });
      } else {
        const price = ctx.bestBid ?? last;
        if (canSell(ctx, size)) out.push({ commodity, side: "sell", price, qty: size });
      }
      return out;
    }
    // Cold start / flat market: no trend to follow, but the book stays frozen
    // until someone crosses the spread. Probe to keep price discovery alive,
    // reverting toward a stable anchor so the market oscillates around it rather
    // than drifting (a buy-biased probe inflates a commodity with no opposing
    // pressure). Cross the spread on the side that moves price toward the anchor;
    // only take a real resting order so the probe actually trades.
    const anchor = params.anchor ?? 100;
    const ref = ctx.lastPrice ?? anchor;
    if (ref <= anchor) {
      if (ctx.bestAsk !== null && canBuy(ctx, ctx.bestAsk, size)) {
        out.push({ commodity, side: "buy", price: ctx.bestAsk, qty: size });
      }
    } else {
      if (ctx.bestBid !== null && canSell(ctx, size)) {
        out.push({ commodity, side: "sell", price: ctx.bestBid, qty: size });
      }
    }
    return out;
  }

  if (strategy === "pulse") {
    // Baseline liquidity / noise trader. Every tick it CROSSES the spread by `size`,
    // taking a real resting order so a trade always prints — this keeps the trade tape
    // warm (the signal-gated takers, momentum/value/arb, never re-freeze) and gives a
    // sparse or unattended world constant, visible buy/sell activity even with a handful
    // of real players. It is CONSERVED, so it round-trips instead of running away: it
    // leans to restore its inventory toward `invTarget` and, when inventory is neutral,
    // to pull price back toward `anchor`. Only ever takes an order it can actually back.
    const anchor = params.anchor ?? 100;
    const target = params.invTarget ?? 1000;
    const dead = params.invBand ?? 50;
    let side: "buy" | "sell";
    if (ctx.inventory > target + dead) side = "sell";
    else if (ctx.inventory < target - dead) side = "buy";
    else side = (ctx.lastPrice ?? anchor) > anchor ? "sell" : "buy";

    if (side === "buy") {
      if (ctx.bestAsk !== null && canBuy(ctx, ctx.bestAsk, size)) {
        out.push({ commodity, side: "buy", price: ctx.bestAsk, qty: size });
      }
    } else if (ctx.bestBid !== null && canSell(ctx, size)) {
      out.push({ commodity, side: "sell", price: ctx.bestBid, qty: size });
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

  // scout is handled in the runner (it claims, not trades); arb spans markets so
  // it has its own entry point, pickArb, below.
  return out;
}

export interface ArbMarket {
  commodity: string;
  lastPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  recentPrices: number[];
}

export interface ArbContext {
  size: number;
  credits: number;
  holdings: Record<string, number>;
  lookback?: number;
}

// Arbitrage across commodities (spec §4.5): buy the commodity trading furthest
// below its rolling mean and sell the one furthest above it that the agent holds.
export function pickArb(markets: ReadonlyArray<ArbMarket>, ctx: ArbContext): OrderIntent[] {
  const lb = ctx.lookback ?? 10;
  let buy: { commodity: string; price: number; dev: number } | null = null;
  let sell: { commodity: string; price: number; dev: number } | null = null;

  for (const m of markets) {
    const recent = m.recentPrices.slice(-lb);
    if (recent.length === 0 || m.lastPrice === null) continue;
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (mean <= 0) continue;
    const dev = (m.lastPrice - mean) / mean;

    if (dev < 0 && m.bestAsk !== null && ctx.credits >= m.bestAsk * ctx.size) {
      if (!buy || dev < buy.dev) buy = { commodity: m.commodity, price: m.bestAsk, dev };
    }
    if (dev > 0 && m.bestBid !== null && (ctx.holdings[m.commodity] ?? 0) >= ctx.size) {
      if (!sell || dev > sell.dev) sell = { commodity: m.commodity, price: m.bestBid, dev };
    }
  }

  const out: OrderIntent[] = [];
  if (buy) out.push({ commodity: buy.commodity, side: "buy", price: buy.price, qty: ctx.size });
  if (sell) out.push({ commodity: sell.commodity, side: "sell", price: sell.price, qty: ctx.size });
  return out;
}
