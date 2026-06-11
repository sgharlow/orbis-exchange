import { describe, it, expect } from "vitest";
import {
  formatCredits,
  cumulativeDepth,
  spread,
  sparklinePath,
  COMMODITIES,
} from "../src/lib/market-view.js";

describe("formatCredits", () => {
  it("groups thousands and handles edges", () => {
    expect(formatCredits("1234567")).toBe("1,234,567");
    expect(formatCredits("100")).toBe("100");
    expect(formatCredits(9000)).toBe("9,000");
    expect(formatCredits("-4200")).toBe("-4,200");
    expect(formatCredits(null)).toBe("—");
  });
});

describe("cumulativeDepth", () => {
  it("accumulates quantity best-first and reports the max", () => {
    const { rows, max } = cumulativeDepth([
      { price: "100", qty_open: "5" },
      { price: "99", qty_open: "3" },
    ]);
    expect(rows.map((r) => r.cum)).toEqual([5, 8]);
    expect(max).toBe(8);
  });

  it("never divides by zero on an empty book", () => {
    expect(cumulativeDepth([]).max).toBe(1);
  });
});

describe("spread", () => {
  it("is the ask minus bid, or null when a side is missing", () => {
    expect(spread("90", "100")).toBe(10);
    expect(spread(undefined, "100")).toBeNull();
    expect(spread("90", undefined)).toBeNull();
  });
});

describe("sparklinePath", () => {
  it("returns empty for no prices and a flat line for one", () => {
    expect(sparklinePath([], 100, 30)).toBe("");
    expect(sparklinePath([50], 100, 30)).toMatch(/^M 2 15 L 98 15$/);
  });

  it("plots a moveto then one lineto per subsequent price", () => {
    const path = sparklinePath([10, 20, 30], 100, 30);
    expect((path.match(/M/g) || []).length).toBe(1);
    expect((path.match(/L/g) || []).length).toBe(2);
  });
});

describe("COMMODITIES", () => {
  it("lists the four resource markets", () => {
    expect(COMMODITIES).toEqual(["ore", "energy", "biomass", "rare"]);
  });
});
