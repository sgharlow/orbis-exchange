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

// Full-strength RGB triple per resource type (for canvas accent pips). Energy is
// brand-cyan, which vanishes against the cyan density field — callers should give
// it a distinct (white-cored) treatment.
export function resourceRgb(resourceType: string): readonly [number, number, number] {
  return baseRgb(resourceType);
}

// ---- Living density field: single-hue cyan ramp (spec §A) ----------------------
// The cellular automaton's structure lives in density, not type, so the board's
// base layer paints density alone on one hue ramp (dark/scarce -> hot/abundant).
// Pure: the canvas renderer builds an ImageData from this, and it is unit-tested.
const RAMP_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [8, 12, 26]],
  [0.35, [18, 54, 112]],
  [0.6, [32, 140, 205]],
  [0.82, [56, 224, 245]],
  [1, [214, 250, 255]],
];

// Map a density (0..100) to an [r,g,b] triple on the cyan ramp (linear interp).
export function rampColor(density: number): [number, number, number] {
  const t = clamp01(density / 100);
  for (let i = 1; i < RAMP_STOPS.length; i++) {
    const [t1, c1] = RAMP_STOPS[i];
    if (t <= t1) {
      const [t0, c0] = RAMP_STOPS[i - 1];
      const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  const last = RAMP_STOPS[RAMP_STOPS.length - 1][1];
  return [last[0], last[1], last[2]];
}

// A reveal-layer accents only cells of its type that are at least this dense, so
// the overlay reads as a sparse fleck instead of re-adding the original noise.
export const ACCENT_DENSITY_THRESHOLD = 55;

// The hover tooltip teaches the game inline: it names the cell, its commodity and
// density, and the state-specific next action. Pure -> unit-tested.
export interface HoverCell {
  x: number;
  y: number;
  resource_type: string;
  density: number;
  owner_id: string | null;
  list_price: string | null;
}

function groupThousands(raw: string): string {
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function hoverLabel(cell: HoverCell, myId: string | null): string {
  const at = `(${cell.x},${cell.y})`;
  if (cell.list_price !== null) {
    const price = `${groupThousands(cell.list_price)} cr`;
    const mine = myId !== null && cell.owner_id === myId;
    return `${at} · ${mine ? "yours · " : ""}listed · ${price}`;
  }
  if (cell.owner_id !== null) {
    if (myId !== null && cell.owner_id === myId) {
      return `${at} · yours · mining ${cell.resource_type} · click to sell`;
    }
    return `${at} · ${cell.resource_type} · density ${cell.density} · owned`;
  }
  return `${at} · ${cell.resource_type} · density ${cell.density} · click to claim · 500 cr`;
}

// Cell ownership relative to the viewer: 0 = unclaimed, 1 = mine, 2 = someone else.
export type Ownership = 0 | 1 | 2;
export function ownershipOf(ownerId: string | null, myId: string | null): Ownership {
  if (!ownerId) return 0;
  return myId !== null && ownerId === myId ? 1 : 2;
}

// Which outline a cell gets: your cells outline bright (white), cells another
// player has listed for sale outline gold, other owned cells a faint grey.
export type Outline = "own" | "listed" | "other" | null;
export function outlineFor(
  ownerId: string | null,
  myId: string | null,
  listPrice: string | null
): Outline {
  const own = ownershipOf(ownerId, myId);
  if (own === 1) return "own";
  if (own === 2) return listPrice !== null ? "listed" : "other";
  return null;
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
