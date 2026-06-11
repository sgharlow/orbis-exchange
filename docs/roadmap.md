# Orbis Exchange — Roadmap & Spec QA

> QA pass of `orbis-exchange-spec.md` (the build contract) vs the current
> implementation, with gaps prioritized into a roadmap. Snapshot: Phases 0–3
> feature-complete, 91 tests green, all local. Deadline **2026-06-29**.

## Status summary

Built and verified locally: the living world (CA tick, delta persistence,
mining), the strongly-consistent settlement engine, order placement/cancel,
balances + inventory, the market panel, the leaderboard, AI agents
(maker/momentum/value/scout) on a 3-second simulation heartbeat, SSE realtime,
and claim-by-click with owned-cell outlines. Submission docs (README,
architecture diagram SVG+PNG, Devpost write-up, How-to-Play PDF, video script)
are done. **What's not done is cloud + the §4.4 investment layer + some §10 UX.**

## Spec coverage matrix

| Spec | Area | Status | Note |
|------|------|--------|------|
| §3 | Core loop: claim→extract→refine→trade→invest→climb | 🟡 mostly | claim/extract(mine)/trade/climb done; **refine = identity (v1)**; **invest missing** |
| §4.1 | World model (64×64, types, density, owner, gen) | ✅ | single region `r0` |
| §4.2 | Cellular-automaton rules | ✅ | exact constants; spec-open points recorded in §4.2 |
| §4.3 | Single global market (price-time, resting price) | ✅ | |
| §4.4 | Investment: cell resale/lease · extraction upgrade · holdings | 🔴 | resale/lease + invest **missing**; holdings exist |
| §4.5 | Agents: maker·momentum·value·scout·arb | 🟡 | 4 of 5 done; **arb stubbed** |
| §4.6 | Civic layer (stretch) | ⚪ | stretch — not built |
| §5.1 | 3 runtimes share one DB | 🟡 | architecture in place; **workers run as a local loop, not deployed** |
| §5.2 | The tick (in-memory, delta persist) | ✅ | |
| §5.3 | SSE realtime + poll fallback | ✅ | `/api/stream` |
| §5.4 | Multi-region active-active | 🔴 | **not provisioned** (cloud) |
| §6 / §6.1 | Data model + settlement transaction | ✅ | all 8 tables; conditional-write OCC |
| §7 | DSQL rationale (DynamoDB documented, unused) | ✅ | |
| §8 | Stack + deployment | 🟡 | stack ✅ local; **Vercel + DSQL deploy missing** |
| §9 | API surface | 🟡 | have world/market/orders/orders:id/claims/leaderboard/stream; **missing `POST /api/claims/:id/list` and `POST /api/invest`**; `world?since=` not wired (SSE covers deltas) |
| §10 | Frontend/UX | 🟡 | world view ✅ (outlines ✅), market panel ✅ (order book, buy/sell, sparkline), leaderboard ✅; **player dashboard missing**; **leaderboard not on the world screen**; price "chart" is a sparkline |
| §11 | Cost guardrails | 🟡 | in-memory+delta ✅, bounded grid+3s ✅; **AWS Budgets alert + Vercel spend cap not set** (cloud) |
| §12 | Scaling design | 🟡 | per-commodity book ✅; **edge-cached reads not enabled** (routes are force-dynamic); region sharding is single-region in practice |
| §13 | Phases 0–4 | 🟡 | 1–3 done locally; **Phase 0 cloud bits + Phase 4 ship outstanding** |
| §14 | Demo + submission | 🔴 | script + diagram ready; **video, storage screenshots, Vercel link, submit** outstanding |
| §17 | Defaults (4 commodities, 64×64, 3s, BIGINT, handle auth) | ✅ | magic-link auth not done (was "if time allows") |

Legend: ✅ done · 🟡 partial · 🔴 missing · ⚪ stretch.

---

## Roadmap (prioritized)

### P0 — Ship blockers (cloud + submission; mostly user-gated)

