import { defineConfig } from "vitest/config";

// Default to the documented local test DSN (see .env.example) when unset so the
// DB-backed tick test runs from a clean checkout (Docker Postgres up) without a
// manual export. Pure tests (ca.test.ts) ignore it. Explicit env still wins.
const TEST_DSN =
  process.env.TEST_DATABASE_URL ?? "postgres://orbis:orbis@localhost:5434/orbis_test";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    env: { TEST_DATABASE_URL: TEST_DSN },
    // The DB-backed test does DROP SCHEMA in setup; run files serially.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
