// World-view color model: each resource type emits a distinct luminous hue, and
// a cell's density drives its brightness AND opacity, so a depleted region fades
// into the dark field while a blooming one glows. Pure functions — the canvas
// renderer and the legend both read from here, and they are unit-tested.

export const WORLD_RESOURCE_TYPES = ["ore", "energy", "biomass", "rare"] as const;
export type WorldResourceType = (typeof WORLD_RESOURCE_TYPES)[number];

// Full-brightness base color per resource type.
const BASE_RGB: Record<WorldResourceType, readonly [number, number, number]> = {
  ore: [245, 176, 66], // amber
  energy: [56, 224, 245], // cyan
  biomass: [64, 224, 148], // green
  rare: [196, 132, 252], // violet
};

const FALLBACK_RGB: readonly [number, number, number] = [120, 120, 130];

function baseRgb(resourceType: string): readonly [number, number, number] {
  return (BASE_RGB as Record<string, readonly [number, number, number]>)[resourceType] ?? FALLBACK_RGB;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// rgba string for a grid cell. density 0..100. Low density -> dim + transparent.
export function cellColor(resourceType: string, density: number): string {
  const [r, g, b] = baseRgb(resourceType);
  const t = clamp01(density / 100);
  const lum = 0.15 + 0.85 * t; // channels never fully black, so hue stays legible
  const alpha = 0.1 + 0.9 * t; // depleted cells recede into the background
  const round = (n: number) => Math.round(n * lum);
  return `rgba(${round(r)}, ${round(g)}, ${round(b)}, ${alpha.toFixed(3)})`;
}

// Full-strength swatch color for the legend.
export function legendColor(resourceType: string): string {
  const [r, g, b] = baseRgb(resourceType);
  return `rgb(${r}, ${g}, ${b})`;
}

// Cell ownership relative to the viewer: 0 = unclaimed, 1 = mine, 2 = someone else.
export type Ownership = 0 | 1 | 2;
export function ownershipOf(ownerId: string | null, myId: string | null): Ownership {
  if (!ownerId) return 0;
  return myId !== null && ownerId === myId ? 1 : 2;
}

// Map a click position (relative to the rendered canvas) to a grid index, or null
// if outside the grid. pixelW/pixelH are the canvas's displayed CSS size.
export function cellIndexFromPoint(
  offsetX: number,
  offsetY: number,
  pixelW: number,
  pixelH: number,
  size: number
): number | null {
  if (offsetX < 0 || offsetY < 0 || offsetX >= pixelW || offsetY >= pixelH) return null;
  const x = Math.floor((offsetX / pixelW) * size);
  const y = Math.floor((offsetY / pixelH) * size);
  if (x < 0 || x >= size || y < 0 || y >= size) return null;
  return y * size + x;
}
