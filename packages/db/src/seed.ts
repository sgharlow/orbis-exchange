import type pg from "pg";
import { createPool } from "./connection.js";
import { generateWorld, type CellSeed } from "./world.js";

const COMMODITIES = ["ore", "energy", "biomass", "rare"] as const;

// Algorithmic agents that seed liquidity and act as the opponent (spec §4.5).
// Every commodity gets the same three-way ecology: a market maker (liquidity), a
// momentum trader (probes the spread to bootstrap price discovery so the book
// never freezes uncrossed), and a value trader (mean-reversion that bounds the
// excursion so prices oscillate rather than drift). The cross-commodity arb and
// the scout operate on the demo commodity / globally. Each starts
// well-capitalised and holding inventory so makers can quote both sides from the
// first tick.
const AGENT_CREDITS = 1_000_000;
const AGENT_INVENTORY = 5_000;
// kind 'market' = infrastructure liquidity (makers + the pulse trader): they keep the
// book two-sided and the tape warm, but they are NOT competitors, so the leaderboard
// hides them (getLeaderboard excludes kind='market'). kind 'agent' = the opponents you
// can actually out-trade (momentum/value/scout/arb), which stay on the board.
const AGENTS = [
  { id: "a0000000-0000-0000-0000-0000000000a1", handle: "mm-ore", kind: "market", strategy: "maker", params: { commodity: "ore", size: 5, margin: 2 } },
  { id: "a0000000-0000-0000-0000-0000000000a2", handle: "mm-energy", kind: "market", strategy: "maker", params: { commodity: "energy", size: 5, margin: 2 } },
  { id: "a0000000-0000-0000-0000-0000000000a3", handle: "mm-biomass", kind: "market", strategy: "maker", params: { commodity: "biomass", size: 5, margin: 2 } },
  { id: "a0000000-0000-0000-0000-0000000000a4", handle: "mm-rare", kind: "market", strategy: "maker", params: { commodity: "rare", size: 5, margin: 2 } },
  { id: "a0000000-0000-0000-0000-0000000000a5", handle: "momentum-ore", kind: "agent", strategy: "momentum", params: { commodity: "ore", size: 3, lookback: 5 } },
  { id: "a0000000-0000-0000-0000-0000000000a6", handle: "value-ore", kind: "agent", strategy: "value", params: { commodity: "ore", size: 3, band: 0.04, lookback: 10 } },
  { id: "a0000000-0000-0000-0000-0000000000a7", handle: "scout-r0", kind: "agent", strategy: "scout", params: { commodity: "ore", size: 1, region: "r0" } },
  { id: "a0000000-0000-0000-0000-0000000000a8", handle: "arb-bot", kind: "agent", strategy: "arb", params: { commodity: "ore", size: 3, lookback: 10 } },
  { id: "a0000000-0000-0000-0000-0000000000a9", handle: "momentum-energy", kind: "agent", strategy: "momentum", params: { commodity: "energy", size: 3, lookback: 5 } },
  { id: "a0000000-0000-0000-0000-0000000000aa", handle: "momentum-biomass", kind: "agent", strategy: "momentum", params: { commodity: "biomass", size: 3, lookback: 5 } },
  { id: "a0000000-0000-0000-0000-0000000000ab", handle: "momentum-rare", kind: "agent", strategy: "momentum", params: { commodity: "rare", size: 3, lookback: 5 } },
  { id: "a0000000-0000-0000-0000-0000000000ac", handle: "value-energy", kind: "agent", strategy: "value", params: { commodity: "energy", size: 3, band: 0.04, lookback: 10 } },
  { id: "a0000000-0000-0000-0000-0000000000ad", handle: "value-biomass", kind: "agent", strategy: "value", params: { commodity: "biomass", size: 3, band: 0.04, lookback: 10 } },
  { id: "a0000000-0000-0000-0000-0000000000ae", handle: "value-rare", kind: "agent", strategy: "value", params: { commodity: "rare", size: 3, band: 0.04, lookback: 10 } },
  // Baseline liquidity/noise trader per commodity — guarantees regular two-sided
  // demand with a handful of (or zero) real players. invTarget == AGENT_INVENTORY so it
  // starts inventory-neutral and oscillates price around the anchor; conserved, so no runaway.
  { id: "a0000000-0000-0000-0000-0000000000b1", handle: "pulse-ore", kind: "market", strategy: "pulse", params: { commodity: "ore", size: 4, anchor: 100, invTarget: 5000, invBand: 200 } },
  { id: "a0000000-0000-0000-0000-0000000000b2", handle: "pulse-energy", kind: "market", strategy: "pulse", params: { commodity: "energy", size: 4, anchor: 100, invTarget: 5000, invBand: 200 } },
  { id: "a0000000-0000-0000-0000-0000000000b3", handle: "pulse-biomass", kind: "market", strategy: "pulse", params: { commodity: "biomass", size: 4, anchor: 100, invTarget: 5000, invBand: 200 } },
  { id: "a0000000-0000-0000-0000-0000000000b4", handle: "pulse-rare", kind: "market", strategy: "pulse", params: { commodity: "rare", size: 4, anchor: 100, invTarget: 5000, invBand: 200 } },
] as const;