1. **Provision Aurora DSQL** (single-region) + apply migrations/seed + `db:smoke`
   against the live cluster. Runbook: `docs/superpowers/runbooks/phase-0-cloud-provisioning.md`.
2. **Deploy `apps/web` to Vercel** (root `apps/web`, DSQL env vars + `SESSION_SECRET`); verify live `/api/health` reads DSQL.
3. **Deploy the worker as a scheduled job** (EventBridge → Lambda, every 3s/1m) so
   the world ticks and agents trade in the cloud — today the heartbeat only runs
   locally. Needs single-flight generation handling (see Hardening #1).
4. **Cost guardrails (§11, mandatory):** AWS Budgets low-threshold alert + Vercel
   Spend Management auto-pause.
5. **Multi-region** active-active cluster stood up briefly to capture the demo +
   storage screenshots (§5.4/§12).
6. **Submission (§14):** record the video (script ready), capture DSQL storage
   screenshots, publish video, paste Vercel link + Team ID, submit on Devpost.

### P1 — Game completeness vs spec (buildable now, no cloud)

7. **Investment / extraction upgrade (§4.4, §9 `POST /api/invest`).** Add a
   per-player extraction multiplier (new column/table) that boosts mined yield at
   the cost of faster depletion; wire the endpoint + a UI control.
8. **Player dashboard (§10).** Surface the signed-in player's **credits,
   inventory, and owned cells** (add a `GET /api/me` or extend an existing read).
   Today a player can't see their own balance/holdings in the UI.
9. **Leaderboard on the world screen (§10:** "always on screen"). Embed a compact
   leaderboard panel on `/world` (it lives only on `/` today), agents tagged.
10. **Cell secondary market (§4.4, §9 `POST /api/claims/:id/list`).** List an owned
    cell for sale/lease; let others buy it through the ledger.
11. **`arb` agent (§4.5).** Exploit transient gaps between commodities; currently
    returns no intent.

### P2 — Hardening / polish

12. **Worker single-flight / idempotent generation.** The loop derives `gen` from
    `max(generation)+1`; two instances collide on `ticks_pkey` (observed locally).
    For scheduled-Lambda use, allocate the generation atomically (e.g. insert the
    `ticks` row first as the lock, or `INSERT … ON CONFLICT DO NOTHING` + skip).
13. **Edge-cached reads (§12).** Serve the world/market snapshots from a short-TTL
    edge cache reconciled with deltas, to keep reads off the write path.
14. **Richer price chart (§10).** The sparkline is minimal; a small candle/line
    chart per commodity would read better in the demo.
15. **`/api/world?since=` (§9).** Wire the documented REST delta param (SSE already
    delivers deltas; this is for completeness / fallback).
16. **Refine step (§3/§4.4).** v1 mines a cell's `resource_type` directly as the
    commodity. A distinct raw→refined step (improvable by infrastructure) would
    match the spec's six-step loop.
17. **Mobile layout pass (§16).** Audit the two-panel layout on narrow screens.

### P3 — Stretch (§16; cut-first, optional)

18. Civic governance voting (§4.6).
19. Bedrock analyst agent that narrates strategy (off the critical path).
20. Resource futures / simple derivatives.
21. World replay / timelapse for the demo.
22. Magic-link auth (§17, "if time allows").

---

## Known simplifications (intentional, documented)

- **Refine = identity:** a cell's resource type is credited directly as the
  tradeable commodity (no separate refining tier yet).
- **Single region (`r0`):** multi-region is a configuration/demo step, not a
  rebuild (spec §5.4/§15); the scale story lives in the architecture.
- **Workers as a dev loop:** correct for local/dev; cloud deployment is P0 #3.
- **Auth:** handle + signed session cookie (spec default); magic-link is optional.

## Recommended order to the deadline

Finish **P1 #7–9** (invest + player dashboard + leaderboard-on-world) for a
visibly complete game, then run the **P0** cloud + submission track (provision →
deploy worker → guardrails → multi-region snapshot → video → submit). P2/P3 only
if time remains. Per §15: when behind, cut investment, civic, and the analyst
agent first.
