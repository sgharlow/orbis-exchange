import { describe, it, expect } from "vitest";
import { decide, type AgentContext } from "../src/agents.js";

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

describe("affordability + holdings guards", () => {
  it("never proposes an order the agent cannot back", () => {
    const broke = { ...rich, credits: 10, inventory: 0 };
    expect(decide("maker", { commodity: "ore", size: 5 }, broke)).toEqual([]);
  });
});