async function seedAgents(pool: pg.Pool): Promise<void> {
  for (const a of AGENTS) {
    // DO UPDATE (not DO NOTHING) on the handle/kind so re-running the seed against an
    // existing world brings the roster to current — notably flipping the makers to
    // kind='market' so the leaderboard exclusion takes effect without a fresh world.
    // Credits are left alone here (reset.ts owns balance resets).
    await pool.query(
      `INSERT INTO players (id, handle, kind, credits, home_region, created_at)
         VALUES ($1, $2, $3, $4::bigint, 'us-east', now())
         ON CONFLICT (id) DO UPDATE SET handle = EXCLUDED.handle, kind = EXCLUDED.kind`,
      [a.id, a.handle, a.kind, AGENT_CREDITS]
    );
    await pool.query(
      `INSERT INTO agents (player_id, strategy, params) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (player_id) DO NOTHING`,
      [a.id, a.strategy, JSON.stringify(a.params)]
    );
    await pool.query(
      `INSERT INTO inventory (player_id, commodity, qty) VALUES ($1, $2, $3::bigint)
         ON CONFLICT (player_id, commodity) DO NOTHING`,
      [a.id, a.params.commodity, AGENT_INVENTORY]
    );
  }
}

// Insert cells in bounded batches: keeps each statement well under pg's parameter
// cap and each transaction short (DSQL-friendly). Idempotent via ON CONFLICT.
async function insertCells(pool: pg.Pool, cells: CellSeed[], batchSize = 500): Promise<void> {
  for (let i = 0; i < cells.length; i += batchSize) {
    const batch = cells.slice(i, i + batchSize);
    const values: string[] = [];
    const params: unknown[] = [];
    batch.forEach((c, j) => {
      const b = j * 7;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`);
      params.push(c.id, c.region, c.x, c.y, c.resource_type, c.density, c.updated_gen);
    });
    await pool.query(
      `INSERT INTO cells (id, region, x, y, resource_type, density, updated_gen)
       VALUES ${values.join(",")}
       ON CONFLICT (id) DO NOTHING`,
      params
    );
  }
}

async function seed(): Promise<void> {
  const pool = createPool();
  try {
    // The seeded world is a pure algorithmic-agent ecology (the 14 AGENTS below).
    // No placeholder humans are seeded: the only human on the leaderboard is the
    // live participant who joins, which is the "AI vs human on one ledger" reveal.
    for (const c of COMMODITIES) {
      await pool.query(
        `INSERT INTO market_state (commodity, last_price, best_bid, best_ask, generation)
         VALUES ($1, 100, NULL, NULL, 0)
         ON CONFLICT (commodity) DO NOTHING`,
        [c]
      );
    }

    // The bounded demo world: one 64x64 region (spec §4.1, §11).
    const world = generateWorld();
    await insertCells(pool, world);

    await seedAgents(pool);

    console.log(`seed complete (${world.length} cells, ${AGENTS.length} agents)`);
  } finally {
    await pool.end();
  }
}

seed().catch((e) => { console.error(e); process.exit(1); });
