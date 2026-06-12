// AWS Lambda entry. EventBridge Scheduler invokes this every minute (its
// finest rate); the handler runs the 3-second heartbeat INSIDE the invocation
// for RUN_BUDGET_MS, then exits. Overlapping invocations are safe: runTick
// claims its generation via the ticks row, so a duplicate worker skips —
// never collides, never double-mines (spec §5.2).

import { createPool, getLatestGeneration } from "@orbis/db";
import { runTick } from "./tick.js";
import { runAgents } from "./run-agents.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function handler(): Promise<{ ticks: number; skipped: number }> {
  const TICK_MS = Number(process.env.TICK_MS ?? 3000);
  const RUN_BUDGET_MS = Number(process.env.RUN_BUDGET_MS ?? 55_000);
  const REGION = process.env.REGION ?? "r0";

  const pool = createPool();
  const deadline = Date.now() + RUN_BUDGET_MS;
  let ticks = 0;
  let skipped = 0;
  try {
    for (;;) {
      const startedAt = Date.now();
      try {
        const generation = (await getLatestGeneration(pool)) + 1;
        const tick = await runTick(pool, REGION, generation);
        if (tick.skipped) {
          skipped += 1;
        } else {
          await runAgents(pool);
          ticks += 1;
        }
      } catch (err) {
        console.error("tick failed:", (err as Error).message);
      }
      const wait = Math.max(0, TICK_MS - (Date.now() - startedAt));
      // stop if there isn't room for another full tick before the deadline
      if (Date.now() + wait + TICK_MS > deadline) break;
      await sleep(wait);
    }
    console.log(`handler done: ${ticks} ticks, ${skipped} skipped`);
    return { ticks, skipped };
  } finally {
    await pool.end();
  }
}
