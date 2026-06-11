import { loadRegionCells, persistTick, persistYields, loadOwnerLevels, type Pool } from "@orbis/db";
import { computeTick, cellKey, type CACell } from "./ca.js";
import { computeMining, multiplierForLevel } from "./mining.js";

export interface RunTickResult {
  generation: number;
  cellsChanged: number;
  mined: number;
}

export interface RunTickOptions {
  /** Extra per-cell mining draw, keyed by `cellKey(x, y)`; merged over (and
   *  overriding) the pressure derived from owned cells. Mainly for tests. */
  extraction?: Map<string, number>;
}

// One simulation tick for a region: load the snapshot, mine owned cells (credit
// inventory + exert extraction pressure), run the CA in memory, and persist only
// the changed cells plus the tick record. The full grid is never rewritten —
// only deltas (spec §5.2/§11). The DB row id is preserved from the load.
export async function runTick(
  pool: Pool,
  region: string,
  generation: number,
  options: RunTickOptions = {}
): Promise<RunTickResult> {
  const cells = await loadRegionCells(pool, region);

  const levels = await loadOwnerLevels(pool, region);
  const multByOwner = new Map(levels.map((l) => [l.owner_id, multiplierForLevel(l.level)]));
  const mining = computeMining(cells, multByOwner);
  const extraction = new Map(mining.extraction);
  if (options.extraction) for (const [k, v] of options.extraction) extraction.set(k, v);

  const idByKey = new Map<string, string>();
  const caCells: CACell[] = cells.map((c) => {
    idByKey.set(cellKey(c.x, c.y), c.id);
    return { x: c.x, y: c.y, density: c.density };
  });

  const { deltas } = computeTick(caCells, { extraction });
  const updates = deltas.map((d) => ({ id: idByKey.get(cellKey(d.x, d.y))!, density: d.to }));

  await persistTick(pool, generation, updates);
  await persistYields(pool, mining.yields);

  const mined = mining.yields.reduce((sum, y) => sum + y.qty, 0);
  return { generation, cellsChanged: updates.length, mined };
}
