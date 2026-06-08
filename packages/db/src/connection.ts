import pg from "pg";
import { DsqlSigner } from "@aws-sdk/dsql-signer";
import { readDbEnv } from "./env.js";

const { Pool } = pg;

export function createPool(): pg.Pool {
  const env = readDbEnv();

  if (env.mode === "local") {
    return new Pool({ connectionString: env.connectionString, max: 5 });
  }

  // DSQL: mint a short-lived IAM auth token per new connection.
  // `password` accepts an async function, so the pool refreshes it automatically.
  const signer = new DsqlSigner({ hostname: env.host!, region: env.region! });
  return new Pool({
    host: env.host,
    port: 5432,
    user: "admin",
    database: env.database,
    ssl: { rejectUnauthorized: true },
    max: 5,
    idleTimeoutMillis: 600_000,
    password: async () => signer.getDbConnectAdminAuthToken(),
  });
}
