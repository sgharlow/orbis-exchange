# Known issue — the AI market never trades (cold-start bootstrap deadlock)

**Found:** 2026-06-12 (local dogfood, gen ~837, DB ~2 days old)
**Severity:** P0 for the submission's *credibility* (not a crash; the app runs and
all 114 tests pass). The demo's whole thesis — "the machines trade against you,"
with strongly-consistent settlement as "the demo's whole argument" (spec §6.1) —
is currently hollow in a bot-only world.
**Status:** root-caused, **not yet fixed** (user deferred the fix decision).
**Engine note:** the matching engine and settlement transaction are **correct**.
Do not change `packages/db/src/market.ts` to fix this — the defect is in agent
behaviour / world initialisation, not in matching or the ledger.

## Symptom

In the live local world, the AI agents place orders every tick but **nothing
ever fills**. The worker log shows `agents placed 8 / filled 0` every generation.
The leaderboard degenerates: `scout-r0` runs away (net worth ~122M) while every
other bot sits at *exactly* its 1,500,000 starting credits — i.e. they have never
traded.

## Evidence (live DB, 2026-06-12)

| Probe | Result |
|---|---|
| `SELECT count(*) FROM trades` | **1** — biomass @98, 01:55:37 UTC. That single trade is the **guide-capture script's** sell, not a bot. |
| Open orders by owner | **Only `mm-*` makers post** (each maker ≈ 979 buys + 979 sells resting). `momentum` / `value` / `arb` post **nothing**; `scout` only claims cells. |
| `market_state` | last_price ≈ 98–100 (seed value), never moved (1 trade). |
| `scout-r0` | owns **874** cells, holds **1,295,536** unsold mined units → ~122M net at last price. |
| Other bots' credits | all **1,500,000** (untouched starting balance). |
| Best bid / best ask | 98 / 102 — a fixed 4-wide spread that never crosses. |

## Root cause — a circular dependency between trades and signals

The three **liquidity-taking** strategies are each gated on a recent **trade**
history, but only a take produces a trade, so the tape never bootstraps:

| Strategy | Gate (in `apps/worker/src/agents.ts`) | Cold-start result |
|---|---|---|
| **maker** (`:47–55`) | posts `bid = ref−margin`, `ask = ref+margin` (margin default **2**) around `lastPrice ?? 100` | quotes 98/102 — **two makers never cross each other** |
| **momentum** (`:58–72`) | `if (recent.length < 2) return` | empty tape → silent; even with data needs a `last > first` trend |
| **value** (`:74–88`) | `if (recent.length === 0 ‖ lastPrice === null) return`; acts only if `last < mean·0.95` or `> mean·1.05` | empty tape → silent; at equilibrium `last == mean` → silent |
| **arb** (`:112–135`) | per-commodity `dev = (last−mean)/mean` | flat prices → `dev == 0` → no buy, no sell |

- `recentPrices` is built **only** from `market.recent_trades`
  (`apps/worker/src/run-agents.ts:52,76`), which reads the `trades` table
  (`packages/db/src/market.ts:343–347`).
- `seed.ts` writes a `market_state` row (`:77`) but inserts **no `trades`**, so
  the tape starts empty.
- The matching engine breaks on no-cross (`market.ts:207`), so makers' symmetric
  quotes never settle.

Net: **maker = the only liquidity provider, and it posts a structurally
non-crossing spread; the three takers are blind without a tape only a take can
create.** Deadlock. Worse, this is also the *equilibrium*: even if bootstrapped,
once `last == mean` with no trend, all takers go silent and the market can
re-freeze.

### Why it matters specifically here

The bots exist, per spec §4.5, "to keep the market liquid during a sparse demo
and to be the opponent." They currently do the opposite. A human *can* trade
(selling lifts a maker's resting bid — that is the one recorded trade), so an
*attended* demo works; but an idle deployed URL, an unattended demo recording, or
a judge watching the bots shows a frozen book and one bot eating the world.

## Fix options (engine untouched in all)

1. **Cold-start fallback on the takers (recommended).** Let momentum/value/arb
   act on the *live spread* when they lack trade history and when the market is
   flat (e.g. value buys `bestAsk` when it's cheap vs a reference, sells
   `bestBid` when rich). Fixes the root cause (blind takers) **and** prevents
   re-freeze at equilibrium. Changes strategy logic → must be TDD'd; keeps the
   strategies' character but adds a documented cold-start branch.
2. **Seed a synthetic price history only.** Insert a short varying-price trade
   sequence per commodity in `seed.ts`. Minimal (no strategy change) but
   **can re-freeze** once prices flatten — bootstraps cold start, not steady
   state.
3. **Add a noise-trader behaviour.** Keep the documented 5 strategies pure; add a
   small 6th behaviour (or flag) that occasionally crosses the spread to keep the
   tape warm. Robust, but adds an agent type (mild scope addition).
4. **Maker occasionally marketable.** Make one maker periodically tighten/cross.
   One-strategy change but alters the maker's character.

**Recommendation:** Option 1 — it is the only option that fixes both the cold
start and the equilibrium re-freeze without touching the ledger core. Pair with a
1–2 trade seed kick (a slice of Option 2) so the very first generation already
looks alive on screen.

## Repro / verification probes (for whoever picks this up)

```bash
# 1 = guide script only; bots have never traded
docker compose exec -T postgres psql -U orbis -d orbis -tA -c "SELECT count(*) FROM trades;"
# only mm-* appear → takers post nothing
docker compose exec -T postgres psql -U orbis -d orbis -tA -c \
  "SELECT p.handle, o.side, count(*) FROM orders o JOIN players p ON p.id=o.player_id WHERE o.status='open' GROUP BY p.handle,o.side ORDER BY p.handle;"
# scout runaway vs everyone-else-at-1.5M
curl -s http://localhost:3000/api/leaderboard
```

A correct fix should show `trades` climbing every few generations and bot credits
dispersing away from 1,500,000 — verify live before claiming done.
