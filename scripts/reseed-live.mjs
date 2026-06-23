// Re-seed the LIVE production world to the clean agent-only baseline.
//
//   pnpm db:reseed-live      (or: node scripts/reseed-live.mjs)
//
// Safe sequence: pause the heartbeat -> drain in-flight ticks -> reset (DSQL) ->
// ALWAYS resume the worker -> verify. Run this right before recording: a fresh
// world drifts back toward miner-dominated within an hour or two of ticking, and
// the reset wipes all human players, so re-seed BEFORE you join as your demo
// player (otherwise your tab self-heals into a fresh guest mid-demo).
//
// Two foot-guns this script is built to avoid (both bit a manual run):
//   1. The worker must come back even if the reset fails -> resume() in `finally`.
//   2. The DSQL/AWS-vercel creds are scoped to the reset child ONLY, so the
//      `aws scheduler` calls keep using the default AWS profile (which owns the
//      schedule). Leaking the DSQL creds into the scheduler calls => AccessDenied.
//
// Prereqs: AWS CLI logged in as the schedule owner (default profile); Vercel CLI
// authed (to pull the production DSQL env).

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REGION = "us-east-1";
const SCHEDULE = "orbis-heartbeat";
const LAMBDA_ARN = "arn:aws:lambda:us-east-1:461293170793:function:orbis-tick";
const ROLE_ARN = "arn:aws:iam::461293170793:role/orbis-scheduler";
const PROD = "https://orbis-exchange.vercel.app";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function aws(args) {
  return spawnSync("aws", args, { encoding: "utf8", shell: true });
}
function scheduleState() {
  const r = aws(["scheduler", "get-schedule", "--name", SCHEDULE, "--region", REGION, "--query", "State", "--output", "text"]);
  return r.status === 0 ? r.stdout.trim() : null;
}
function resume() {
  if (scheduleState() !== "ENABLED") {
    aws([
      "scheduler", "create-schedule", "--name", SCHEDULE,
      "--schedule-expression", "rate(1 minute)",
      "--flexible-time-window", JSON.stringify({ Mode: "OFF" }),
      "--target", JSON.stringify({ Arn: LAMBDA_ARN, RoleArn: ROLE_ARN }),
      "--region", REGION,
    ]);
  }
  return scheduleState();
}

async function main() {
  let resetRc = 1;
  try {
    console.log("[1/4] pausing worker (deleting the heartbeat schedule)…");
    aws(["scheduler", "delete-schedule", "--name", SCHEDULE, "--region", REGION]); // ok if it doesn't exist

    console.log("[2/4] draining in-flight ticks (80s, > max Lambda runtime)…");
    await sleep(80_000);

    console.log("[3/4] resetting the world via DSQL…");
    const envfile = path.join(ROOT, ".env.reseed.local");
    spawnSync("vercel", ["env", "pull", "--environment=production", envfile, "--yes"], {
      cwd: ROOT,
      stdio: "ignore",
      shell: true,
    });
    const need = ["DB_MODE", "DSQL_HOST", "DSQL_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"];
    const dsqlEnv = {};
    for (const line of readFileSync(envfile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
      if (m && need.includes(m[1])) dsqlEnv[m[1]] = m[2];
    }
    rmSync(envfile, { force: true });
    if (!dsqlEnv.DSQL_HOST) throw new Error("could not read DSQL env from Vercel (is `vercel` authed?)");

    // DSQL creds go ONLY to this child; the aws scheduler calls above/below keep
    // the parent's default AWS profile.
    const r = spawnSync("pnpm", ["exec", "tsx", "src/reset.ts"], {
      cwd: path.join(ROOT, "packages", "db"),
      env: { ...process.env, ...dsqlEnv },
      stdio: "inherit",
      shell: true,
    });
    resetRc = r.status ?? 1;
    console.log(resetRc === 0 ? "reset OK" : `reset FAILED (rc=${resetRc}) — resuming worker anyway`);
  } finally {
    console.log("[4/4] resuming worker…");
    console.log("worker schedule state:", resume() ?? "UNKNOWN (check `aws scheduler get-schedule`)");
  }

  console.log("verifying the world is advancing…");
  const get = (p) => fetch(PROD + p, { cache: "no-store" }).then((r) => r.json());
  try {
    const a = await get("/api/world?region=r0");
    await sleep(8000);
    const b = await get("/api/world?region=r0");
    console.log(`  gen ${a.generation} -> ${b.generation}`, b.generation > a.generation ? "LIVE ✓" : "(idle window — re-check in a moment)");
    const lb = (await get("/api/leaderboard")).leaderboard ?? [];
    console.log(`  leaderboard: ${lb.length} players, ${lb.filter((e) => e.kind === "human").length} humans; top ${lb[0]?.handle} ${lb[0]?.net_worth}`);
  } catch {
    console.log("  (could not reach prod to verify — check manually)");
  }

  if (resetRc !== 0) process.exit(resetRc);
  console.log("done — world re-seeded to the clean baseline.");
}

main();
