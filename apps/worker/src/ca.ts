// Cellular-automaton resource rules — spec §4.2.
//
// Pure, in-memory tick computation. Density evolves by local Conway-style rules:
// too few healthy neighbors wither, a balanced neighborhood regenerates/blooms,
// overcrowding collapses; extraction is a separate downward draw layered on top.
//
// The update is synchronous: every cell's next density is computed from the same
// immutable snapshot, then committed together (no cell sees a half-updated grid).
// The function returns the full next grid AND the set of changed cells (deltas),
// because the cost guardrail (spec §5.2/§11) is to persist only deltas, never the
// full grid each tick.
//
// Two points the spec leaves to the implementation, fixed here and recorded in
// spec §4.2: (a) average_neighbor_density is the mean over all *present* Moore
// neighbors; (b) seed_lowest_adjacent adds BLOOM_SEED_BONUS to the lowest-density
// present neighbor (ties broken by smallest x, then y), applied in the synchronous
// commit before the final extraction draw. Densities persist as integers
// (SMALLINT 0..100), so the float result is rounded then clamped.

export const CA = {
  HEALTHY_THRESHOLD: 40,
  REGEN_FLOOR: 35,
  REGEN_RATE: 0.2,
  BLOOM_RATE: 4,
  WITHER_RATE: 6,
  CROWD_RATE: 8,
  BLOOM_SEED_THRESHOLD: 90,
  BLOOM_SEED_BONUS: 25,
  MIN_DENSITY: 0,
  MAX_DENSITY: 100,
} as const;

export interface CACell {
  x: number;
  y: number;
  density: number;
}

export interface CellDelta {
  x: number;
  y: number;
  from: number;
  to: number;
}

export interface TickResult {
  next: CACell[];
  deltas: CellDelta[];
}

export interface TickOptions {
  /** Per-cell mining draw this tick, keyed by `cellKey(x, y)`. Absent = 0. */
  extraction?: Map<string, number>;
}

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

// Moore neighborhood: the 8 surrounding offsets.
const OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], /*    */ [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function computeTick(cells: ReadonlyArray<CACell>, options: TickOptions = {}): TickResult {
  const extraction = options.extraction ?? new Map<string, number>();

  // Immutable snapshot: every cell's branch reads from this, never from partial results.
  const snapshot = new Map<string, number>();
  for (const c of cells) snapshot.set(cellKey(c.x, c.y), c.density);

  const base = new Map<string, number>(); // post-branch next density (float)
  const seedBonus = new Map<string, number>(); // cross-cell bloom seeding, applied after base

  for (const c of cells) {
    const d = c.density;
    let healthy = 0;
    let sum = 0;
    let count = 0;
    let lowestKey: string | null = null;
    let lowestVal = Infinity;
    let lowestX = Infinity;
    let lowestY = Infinity;

    for (const [dx, dy] of OFFSETS) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      const nd = snapshot.get(cellKey(nx, ny));
      if (nd === undefined) continue;
      count++;
      sum += nd;
      if (nd >= CA.HEALTHY_THRESHOLD) healthy++;
      // lowest-density neighbor; deterministic tie-break: density, then x, then y
      if (nd < lowestVal || (nd === lowestVal && (nx < lowestX || (nx === lowestX && ny < lowestY)))) {
        lowestVal = nd;
        lowestKey = cellKey(nx, ny);
        lowestX = nx;
        lowestY = ny;
      }
    }

    const avg = count > 0 ? sum / count : 0;
    let next = d;

    if (d < CA.REGEN_FLOOR && healthy >= 2 && healthy <= 3) {
      next = d + CA.REGEN_RATE * avg; // regeneration / birth
    } else if (d >= CA.HEALTHY_THRESHOLD && healthy >= 2 && healthy <= 5) {
      next = d + CA.BLOOM_RATE; // stable bloom
      if (next >= CA.BLOOM_SEED_THRESHOLD && lowestKey !== null) {
        seedBonus.set(lowestKey, (seedBonus.get(lowestKey) ?? 0) + CA.BLOOM_SEED_BONUS);
      }
    } else if (healthy < 2) {
      next = d - CA.WITHER_RATE; // isolation / underpopulation
    } else if (healthy > 5) {
      next = d - CA.CROWD_RATE; // overcrowding collapse
    }

    base.set(cellKey(c.x, c.y), next);
  }

  // Synchronous commit: seed bonuses, then the final per-cell extraction draw, then round + clamp.
  const next: CACell[] = [];
  const deltas: CellDelta[] = [];
  for (const c of cells) {
    const k = cellKey(c.x, c.y);
    let v = base.get(k)!;
    v += seedBonus.get(k) ?? 0;
    v -= extraction.get(k) ?? 0;
    const finalDensity = clamp(Math.round(v), CA.MIN_DENSITY, CA.MAX_DENSITY);
    next.push({ x: c.x, y: c.y, density: finalDensity });
    if (finalDensity !== c.density) {
      deltas.push({ x: c.x, y: c.y, from: c.density, to: finalDensity });
    }
  }

  return { next, deltas };
}
