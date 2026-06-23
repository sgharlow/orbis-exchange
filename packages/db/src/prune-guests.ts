import { createPool } from "./connection.js";

// Targeted cleanup: remove human players (guest sessions) and any state they hold,
// without the full world reset and without pausing the worker. Each statement is
// small and retried on DSQL optimistic-concurrency conflict (40001), so it's safe
// to run against the live, ticking world.
async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 6): Promise<T> {
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "40001" && i < tries - 1) {
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${label}: exhausted retries`);
}

async function prune(): Promise<void> {
  const pool = createPool();
  try {
    const humans = await pool.query<{ id: string; handle: string }>(
      "SELECT id, handle FROM players WHERE kind = 'human'"
    );
    console.log(`human players found: ${humans.rows.length}`, humans.rows.map((r) => r.handle).join(", "));
    if (humans.rows.length === 0) {
      console.log("nothing to prune");
      return;
    }
    await withRetry(
      () =>
        pool.query(
          "UPDATE cells SET owner_id = NULL, list_price = NULL WHERE owner_id IN (SELECT id FROM players WHERE kind = 'human')"
        ),
      "release cells"
    );
    await withRetry(
      () => pool.query("DELETE FROM inventory WHERE player_id IN (SELECT id FROM players WHERE kind = 'human')"),
      "inventory"
    );
    await withRetry(
      () => pool.query("DELETE FROM orders WHERE player_id IN (SELECT id FROM players WHERE kind = 'human')"),
      "orders"
    );
    const del = await withRetry(() => pool.query("DELETE FROM players WHERE kind = 'human'"), "players");
    console.log(`pruned human players: ${del.rowCount}`);
  } finally {
    await pool.end();
  }
}

prune().catch((e) => {
  console.error(e);
  process.exit(1);
});
