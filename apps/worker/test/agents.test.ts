import { describe, it, expect } from "vitest";
import { decide, pickArb, type AgentContext, type ArbMarket } from "../src/agents.js";

const rich: AgentContext = {
  lastPrice: 100,
  bestBid: 98,
  bestAsk: 102,
  recentPrices: [100, 100, 100],
  inventory: 1000,
  credits: 1_000_000,
};

describe("maker", () => {
  it("quotes both sides around the reference price", () => {
    const out = decide("maker", { commodity: "ore", size: 5, margin: 2 }, rich);
    expect(out).toEqual([
      { commodity: "ore", side: "buy", price: 98, qty: 5 },
      { commodity: "ore", side: "sell", price: 102, qty: 5 },
    ]);
  });

  it("only bids when it holds no inventory", () => {
    const out = decide("maker", { commodity: "ore", size: 5 }, { ...rich, inventory: 0 });
    expect(out.map((o) => o.side)).toEqual(["buy"]);
  });

  it("only asks when it has no credits", () => {
    const out = decide("maker", { commodity: "ore", size: 5 }, { ...rich, credits: 0 });
    expect(out.map((o) => o.side)).toEqual(["sell"]);
  });
});

describe("momentum", () => {
  it("buys into a rising market", () => {
    const out = decide("momentum", { commodity: "ore", size: 3 }, { ...rich, recentPrices: [90, 95, 101] });
    expect(out).toEqual([{ commodity: "ore", side: "buy", price: 102, qty: 3 }]); // takes best ask
  });

  it("sells into a falling market", () => {
    const out = decide("momentum", { commodity: "ore", size: 3 }, { ...rich, recentPrices: [101, 95, 90] });
    expect(out).toEqual([{ commodity: "ore", side: "sell", price: 98, qty: 3 }]); // hits best bid
  });

  // Cold start / flat market: there is no trend to follow, but the book stays
  // frozen until someone takes. Momentum probes by lifting the best ask to
  // bootstrap price discovery (value + makers bound the excursion). This is the
  // fix for the cold-start deadlock where no agent ever crossed the spread.
  it("probes the best ask when there is no trade history (cold start)", () => {
    const out = decide("momentum", { commodity: "ore", size: 3 }, { ...rich, recentPrices: [] });
    expect(out).toEqual([{ commodity: "ore", side: "buy", price: 102, qty: 3 }]);
  });

  it("probes the best ask with only a single trade of history", () => {
    const out = decide("momentum", { commodity: "ore", size: 3 }, { ...rich, recentPrices: [100] });
    expect(out).toEqual([{ commodity: "ore", side: "buy", price: 102, qty: 3 }]);
  });

  it("probes the best ask when the market is flat (prevents re-freeze)", () => {
    // rich.recentPrices is [100, 100, 100] — no trend
    const out = decide("momentum", { commodity: "ore", size: 3 }, rich);
    expect(out).toEqual([{ commodity: "ore", side: "buy", price: 102, qty: 3 }]);
  });

  it("does not probe without a takeable ask on the book", () => {
    const out = decide("momentum", { commodity: "ore", size: 3 }, { ...rich, recentPrices: [], bestAsk: null });
    expect(out).toEqual([]);
  });

  it("does not probe a buy it cannot afford", () => {
    const out = decide("momentum", { commodity: "ore", size: 3 }, { ...rich, recentPrices: [], credits: 10 });
    expect(out).toEqual([]);
  });

  // The probe is anchor-reverting (default anchor 100), not buy-biased: when a
  // flat market sits ABOVE the anchor it probes a SELL back toward it, so prices
  // oscillate around the anchor instead of drifting upward forever.
  it("probes a sell toward the anchor when a flat market is above it", () => {
    const out = decide("momentum", { commodity: "ore", size: 3 }, { ...rich, lastPrice: 120, recentPrices: [120, 120, 120] });
    expect(out).toEqual([{ commodity: "ore", side: "sell", price: 98, qty: 3 }]); // hits best bid
  });

  it("probes a buy toward the anchor when a flat market is below it", () => {
    const out = decide("momentum", { commodity: "ore", size: 3 }, { ...rich, lastPrice: 80, recentPrices: [80, 80, 80] });
    expect(out).toEqual([{ commodity: "ore", side: "buy", price: 102, qty: 3 }]); // takes best ask
  });

  it("respects a custom anchor param", () => {
    // anchor 110: a flat market at 105 is BELOW the anchor → probe a buy
    const out = decide("momentum", { commodity: "ore", size: 3, anchor: 110 }, { ...rich, lastPrice: 105, recentPrices: [105, 105] });
    expect(out).toEqual([{ commodity: "ore", side: "buy", price: 102, qty: 3 }]);
  });

  it("does not probe a sell it has no inventory to back", () => {
    const out = decide("momentum", { commodity: "ore", size: 3 }, { ...rich, lastPrice: 120, recentPrices: [120, 120], inventory: 0 });
    expect(out).toEqual([]);
  });
});

