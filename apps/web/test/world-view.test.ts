import { describe, it, expect } from "vitest";
import { cellColor, legendColor, WORLD_RESOURCE_TYPES } from "../src/lib/world-view.js";

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
