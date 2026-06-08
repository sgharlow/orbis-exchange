import { createPool } from "./connection.js";
import { appliedVersions } from "./migrate.js";

// Pre-deploy gate: connect to whatever DB_MODE points at, confirm migrations
// are applied and a trivial read works. Run with DB_MODE=dsql before deploying.
async function smoke(): Promise<void> {
  const pool = createPool();
  try {
    const versions = await appliedVersions(pool);
    if (!versions.includes("0001_init")) {
      throw new Error(`schema not migrated; applied=[${versions.join(",")}]`);
    }
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM players");
    console.log(`smoke OK — migrations=[${versions.join(",")}] players=${rows[0].n}`);
  } finally {
    await pool.end();
  }
}

smoke().catch((e) => { console.error("smoke FAILED:", e.message); process.exit(1); });
