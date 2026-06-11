// Orbis simulation worker — the heartbeat (spec §5.2). On a fixed interval it
// advances the cellular-automaton world by one generation (persisting only
// deltas) and runs one algorithmic-agent round so the market stays liquid and
// alive. Off-Vercel by design; for the cloud this loop becomes a scheduled
// Lambda/Fargate invocation, but the body is the same.

import { createPool, getLatestGeneration } from "@orbis/db";
import { runTick } from "./tick.js";
import { runAgents } from "./run-agents.js";

const TICK_MS = Number(process.env.TICK_MS ?? 3000);
const REGION = process.env.REGION ?? "r0";

async function main(): Promise<void> {
  const pool = createPool();
  let generation = await getLatestGeneration(pool);
  console.log(`orbis worker: ticking ${REGION} every ${TICK_MS}ms from generation ${generation}`);

  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      generation += 1;
      const tick = await runTick(pool, REGION, generation);
      const agents = await runAgents(pool);
      console.log(
        `gen ${generation}: ${tick.cellsChanged} cells changed, mined ${tick.mined}; ` +
          `agents placed ${agents.placed} / filled ${agents.fills} / claimed ${agents.claimed}`
      );
    } catch (err) {
      console.error(`gen ${generation} failed:`, (err as Error).message);
    } finally {
      running = false;
    }
  }, TICK_MS);

  const shutdown = async () => {
    clearInterval(timer);
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
