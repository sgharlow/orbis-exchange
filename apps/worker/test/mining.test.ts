import { describe, it, expect } from "vitest";
import { computeMining, EXTRACT_RATE, type MineCell } from "../src/mining.js";

describe("computeMining", () => {
  it("ignores unclaimed cells", () => {
    const cells: MineCell[] = [{ x: 0, y: 0, density: 80, owner_id: null, resource_type: "ore" }];
    const r = computeMining(cells);
    expect(r.extraction.size).toBe(0);
    expect(r.yields).toEqual([]);
  });

  it("extracts a fraction of density and exerts equal pressure", () => {
    const cells: MineCell[] = [{ x: 2, y: 3, density: 80, owner_id: "p1", resource_type: "ore" }];
    const r = computeMining(cells);
    const amount = Math.floor(80 * EXTRACT_RATE); // 8
    expect(r.extraction.get("2,3")).toBe(amount);
    expect(r.yields).toEqual([{ player_id: "p1", commodity: "ore", qty: amount }]);
  });

  it("aggregates yield per owner per commodity", () => {
    const cells: MineCell[] = [
      { x: 0, y: 0, density: 50, owner_id: "p1", resource_type: "ore" },
      { x: 1, y: 0, density: 70, owner_id: "p1", resource_type: "ore" },
      { x: 2, y: 0, density: 90, owner_id: "p1", resource_type: "energy" },
      { x: 3, y: 0, density: 60, owner_id: "p2", resource_type: "ore" },
    ];
    const r = computeMining(cells);
    const byKey = Object.fromEntries(r.yields.map((y) => [`${y.player_id}/${y.commodity}`, y.qty]));
    expect(byKey["p1/ore"]).toBe(Math.floor(50 * EXTRACT_RATE) + Math.floor(70 * EXTRACT_RATE)); // 5 + 7
    expect(byKey["p1/energy"]).toBe(Math.floor(90 * EXTRACT_RATE)); // 9
    expect(byKey["p2/ore"]).toBe(Math.floor(60 * EXTRACT_RATE)); // 6
  });

  it("skips a depleted owned cell that would yield nothing", () => {
    const cells: MineCell[] = [{ x: 0, y: 0, density: 5, owner_id: "p1", resource_type: "ore" }];
    // floor(5 * 0.1) = 0
    expect(computeMining(cells).yields).toEqual([]);
  });
});
