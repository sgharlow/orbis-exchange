export type DbMode = "local" | "dsql";

export interface DbEnv {
  mode: DbMode;
  connectionString?: string;   // local
  host?: string;               // dsql
  region?: string;             // dsql
  database: string;
}

export function readDbEnv(): DbEnv {
  const mode = (process.env.DB_MODE ?? "local") as DbMode;
  if (mode === "dsql") {
    const host = required("DSQL_HOST");
    const region = required("DSQL_REGION");
    return { mode, host, region, database: process.env.DSQL_DATABASE ?? "postgres" };
  }
  // local: tests use TEST_DATABASE_URL when present
  const connectionString = process.env.TEST_DATABASE_URL ?? required("DATABASE_URL");
  return { mode: "local", connectionString, database: "orbis" };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
