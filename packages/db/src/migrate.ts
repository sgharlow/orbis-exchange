import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type pg from "pg";
import { createPool } from "./connection.js";
import type { DbMode } from "./env.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// Split a migration file into individual SQL statements. Migrations must contain
// only simple statements terminated by ';' — no PL/pgSQL $$ bodies (Aurora DSQL
// does not support procedural languages anyway).
//
// Strategy: strip the `--` comment portion from each line before splitting on
// ';', so that semicolons that appear inside inline comments (e.g.
// `-- World cells; demo grid`) are never treated as statement delimiters.
export function splitStatements(sql: string): string[] {
  // Strip the comment tail from each line (everything from the first '--' to
  // end-of-line that is not inside a string literal — migrations have no
  // string literals containing '--', so a simple line-level strip is safe).
  const stripped = sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");

  return stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

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
    const statements = splitStatements(transformForMode(await readFile(join(MIGRATIONS_DIR, file), "utf8"), mode));

    if (mode === "dsql") {
      // Aurora DSQL: each transaction may contain only ONE DDL statement, and
      // DDL and DML must be in separate transactions. Run each statement on its
      // own (auto-commit), then record the migration id as a separate DML write.
      // NOTE: DSQL has no transactional DDL, so a mid-file failure leaves a
      // partially-applied migration; on a fresh cluster the happy path is clean,
      // and the cloud runbook documents drop-schema-and-retry for partial failures.
      for (const stmt of statements) {
        try {
          await pool.query(stmt);
        } catch (err) {
          throw new Error(`Migration ${id} failed on statement: ${(err as Error).message}`);
        }
      }
      await pool.query("INSERT INTO _migrations (id, applied_at) VALUES ($1, now())", [id]);
    } else {
      // Local Postgres supports transactional, multi-statement DDL — apply the
      // whole file plus the tracking insert atomically.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const stmt of statements) await client.query(stmt);
        await client.query("INSERT INTO _migrations (id, applied_at) VALUES ($1, now())", [id]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${id} failed: ${(err as Error).message}`);
      } finally {
        client.release();
      }
    }
    console.log(`applied ${id}`);
  }
}

// DSQL creates secondary indexes asynchronously. Rewrite plain CREATE INDEX
// (NOT CREATE UNIQUE INDEX, and not an already-ASYNC statement) to the ASYNC form.
function transformForMode(sql: string, mode: DbMode): string {
  if (mode !== "dsql") return sql;
  return sql.replace(/CREATE\s+INDEX\s+(?!ASYNC\b)/gi, "CREATE INDEX ASYNC ");
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
