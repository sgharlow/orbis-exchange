import { describe, it, expect } from "vitest";
import {
  cellId,
  generateWorld,
  regionName,
  GRID_DIM,
  REGION_STRIDE,
  RESOURCE_TYPES,
} from "../src/world.js";

describe("cellId encoding", () => {
  it("encodes (region, x, y) into a stable, contiguous id", () => {
    expect(cellId(0, 0, 0)).toBe(0);
    expect(cellId(0, 1, 0)).toBe(1);
    expect(cellId(0, 0, 1)).toBe(GRID_DIM);
    expect(cellId(1, 0, 0)).toBe(REGION_STRIDE);
  });

  it("is unique across a region's grid and across regions", () => {
    const ids = new Set<number>();
    for (let r = 0; r < 2; r++) {
      for (let y = 0; y < GRID_DIM; y++) {
        for (let x = 0; x < GRID_DIM; x++) ids.add(cellId(r, x, y));
      }
    }
    expect(ids.size).toBe(2 * GRID_DIM * GRID_DIM);
  });

  it("rejects coordinates outside the grid", () => {
    expect(() => cellId(0, GRID_DIM, 0)).toThrow();
    expect(() => cellId(0, 0, -1)).toThrow();
  });
});

describe("generateWorld", () => {
  it("produces regions * size * size cells", () => {
    expect(generateWorld({ regions: 2, size: 3 })).toHaveLength(18);
  });

  it("defaults to a single 64x64 region (the bounded demo world)", () => {
    const cells = generateWorld();
    expect(cells).toHaveLength(GRID_DIM * GRID_DIM);
    expect(cells.every((c) => c.region === regionName(0))).toBe(true);
  });

  it("emits valid, integer densities and known resource types, all at gen 0", () => {
    for (const c of generateWorld({ regions: 1, size: 8 })) {
      expect(Number.isInteger(c.density)).toBe(true);
      expect(c.density).toBeGreaterThanOrEqual(0);
      expect(c.density).toBeLessThanOrEqual(100);
      expect(RESOURCE_TYPES).toContain(c.resource_type);
      expect(c.updated_gen).toBe(0);
    }
  });

  it("assigns unique ids", () => {
    const cells = generateWorld({ regions: 2, size: 8 });
    expect(new Set(cells.map((c) => c.id)).size).toBe(cells.length);
  });

  it("is deterministic (reproducible across runs)", () => {
    expect(generateWorld({ regions: 1, size: 8 })).toEqual(generateWorld({ regions: 1, size: 8 }));
  });
});