describe("value", () => {
  it("buys when price is below the mean by more than the band", () => {
    const ctx = { ...rich, recentPrices: [100, 100, 100], lastPrice: 80 };
    const out = decide("value", { commodity: "ore", size: 2, band: 0.1 }, ctx);
    expect(out).toEqual([{ commodity: "ore", side: "buy", price: 102, qty: 2 }]);
  });

  it("sells when price is above the mean by more than the band", () => {
    const ctx = { ...rich, recentPrices: [100, 100, 100], lastPrice: 120 };
    const out = decide("value", { commodity: "ore", size: 2, band: 0.1 }, ctx);
    expect(out).toEqual([{ commodity: "ore", side: "sell", price: 98, qty: 2 }]);
  });

  it("holds when price is within the band", () => {
    const ctx = { ...rich, recentPrices: [100, 100, 100], lastPrice: 103 };
    expect(decide("value", { commodity: "ore", size: 2, band: 0.1 }, ctx)).toEqual([]);
  });
});

describe("pulse (baseline liquidity / noise trader)", () => {
  // Inventory at target (deadband neutral) so price-vs-anchor decides the side.
  const neutral = { ...rich, inventory: 5000 };
  const params = { commodity: "ore", size: 4, anchor: 100, invTarget: 5000, invBand: 200 };

  it("buys the best ask when at/below the anchor (pulls price up, prints a trade)", () => {
    const out = decide("pulse", params, { ...neutral, lastPrice: 100 });
    expect(out).toEqual([{ commodity: "ore", side: "buy", price: 102, qty: 4 }]);
  });

  it("sells the best bid when above the anchor (pulls price down)", () => {
    const out = decide("pulse", params, { ...neutral, lastPrice: 104 });
    expect(out).toEqual([{ commodity: "ore", side: "sell", price: 98, qty: 4 }]);
  });

  it("is conserved: replenishes by buying when inventory is below target, even above anchor", () => {
    const out = decide("pulse", params, { ...neutral, lastPrice: 130, inventory: 4000 });
    expect(out).toEqual([{ commodity: "ore", side: "buy", price: 102, qty: 4 }]);
  });

  it("is conserved: distributes by selling when inventory is above target, even below anchor", () => {
    const out = decide("pulse", params, { ...neutral, lastPrice: 70, inventory: 6000 });
    expect(out).toEqual([{ commodity: "ore", side: "sell", price: 98, qty: 4 }]);
  });

  it("only takes a real resting order — no order when the cross side is empty", () => {
    const out = decide("pulse", params, { ...neutral, lastPrice: 100, bestAsk: null });
    expect(out).toEqual([]);
  });

  it("never proposes a buy it cannot fund", () => {
    expect(decide("pulse", params, { ...neutral, lastPrice: 100, credits: 0 })).toEqual([]);
  });

  it("never proposes a sell it cannot back", () => {
    // Tiny target so a near-empty inventory still lands in the neutral band and the
    // price (above anchor) asks for a sell — which the inventory guard must veto.
    const tiny = { commodity: "ore", size: 4, anchor: 100, invTarget: 2, invBand: 3 };
    expect(decide("pulse", tiny, { ...neutral, lastPrice: 104, inventory: 1 })).toEqual([]);
  });
});

describe("pickArb", () => {
  const mkts: ArbMarket[] = [
    { commodity: "ore", lastPrice: 80, bestBid: 79, bestAsk: 81, recentPrices: [100, 100, 100] }, // undervalued
    { commodity: "energy", lastPrice: 130, bestBid: 129, bestAsk: 131, recentPrices: [100, 100, 100] }, // overvalued
    { commodity: "biomass", lastPrice: 100, bestBid: 99, bestAsk: 101, recentPrices: [100, 100, 100] }, // fair
  ];

  it("buys the most-undervalued commodity and sells the most-overvalued it holds", () => {
    const out = pickArb(mkts, { size: 2, credits: 1_000_000, holdings: { energy: 50 } });
    expect(out).toContainEqual({ commodity: "ore", side: "buy", price: 81, qty: 2 });
    expect(out).toContainEqual({ commodity: "energy", side: "sell", price: 129, qty: 2 });
  });

  it("won't sell a commodity it doesn't hold", () => {
    const out = pickArb(mkts, { size: 2, credits: 1_000_000, holdings: {} });
    expect(out.some((o) => o.side === "sell")).toBe(false);
    expect(out.some((o) => o.side === "buy" && o.commodity === "ore")).toBe(true);
  });
});

describe("affordability + holdings guards", () => {
  it("never proposes an order the agent cannot back", () => {
    const broke = { ...rich, credits: 10, inventory: 0 };
    expect(decide("maker", { commodity: "ore", size: 5 }, broke)).toEqual([]);
  });
});
