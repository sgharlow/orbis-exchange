import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type pg from "pg";
import { createPool } from "./connection.js";
import type { DbMode } from "./env.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function appliedVersions(pool: pg.Pool): Promise<string[]> {
  await ensureTable(pool);
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM _migrations ORDER BY id"
  );
  return rows.map((r) => r.id);
}

export async function applyMigrations(pool: pg.Pool, mode: DbMode): Promise<void> {
  await ensureTable(pool);
  const done = new Set(await appliedVersions(pool));
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const id = file.replace(/\.sql$/, "");
    if (done.has(id)) continue;
    let sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    sql = transformForMode(sql, mode);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (id, applied_at) VALUES ($1, now())", [id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${id} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
    console.log(`applied ${id}`);
  }
}

// Aurora DSQL creates secondary indexes asynchronously via CREATE INDEX ASYNC.
// Local Postgres uses plain CREATE INDEX. Migrations are authored with plain
// CREATE INDEX; in dsql mode we rewrite to the ASYNC form.
function transformForMode(sql: string, mode: DbMode): string {
  if (mode !== "dsql") return sql;
  return sql.replace(/CREATE\s+INDEX\s+/gi, "CREATE INDEX ASYNC ");
}

async function ensureTable(pool: pg.Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
       id TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL
     )`
  );
}

// CLI entrypoint (cross-platform: pathToFileURL handles Windows paths)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = (process.env.DB_MODE ?? "local") as DbMode;
  const pool = createPool();
  applyMigrations(pool, mode)
    .then(() => pool.end())
    .then(() => console.log("migrations complete"))
    .catch((e) => { console.error(e); process.exit(1); });
}
