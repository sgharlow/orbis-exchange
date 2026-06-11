// World generation and cell-id encoding (spec §4.1, §6).
//
// `cells.id` (BIGINT) encodes region + x + y. A region is a GRID_DIM x GRID_DIM
// shard of the world; the bounded demo world is a single 64x64 region
// (spec §4.1, cost guardrail §11). The encoding is:
//
//     id = regionOrdinal * REGION_STRIDE + y * GRID_DIM + x
//
// which is unique and reversible as long as 0 <= x,y < GRID_DIM. Region strings
// are `r{ordinal}`. Generation is deterministic (no Math.random) so a seeded
// world is reproducible across machines and in tests.

export const GRID_DIM = 64;
export const REGION_STRIDE = GRID_DIM * GRID_DIM; // ids reserved per region
export const RESOURCE_TYPES = ["ore", "energy", "biomass", "rare"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export interface CellSeed {
  id: number;
  region: string;
  x: number;
  y: number;
  resource_type: ResourceType;
  density: number;
  updated_gen: number;
}

export function regionName(ordinal: number): string {
  return `r${ordinal}`;
}

export function cellId(regionOrdinal: number, x: number, y: number): number {
  if (x < 0 || x >= GRID_DIM || y < 0 || y >= GRID_DIM) {
    throw new Error(`cell out of range: (${x}, ${y}) must be within 0..${GRID_DIM - 1}`);
  }
  return regionOrdinal * REGION_STRIDE + y * GRID_DIM + x;
}

// Deterministic 32-bit integer hash (reproducible world generation).
function hash32(n: number): number {
  let v = (n + 0x9e3779b9) | 0;
  v = Math.imul(v ^ (v >>> 16), 0x21f0aaad);
  v = Math.imul(v ^ (v >>> 15), 0x735a2d97);
  v ^= v >>> 15;
  return v >>> 0;
}

export interface GenerateWorldOptions {
  regions?: number; // default 1
  size?: number; // grid width/height, default GRID_DIM (64)
}

// Build the initial cell grid: every cell gets a deterministic resource type and
// a starting density in [0, 100]. The cellular automaton turns this noise into
// structure (blooms and collapses) over generations.
export function generateWorld(options: GenerateWorldOptions = {}): CellSeed[] {
  const regions = options.regions ?? 1;
  const size = options.size ?? GRID_DIM;
  if (size > GRID_DIM) throw new Error(`size ${size} exceeds GRID_DIM ${GRID_DIM}`);

  const cells: CellSeed[] = [];
  for (let r = 0; r < regions; r++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const base = (r * REGION_STRIDE + y * GRID_DIM + x) >>> 0;
        const density = hash32(base * 2 + 1) % 101; // 0..100
        const resource_type = RESOURCE_TYPES[hash32(base * 2 + 2) % RESOURCE_TYPES.length];
        cells.push({
          id: cellId(r, x, y),
          region: regionName(r),
          x,
          y,
          resource_type,
          density,
          updated_gen: 0,
        });
      }
    }
  }
  return cells;
}
