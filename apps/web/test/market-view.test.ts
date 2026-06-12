import { describe, it, expect } from "vitest";
import {
  formatCredits,
  cumulativeDepth,
  spread,
  chartGeometry,
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

describe("chartGeometry", () => {
  it("returns null with no trades", () => {
    expect(chartGeometry([], 220, 84)).toBeNull();
  });

  it("maps min to the bottom and max to the top of the padded box", () => {
    const g = chartGeometry([10, 20], 220, 80, 4)!;
    expect(g.min).toBe(10);
    expect(g.max).toBe(20);
    expect(g.line).toBe("M 4.0 76.0 L 216.0 4.0");
    expect(g.lastX).toBeCloseTo(216);
    expect(g.lastY).toBeCloseTo(4);
  });

  it("closes the area path down to the baseline", () => {
    const g = chartGeometry([10, 20], 220, 80, 4)!;
    expect(g.area).toBe("M 4.0 76.0 L 216.0 4.0 L 216.0 76.0 L 4.0 76.0 Z");
  });

  it("centers a single trade as a flat reference", () => {
    const g = chartGeometry([15], 220, 80, 4)!;
    expect(g.min).toBe(15);
    expect(g.max).toBe(15);
    expect(g.lastX).toBeCloseTo(110); // pad + innerW/2
  });
});

describe("COMMODITIES", () => {
  it("lists the four resource markets", () => {
    expect(COMMODITIES).toEqual(["ore", "energy", "biomass", "rare"]);
  });
});
