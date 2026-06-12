import { describe, it, expect } from "vitest";
import {
  cellColor,
  legendColor,
  WORLD_RESOURCE_TYPES,
  ownershipOf,
  cellIndexFromPoint,
  outlineFor,
} from "../src/lib/world-view.js";

function alphaOf(rgba: string): number {
  const m = rgba.match(/rgba\([^)]*,\s*([0-9.]+)\)$/);
  if (!m) throw new Error(`not an rgba string: ${rgba}`);
  return Number(m[1]);
}

describe("cellColor", () => {
  it("returns an rgba string", () => {
    expect(cellColor("ore", 50)).toMatch(/^rgba\(\d+, \d+, \d+, [0-9.]+\)$/);
  });

  it("raises opacity with density (depleted cells recede)", () => {
    expect(alphaOf(cellColor("energy", 0))).toBeLessThan(alphaOf(cellColor("energy", 50)));
    expect(alphaOf(cellColor("energy", 50))).toBeLessThan(alphaOf(cellColor("energy", 100)));
  });

  it("keeps each resource type's hue distinct", () => {
    // energy is cyan: blue/green channels dominate red at full density
    const energy = cellColor("energy", 100).match(/\d+/g)!.map(Number);
    expect(energy[2]).toBeGreaterThan(energy[0]); // b > r
    expect(energy[1]).toBeGreaterThan(energy[0]); // g > r
    // ore is amber: red dominates blue
    const ore = cellColor("ore", 100).match(/\d+/g)!.map(Number);
    expect(ore[0]).toBeGreaterThan(ore[2]); // r > b
  });

  it("falls back to a neutral color for an unknown type", () => {
    expect(cellColor("plasma", 100)).toMatch(/^rgba\(\d+, \d+, \d+, [0-9.]+\)$/);
  });
});

describe("legendColor", () => {
  it("returns a full-strength rgb swatch for every resource type", () => {
    for (const t of WORLD_RESOURCE_TYPES) {
      expect(legendColor(t)).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    }
  });
});

describe("ownershipOf", () => {
  it("classifies unclaimed, mine, and others", () => {
    expect(ownershipOf(null, "me")).toBe(0);
    expect(ownershipOf("me", "me")).toBe(1);
    expect(ownershipOf("you", "me")).toBe(2);
    expect(ownershipOf("you", null)).toBe(2); // not joined -> everything owned is "other"
  });
});

describe("outlineFor", () => {
  it("your own cell outlines as own, even when listed", () => {
    expect(outlineFor("p1", "p1", null)).toBe("own");
    expect(outlineFor("p1", "p1", "500")).toBe("own");
  });
  it("another player's listed cell reads as listed", () => {
    expect(outlineFor("p2", "p1", "500")).toBe("listed");
  });
  it("another player's unlisted cell is other", () => {
    expect(outlineFor("p2", "p1", null)).toBe("other");
  });
  it("unclaimed cells get no outline", () => {
    expect(outlineFor(null, "p1", null)).toBe(null);
    expect(outlineFor(null, null, null)).toBe(null);
  });
});

describe("cellIndexFromPoint", () => {
  it("maps a click to the right grid index", () => {
    // 640px canvas, 64 cells -> 10px each
    expect(cellIndexFromPoint(5, 5, 640, 640, 64)).toBe(0); // (0,0)
    expect(cellIndexFromPoint(15, 5, 640, 640, 64)).toBe(1); // (1,0)
    expect(cellIndexFromPoint(5, 15, 640, 640, 64)).toBe(64); // (0,1)
  });

  it("returns null outside the grid", () => {
    expect(cellIndexFromPoint(-1, 5, 640, 640, 64)).toBeNull();
    expect(cellIndexFromPoint(5, 700, 640, 640, 64)).toBeNull();
  });
});
