import pg from "pg";
import { readDbEnv } from "./env.js";

const { Pool } = pg;

export function createPool(): pg.Pool {
  const env = readDbEnv();
  if (env.mode === "local") {
    return new Pool({ connectionString: env.connectionString, max: 5 });
  }
  // DSQL mode implemented in a later task
  throw new Error("DSQL mode not yet implemented");
}
