import { defineConfig } from "vitest/config";

// Default to the documented local test DSN (see .env.example) when nothing is
// set, so `pnpm test` runs from a clean checkout (Docker Postgres up) without a
// manual `TEST_DATABASE_URL=...` export. An explicit env var still wins, so CI
// and cloud overrides are unaffected. Always points at orbis_test, never the
// dev DB, because the suites DROP SCHEMA in their setup hooks.
const TEST_DSN =
  process.env.TEST_DATABASE_URL ?? "postgres://orbis:orbis@localhost:5434/orbis_test";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    env: { TEST_DATABASE_URL: TEST_DSN },
    // Test files share one Postgres DB and do DROP SCHEMA in setup hooks;
    // run them serially to avoid concurrent schema-drop race conditions.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
