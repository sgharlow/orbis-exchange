import { loadRegionCells, persistTick, type Pool } from "@orbis/db";
import { computeTick, cellKey, type CACell } from "./ca.js";

export interface RunTickResult {
  generation: number;
  cellsChanged: number;
}

export interface RunTickOptions {
  /** Per-cell mining draw this tick, keyed by `cellKey(x, y)`. */
  extraction?: Map<string, number>;
}

// One simulation tick for a region: load the snapshot from the DB, run the CA in
// memory, and persist only the changed cells plus the tick record. The full grid
// is never rewritten — only deltas (spec §5.2/§11). The DB row id is preserved
// from the load, so no id re-encoding is needed on the write path.
export async function runTick(
  pool: Pool,
  region: string,
  generation: number,
  options: RunTickOptions = {}
): Promise<RunTickResult> {
  const cells = await loadRegionCells(pool, region);

  const idByKey = new Map<string, string>();
  const caCells: CACell[] = cells.map((c) => {
    idByKey.set(cellKey(c.x, c.y), c.id);
    return { x: c.x, y: c.y, density: c.density };
  });

  const { deltas } = computeTick(caCells, { extraction: options.extraction });
  const updates = deltas.map((d) => ({ id: idByKey.get(cellKey(d.x, d.y))!, density: d.to }));

  await persistTick(pool, generation, updates);
  return { generation, cellsChanged: updates.length };
}
