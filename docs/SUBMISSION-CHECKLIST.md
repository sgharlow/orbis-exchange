# Orbis Exchange — Submission Verification Checklist

**Hackathon:** H0 "Hack the Zero Stack with Vercel and AWS Databases" · Track 3 (Million-scale Global App)
**Deadline:** 2026-06-29 5:00pm PDT · **Submit-by target:** June 27 (2-day buffer)
**Live app:** https://orbis-exchange.vercel.app
**This file:** a single requirement→evidence→gap→owner matrix, with **live verification run 2026-06-19**. It complements — does not replace — [`SUBMISSION-STATUS.md`](SUBMISSION-STATUS.md) (ordered remaining steps) and [`devpost-submission.md`](devpost-submission.md) (the prose answers). When they disagree, this file's "Live verification" column is the freshest signal.

> **Bottom line (2026-06-19):** the read path is fully live and healthy in the cloud; all 135 tests green; the UI demo surface is complete. **Every open item is user/interactive** (worker already scheduled/ENABLED → dogfood → multi-region capture → video → Devpost form). No engineering blocker stands between today and submission.

---

## A. Live verification run — 2026-06-19 (this session)

Probed the deployed app at https://orbis-exchange.vercel.app (anonymous / logged-out):

| Check | Result | Detail |
|---|---|---|
| `GET /api/health` | ✅ 200 (~214 ms) | `{ ok: true, migrations: [0001_init, 0002_indexes, 0003_invest, 0004_cell_listing] }` — all 4 migrations applied over DSQL/IAM |
| `GET /api/world` | ✅ 200 | `generation: 64`, `cells: 4096`, region `r0` |
| `GET /api/market/ore` | ✅ 200 | last 100; bids 100/98/98, asks 102×; depth both sides |
| `GET /api/market/rare` | ✅ 200 | last 102; spread 100→102; populated book |
| `GET /api/leaderboard` | ✅ 200 | clean 14-agent roster on the ~1.5M baseline (post 2026-06-22 re-seed); tight competitive AI-vs-human spread, no runaway (12-cell cap closes it — see note 3) |
| `/world` UI | ✅ renders | living-world canvas rendered as a **single-hue (cyan) density heatmap with bloom glow** (brightness = abundance) + 3 panels (LIVING WORLD / GLOBAL MARKET / LEADERBOARD AI VS HUMAN); on-demand reveal-layer chips, "my cells" spotlight, inline cell tooltip; an always-visible objective rail (Enter → Claim → Sell) + first-visit how-to card. Opening the link **auto-joins you as a guest — no login/signup/handle prompt**; rename inline anytime. |
| Full test suite `pnpm -r test` | ✅ **135 green** | db 54 · web 36 · worker 45 |

**Two observations (neither is a submit blocker):**

