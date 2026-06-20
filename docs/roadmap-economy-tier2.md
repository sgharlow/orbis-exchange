# Economy roadmap — Tier 2: give the world a drain

**Status:** Tier 1 SHIPPED (`6cb2bff`); Tier 2 is the post-launch deep fix.
**Owner decision (2026-06-20):** launch on Tier 1 (healthy market, scout bounded-but-slowly-leading); schedule Tier 2 deliberately, not under the submission deadline.

## The problem (root cause)

Net worth = `credits + Σ(inventory.qty × last_price)`. The cellular-automaton world
**regenerates** resource density, so mineable supply over time is effectively
**infinite**. A claimer mines that supply into inventory every tick. With an
infinite faucet and inventory counted at market price, whoever captures the
faucet accumulates **unbounded paper wealth** — value they could never actually
realize (selling the hoard would collapse a thin order book).

`scout-r0` was the agent that did exactly this: claimed 1 cell/tick (no cap),
mined all owned cells, never sold. Result was a **quadratic** net-worth runaway.

### Evidence — three configs, identical 600/400-gen local sim

| Config | Scout outcome | Market | Verdict |
|---|---|---|---|
| **Baseline** (claim-only) | quadratic runaway — **46×** field by gen 600, billions over hours | prices fine | leaderboard broken |
| **B / Tier 1** (cap 5, passive asks) | linear **creep** — 2.2× at gen 400 | **healthy (~100)** | market good; scout slowly leads |
| Aggressive (cap 2, dump at bid) | **bounded** — stable 1.47×, mid-pack | **ore & rare crash to 1** | scout fixed; *market* broken |

**What the three configs prove:** you cannot fix this by tuning the miner alone.
Mined value has to go *somewhere* — don't sell → it piles up (runaway); sell gently
→ realized in full → still grows (creep); sell hard → crashes the price of what you
mine (dead market). Same root cause, three faces. **The value needs a sink.**

## Tier 1 — what shipped (`6cb2bff`)

`apps/worker/src/run-agents.ts`: the scout is now a **bounded supplier** —
caps its footprint at **5 cells** (bounds mining inflow) and posts its mined output
**passively at the best ask** each tick (realizes value through real trades without
crashing price). Net worth grows linearly-and-slowly instead of quadratically; the
market stays healthy. Good enough for launch + a realistic play session (~1.5–2×
over an hour). New TDD test: *"a scout sells its surplus inventory and realizes value."*

Tier 1 is a **mitigation**, not the cure: the scout still slowly out-produces a thin
13-bot demand side, so its net worth creeps. That residual creep is the faucet-with-
no-drain showing through.

## Tier 2 — the cure: a consumption sink

Make mined commodities get **consumed**, so production has a destination, demand is
organic, and wealth comes from *allocation skill* rather than raw accumulation.
Build on existing systems; pick **M1 + M2** (M3 optional).

### M1 · Upgrades cost commodities (extend `investExtraction`)
- Today `investExtraction` (raise mining level) costs escalating **credits** only.
- Change: also cost **commodities** — e.g. level `L → L+1` requires `50×(L+1)` energy + biomass (in addition to / instead of credits).
- Effect: anyone who wants to out-mine must **buy** commodities → organic demand
  absorbs miners' supply at a healthy price. Closes the loop **mine → sell → buy →
  upgrade → mine more**. Commodities become **capital goods**, not just score.
- Touchpoints: `packages/db` invest query (deduct commodity inventory in the same
  conditional-write txn as the credit/level update — keep it one settlement),
  `/api/invest`, agent `value/momentum` may start buying inputs.

### M2 · Cell upkeep (per-tick maintenance)
- Each owned cell costs a small per-tick commodity upkeep (e.g. 1 energy/cell).
  Can't pay → cell goes **fallow** (stops mining / reverts to unclaimed).
- Effect: holding many cells gets expensive; upkeep scales with cells until
  `upkeep ≈ yield` → a **structural cap on accumulation** + steady energy demand.
  Bounds the scout *by construction*, not by tuning.
- Touchpoints: a step in `runTick`/`persistTick` that debits upkeep and fallows
  unpayable cells (chunked for the DSQL row limit); net-worth unaffected (inventory
  spent, not destroyed arbitrarily).

### M3 · (optional) Spoilage on raw inventory
- Raw units decay slowly (~1%/tick) unless sold/used. Cheap hoarding backstop;
  feels slightly punitive — use only if M1+M2 leave a residual.

### Optional valuation honesty
Mark inventory at `best_bid` (or a depth-aware liquidation value) instead of
`last_price` in the leaderboard query (`packages/db/src/queries.ts:9`). Less critical
once M1/M2 bound inventory, but it makes the displayed number the number you could
actually realize.

## Why Tier 2 is worth it

- **Competitiveness:** no win-by-accumulation; you compete on *allocation and timing*. A human can out-think a bot.
- **Fun:** a genuine economic loop (produce → trade → reinvest) with a live two-sided market and real decisions.
- **Uniqueness:** an emergent economy on a strongly-consistent ledger is a far richer story than "watch a grid + trade" — **and every upgrade / upkeep / spoilage is another correctness-critical DSQL settlement**, i.e. more surface for the hero feature.

## Risks & sequencing

- **Balance is the hard part.** Costs/upkeep must reach a healthy equilibrium, not a
  death spiral (upkeep > yield everywhere → everyone goes fallow) or a no-op (too
  cheap). Expect iterative tuning against the local sim (`apps/worker/prototype-sim.mjs`,
  gitignored) before any deploy.
- **Multi-agent dynamics shift.** Adding input-demand changes maker/momentum/value
  behavior; re-verify the market stays liquid (the cold-start lesson).
- **Days, not hours.** New SQL + agent changes + tests + a live soak. Do it *after*
  the submission is locked.

## How to validate (reuse the harness)
`apps/worker/prototype-sim.mjs` runs the real tick+agent loop against local Postgres
with no inter-tick delay, printing the leaderboard (marked at both `last_price` and
`best_bid`) every N gens. Wipe+seed local, apply a Tier-2 change, run 400–600 gens,
watch the top/median ratio and per-commodity prices. Ship only when the ratio stays
flat *and* prices stay healthy.
