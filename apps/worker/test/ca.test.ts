import { describe, it, expect } from "vitest";
import { computeTick, CA, cellKey, type CACell } from "../src/ca.js";

// density of a cell in a result grid (undefined if absent)
function at(cells: CACell[], x: number, y: number): number | undefined {
  return cells.find((c) => c.x === x && c.y === y)?.density;
}

// build cells from a row-major 2D grid; null = no cell (a hole in the grid)
function grid(rows: Array<Array<number | null>>): CACell[] {
  const cells: CACell[] = [];
  rows.forEach((row, y) =>
    row.forEach((d, x) => {
      if (d !== null) cells.push({ x, y, density: d });
    }),
  );
  return cells;
}

describe("computeTick — spec §4.2 cellular-automaton rules", () => {
  it("exposes the spec §4.2 constants", () => {
    expect(CA.HEALTHY_THRESHOLD).toBe(40);
    expect(CA.REGEN_FLOOR).toBe(35);
    expect(CA.REGEN_RATE).toBeCloseTo(0.2);
    expect(CA.BLOOM_RATE).toBe(4);
    expect(CA.WITHER_RATE).toBe(6);
    expect(CA.CROWD_RATE).toBe(8);
  });

  it("withers an isolated cell (n < 2) by WITHER_RATE", () => {
    const { next, deltas } = computeTick([{ x: 0, y: 0, density: 50 }]);
    expect(at(next, 0, 0)).toBe(44); // 50 - 6
    expect(deltas).toEqual([{ x: 0, y: 0, from: 50, to: 44 }]);
  });

  it("collapses an overcrowded cell (n > 5) by CROWD_RATE", () => {
    const cells = grid([
      [50, 50, 50],
      [50, 50, 50],
      [50, 50, 50],
    ]);
    // center has 8 healthy neighbors -> 50 - 8
    expect(at(computeTick(cells).next, 1, 1)).toBe(42);
  });

  it("blooms a healthy cell with 2..5 healthy neighbors by BLOOM_RATE", () => {
    const cells = grid([
      [50, 50, 50],
      [10, 50, 10],
      [10, 10, 10],
    ]);
    // center: 3 healthy neighbors (top row) -> 50 + 4, below seed threshold
    expect(at(computeTick(cells).next, 1, 1)).toBe(54);
  });

  it("regenerates a low-density cell (d < REGEN_FLOOR) from average neighbor density", () => {
    const cells: CACell[] = [
      { x: 1, y: 1, density: 50 },
      { x: 2, y: 1, density: 50 },
      { x: 3, y: 1, density: 50 },
      { x: 2, y: 2, density: 20 }, // R: 3 healthy neighbors, avg 50 -> 20 + 0.2*50
    ];
    expect(at(computeTick(cells).next, 2, 2)).toBe(30);
  });

  it("seeds the lowest-density neighbor when a bloom crosses the seed threshold", () => {
    const cells: CACell[] = [
      { x: 1, y: 1, density: 50 },
      { x: 2, y: 1, density: 50 },
      { x: 3, y: 1, density: 50 },
      { x: 2, y: 2, density: 88 }, // C: 3 healthy neighbors -> 88+4 = 92 >= 90, seeds
      { x: 2, y: 3, density: 36 }, // T: C's lowest neighbor; withers 36->30 then +25 seed
    ];
    const { next } = computeTick(cells);
    expect(at(next, 2, 2)).toBe(92); // C bloom (no extraction)
    expect(at(next, 2, 3)).toBe(55); // T = 30 (wither) + 25 (BLOOM_SEED_BONUS)
  });

  it("subtracts extraction pressure as the final per-cell draw", () => {
    const ext = new Map([[cellKey(0, 0), 4]]);
    const { next } = computeTick([{ x: 0, y: 0, density: 50 }], { extraction: ext });
    expect(at(next, 0, 0)).toBe(40); // wither 44, then -4 extraction
  });

  it("clamps density to [0, 100]", () => {
    const up = grid([
      [50, 50, 50],
      [10, 99, 10],
      [10, 10, 10],
    ]);
    expect(at(computeTick(up).next, 1, 1)).toBe(100); // 99 + 4 = 103 -> clamped
    expect(at(computeTick([{ x: 0, y: 0, density: 4 }]).next, 0, 0)).toBe(0); // 4 - 6 -> clamped
  });

  it("emits deltas only for cells whose density changed", () => {
    // M = 37 sits between REGEN_FLOOR (35) and HEALTHY_THRESHOLD (40): no branch fires
    const cells: CACell[] = [
      { x: 1, y: 1, density: 50 },
      { x: 2, y: 1, density: 50 },
      { x: 3, y: 1, density: 50 },
      { x: 2, y: 2, density: 37 },
    ];
    const { next, deltas } = computeTick(cells);
    expect(at(next, 2, 2)).toBe(37);
    expect(deltas.some((d) => d.x === 2 && d.y === 2)).toBe(false);
  });

  it("does not mutate the input cells (synchronous snapshot update)", () => {
    const cells: CACell[] = [{ x: 0, y: 0, density: 50 }];
    computeTick(cells);
    expect(cells[0].density).toBe(50);
  });
});
