import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Test files share one Postgres DB and do DROP SCHEMA in setup hooks;
    // run them serially to avoid concurrent schema-drop race conditions.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
