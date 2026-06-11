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

  it("does nothing without enough history", () => {
    expect(decide("momentum", { commodity: "ore", size: 3 }, { ...rich, recentPrices: [100] })).toEqual([]);
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
