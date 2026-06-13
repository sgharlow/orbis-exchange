# Orbis Exchange — Roadmap & Spec QA

> QA pass of `orbis-exchange-spec.md` (the build contract) vs the current
> implementation, with all remaining work prioritized into a dated roadmap.
> Rebaselined **2026-06-12** (AI cold-start fix): `pnpm -r test` =
> **122 green** — db 51 + web 27 + worker 44; `pnpm -r lint` clean; Lambda
> bundle builds + smokes; HEAD `18d8978` pushed. Implementation plan:
> `docs/superpowers/plans/2026-06-11-complete-hackathon-entry.md` (Part A
> tasks 1–11 ✅ done; Part B cloud/ship remains). Deadline
> **2026-06-29 5:00pm PDT** — **18 days out**.

## Status summary

Phases 0–3 of spec §13 are **feature-complete locally**: the living world (CA
tick, delta persistence, mining), the strongly-consistent settlement engine,
order placement/cancel, balances + inventory, market panel, leaderboard, player
dashboard, investment/extraction upgrades, cell secondary market, all five AI
agents (maker/momentum/value/scout/arb) on a 3-second heartbeat, SSE realtime,
claim-by-click. Submission docs (README, architecture diagram SVG+PNG, Devpost
write-up, How-to-Play PDF, video script) are drafted.

**Everything that remains is the cloud track + submission polish.** Nothing has
been provisioned: no DSQL cluster, no Vercel deploy, no scheduled worker, no
cost guardrails, no video. That is ~all of Phase 0-cloud and Phase 4, plus the
hardening needed to run the worker as a scheduled job instead of a dev loop.

## Spec coverage matrix

| Spec | Area | Status | Note |
|------|------|--------|------|
| §3 | Core loop: claim→extract→refine→trade→invest→climb | 🟡 mostly | all steps done except **refine = identity (v1)** |
| §4.1 | World model (64×64, types, density, owner, gen) | ✅ | single region `r0` |
| §4.2 | Cellular-automaton rules | ✅ | exact constants; spec-open points recorded in §4.2 |
| §4.3 | Single global market (price-time, resting price) | ✅ | |
| §4.4 | Investment: cell resale/lease · extraction upgrade · holdings | ✅ | fully done incl. sell/unlist UI + gold listed-cell outlines (6-11) |
| §4.5 | Agents: maker·momentum·value·scout·arb | ✅ | all 5 (arb is cross-commodity mean-reversion) |
| §4.6 | Civic layer (stretch) | ⚪ | stretch — not built |
| §5.1 | 3 runtimes share one DB | 🟡 | single-flight ticks + Lambda handler + esbuild bundle DONE (6-11); **cloud deploy itself pending (Part B)** |
| §5.2 | The tick (in-memory, delta persist) | ✅ | |
| §5.3 | SSE realtime + poll fallback | ✅ | `/api/stream` |
| §5.4 | Multi-region active-active | 🔴 | **not provisioned** (cloud) |
| §6 / §6.1 | Data model + settlement transaction | ✅ | all 8 tables; conditional-write OCC; migrations 0001–0004 |
| §7 | DSQL rationale (DynamoDB documented, unused) | ✅ | |
| §8 | Stack + deployment | 🟡 | stack ✅ local; **Vercel + DSQL deploy missing** |
| §9 | API surface | ✅ | complete incl. `world?since=` deltas (6-11) |
| §10 | Frontend/UX | ✅ | complete incl. price chart (area fill + scale + last-dot) and mobile pass (6-11) |
| §11 | Cost guardrails | 🟡 | in-memory+delta ✅, bounded grid+3s ✅; **AWS Budgets alert + Vercel spend cap not set** (cloud) |
| §12 | Scaling design | 🟡 | per-commodity book ✅; edge cache headers on world/market/leaderboard ✅ (6-11); single-region in practice |
| §13 | Phases 0–4 | 🟡 | 1–3 done locally; **Phase 0 cloud bits + Phase 4 ship outstanding** |
| §14 | Demo + submission | 🔴 | script + diagram ready; **video, storage screenshots, Vercel link, submit** outstanding |
| §17 | Defaults (4 commodities, 64×64, 3s, BIGINT, handle auth) | ✅ | magic-link auth not done (was "if time allows") |

Legend: ✅ done · 🟡 partial · 🔴 missing · ⚪ stretch.

---

## Roadmap (prioritized, dated)

### P0 (correctness) — AI market cold-start deadlock — ✅ FIXED 2026-06-12