1. ✅ **RESOLVED 2026-06-19 — the world is now LIVE.** EventBridge schedule `orbis-heartbeat` (`rate(1 minute)` → `orbis-tick`) is ENABLED; gen verified climbing 64→87→99→123… at **~16/min**. (Was frozen at gen 64 / worker unscheduled.) Roll back: `aws scheduler delete-schedule --name orbis-heartbeat`.
2. ⚠️ **Console noise, logged-out:** the client polls `GET /api/me` every ~3 s and it returns **401** until you join, logging a red console error each time. Cosmetic only (console isn't on camera; the page works). Optional polish: treat 401 as the anonymous state and skip the `console.error`. Low priority — do **not** spend cliff-time on it.
3. ✅ **RESOLVED — clean re-seed 2026-06-22.** The production world was re-seeded clean: **14 agents reset to a ~1.5M baseline, empty field, fresh prices**, 0 humans; worker `orbis-heartbeat` ENABLED and the world is advancing. The **12-cell-per-player cap** (race-safe in `claimCell` + `buyListedCell`) keeps the leaderboard a tight competitive AI-vs-human race with no runaway — **no reset-before-record dance is required**. The settlement mechanic is live-verified (join → market Buy → filled@102, balance debited, trade on tape). Demo-ready.

---

## B. H0 hard requirements → status

| # | Requirement | Status | Evidence / location | Owner |
|---|---|---|---|---|
| 1 | Text description names **Amazon Aurora DSQL** as the database | ✅ done | `devpost-submission.md` ("How we built it" → hero = Aurora DSQL) | — |
| 2 | Architecture diagram | ✅ done (verify export) | `docs/architecture.md` + `architecture.svg`; **confirm a `architecture.png` exists for Devpost upload** (devpost-submission §checklist references `architecture.png`) | Steve |
| 3 | **3–5 min demo video** (world evolving → trade settles → reveal AI traders → leaderboard → DSQL/consistency close) | ❌ not recorded | Script ready: `demo-video-script.md`. **Record against the live app AFTER scheduling the worker.** Publish public/unlisted-public, ≤5 min hard cap | Steve |
| 4 | **Published Vercel project link + Vercel Team ID** | ⏳ partial | Live URL ✅ proven. **Paste the Vercel project link + Team ID into `devpost-submission.md` + the Devpost form** | Steve |
| 5 | **Storage screenshots** proving Aurora DSQL usage (cluster + connection config) | ❌ not captured | Capture during multi-region stand-up (step B-5 of SUBMISSION-STATUS); runbook `docs/superpowers/runbooks/phase-0-cloud-provisioning.md` | Steve |
| 6 | Every submitted link opens **logged-out / incognito** | ⏳ re-verify pre-submit | Live app already serves anonymous (verified this session). Re-check video + Vercel links incognito the morning of 6-29 | Steve |
| 7 | **Bonus (+≤0.6 Stage-2):** build write-up before 6-29 w/ `#H0Hackathon` + required attribution | ❌ not published | Draft ready: `docs/blog-post.md`. Paste to Dev.to/Medium, confirm attribution wording vs Official Rules, add live URL back into `devpost-submission.md` | Steve |

---

## C. Pre-submission engineering gate (Claude-verifiable) — ALL GREEN as of 2026-06-19

| Gate | State | Evidence |
|---|---|---|
| Full test suite | ✅ 135 green | `pnpm -r test` (db 54 · web 36 · worker 45) |
| Live health + read path | ✅ | §A above |
| Market liquid (books populated, agents trading) | ✅ | §A — books populated, agents trading; the 12-cell-per-player cap closes the old `scout-r0` runaway, so the leaderboard stays a tight AI-vs-human race with no reset-before-record needed (see [SUBMISSION-STATUS §3c](SUBMISSION-STATUS.md)) |
| MIT LICENSE, default branch `main` | ✅ | per SUBMISSION-STATUS |
| Build / lint / Lambda bundle | ✅ (last verified 6-14) | re-run `pnpm -r lint && next build` in the pre-submit pass if any code changed since |

> Nothing in column C requires Steve. If any of these flips red before 6-29, it's a real blocker — fix as its own tested commit.

---

## D. Cliff-day ordered runbook (the user-only path)

The turnkey sequence, condensed from SUBMISSION-STATUS §1–§8. Target **all of this done by June 27**.

1. **Turn the world ON** — EventBridge `rate(1 minute)` → `orbis-tick` (staged in gitignored `trust-scheduler.json` / `invoke-policy.json`). Verify: `aws logs tail /aws/lambda/orbis-tick --follow` shows generations strictly increasing; live `/world` GEN climbs. Rollback: `aws scheduler delete-schedule --name orbis-heartbeat`. *(~10 min)*
1b. **Re-seed the demo world for a clean leaderboard** — ✅ ALREADY DONE (2026-06-22): the production world is a clean **14-agent roster on the ~1.5M baseline**, empty field, fresh prices (see §A note 3). Only re-seed again if the world has been running long enough to want a fresh field before recording; the 12-cell cap means there is no runaway to reset away. Confirm `/api/leaderboard` returns the 14 agents. *(~5 min if repeated)*
2. **Cloud dogfood** (synthetic E2E) — open the link (auto-joins as a guest, no login/signup) → claim → mine → market Buy/Sell against the AI market-makers' liquidity (always fills, quantity auto-bounded) → see fill + balance change → upgrade extraction → list a cell, buy from a 2nd incognito session → leaderboard moves. On a phone too. *(~30 min)*
3. **Multi-region capture** — stand up a peered DSQL pair *only* for footage + the **storage screenshots** (req #5). Show a write in one region read from the other. Tear down after; confirm no budget surprise. *(per plan Part B Task 18)*
4. **Record the demo video** — ≤5 min, against the live (now ticking) app, per `demo-video-script.md`. Publish public. *(req #3)*
5. **README + devpost presentation pass** — live URL + video link to top of `README.md`; fill `devpost-submission.md` (video, Vercel link + Team ID, storage screenshots, architecture.png). *(req #2,4,5)*
6. **Publish the build write-up** — `blog-post.md` → Dev.to/Medium with `#H0Hackathon` + attribution. *(bonus req #7)*
7. **Devpost submission** — paste all of the above; **verify every link incognito**. *(by June 27)*
8. **Morning of June 29** — re-verify the live app + all links one last time.

---

## E. Operational follow-up (hygiene, not a gate)

- **Rotate the `orbis-vercel` AWS access key** — its secret appeared in a dev-session transcript (least-privilege DSQL-connect only). New key → update Vercel `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` → redeploy → delete old key. Command in gitignored `VERCEL-ENV-CHECKLIST.md`.

---
*Generated 2026-06-19 as Story 1 of the daily-priority session (read-only QA sweep + this checklist). Live verification performed against the deployed app; no code changed.*