Found + fixed 2026-06-12 dogfood. The AI bots placed orders but **never traded**
(1 trade ever in the DB — the guide script): makers posted a non-crossing spread
and momentum/value/arb were gated on a trade tape only a trade could create →
permanent freeze, runaway `scout`. **Fix (TDD'd, engine untouched):** an
anchor-reverting cold-start probe on `momentum` (`apps/worker/src/agents.ts`) +
full maker/momentum/value ecology on every commodity (`packages/db/src/seed.ts`,
roster 8 → 14 agents). Verified live: all 4 commodities trade every generation
and oscillate bounded near 100, no drift, no runaway. Details:
**`docs/known-issue-ai-market-cold-start.md`**.

### P0 — Cloud spine (target **June 14**; user-gated AWS/Vercel mutations)

Runbook: `docs/superpowers/runbooks/phase-0-cloud-provisioning.md` (see #6).

1. **Provision Aurora DSQL** (single-region) + `db:migrate` + `db:seed` +
   `db:smoke` against the live cluster.
2. **Deploy `apps/web` to Vercel** (root `apps/web`, DSQL env vars +
   `SESSION_SECRET`); verify live `/api/health` reads DSQL. Check for an
   existing Vercel project before creating one.
3. **Cost guardrails (§11, mandatory, same day as #1/#2):** AWS Budgets
   low-threshold alert + Vercel Spend Management auto-pause.
4. ✅ ~~Package the worker as a scheduled job~~ — **engineering DONE 6-11**
   (single-flight `claimGeneration` lock, claim-first `runTick`, budgeted
   Lambda `handler.ts`, esbuild CJS bundle, all tested). What remains is the
   AWS side only: create the function + EventBridge Scheduler rate(1 minute)
   (plan Part B Task 16).
5. **Cloud dogfood pass:** with web + worker live, play the game on the
   deployed URL — claim, mine, trade against the bots, watch SSE — and fix
   whatever the real network surfaces (SSE behind Vercel, DSQL latency on the
   settlement path, auth-token refresh on pooled connections).
6. ✅ ~~Fix runbook drift~~ — DONE 6-11 (steps D/E/F/H now match migrations
   0001–0004 and the 10-player seed, verified against live output).

### P1 — Demo capture + submission assets (target **June 21**)

7. **Multi-region active-active cluster** stood up briefly (§5.4/§12): capture
   demo footage + the storage-configuration screenshots, then tear down.
8. **Record the demo video** (3–5 min; script at `docs/demo-video-script.md`):
   living world → place a trade, watch it settle → reveal the AI traders →
   leaderboard → multi-region/consistency close. Record *after* the cloud
   dogfood so footage is the deployed app, not localhost.
9. **Repo presentation for judging:**
   - Rename/merge so the GitHub default branch is **`main`** (today it's
     `phase-0-foundations`; local `master` is a stale 2-commit orphan — delete).
   - Add a **LICENSE** (MIT) at root.
   - Final README pass: live URL, video link, screenshots.
10. **Devpost submission package** (§14): description naming Aurora DSQL, video
    link, Vercel project link + Team ID, architecture diagram, storage
    screenshots. Draft is `docs/devpost-submission.md` — fill in the live
    artifacts. **Submit by June 27**, keeping the final two days as buffer.
11. **Optional bonus content:** publish the build write-up (single-market ledger
    on DSQL) with the event hashtag + required attribution.

### P2 — Hardening / polish — ✅ ALL DONE 2026-06-11 (except #17, kept out of scope)

12. ✅ **Richer price chart (§10)** — area fill + min/max scale + last-trade dot;
    trades history widened to 60.
13. ✅ **Listing-initiation UI** — click your own cell → sell/unlist form; listed
    cells outline gold; "for sale" legend entry.
14. ✅ **Edge-cached reads (§12)** — `s-maxage=2` world/market, `s-maxage=5`
    leaderboard (+ standard 503 catch on leaderboard).
15. ✅ **`/api/world?since=` (§9)** — wired with validation.
16. ✅ **Mobile layout pass** — canvas `min(92vw, 72vh, 620px)` + 600px media
    query (wrapping tabs, stacked ticket, 16px inputs).
17. **Refine step (§3/§4.4).** Deliberately out of scope (plan): invisible in a
    4-minute demo; "refine = identity" is the documented simplification.

### P3 — Stretch (§16; cut-first, build only if everything above is done)

18. Civic governance voting (§4.6).
19. Bedrock analyst agent narrating strategy (off the critical path).
20. Resource futures / simple derivatives.
21. World replay / timelapse for the demo.
22. Magic-link auth (§17, "if time allows").

---

## Schedule to the deadline

| Window | Focus |
|--------|-------|
| **Jun 11–14** | P0 #1–6: DSQL + Vercel + guardrails + Lambda worker + cloud dogfood |
| **Jun 15–21** | P2 polish (chart first) interleaved with P1 #7–8: multi-region capture + video |
| **Jun 22–27** | P1 #9–11: repo presentation, Devpost package, **submit Jun 27** |
| **Jun 28–29** | Buffer only |

Per §15, when behind: cut P3, then P2 from the bottom up; never touch the
market/ledger core to save time.

## Known simplifications (intentional, documented)

- **Refine = identity:** a cell's resource type is credited directly as the
  tradeable commodity (no separate refining tier yet).
- **Single region (`r0`):** multi-region is a configuration/demo step, not a
  rebuild (spec §5.4/§15); the scale story lives in the architecture.
- **Workers as a dev loop:** correct for local/dev; cloud deployment is P0 #4.
- **Auth:** handle + signed session cookie (spec default); magic-link optional.

## Completed (verified live 2026-06-11)

- Phases 1–3 (§13) feature-complete locally; 104 tests green, lint clean.
- 2026-06-10 P1 game-completeness arc: investment/extraction upgrade
  (migration 0003), player dashboard (`/api/me`), leaderboard on `/world`,
  cell secondary market (migration 0004), `arb` agent.
- Submission doc drafts: README, architecture (md+svg+png), Devpost write-up,
  How-to-Play PDF, demo video script.
- Repo hygiene: 0 AI co-author trailers in history; HEAD pushed to origin.
