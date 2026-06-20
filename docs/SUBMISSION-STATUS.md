# Submission Status & Next Steps

**Hackathon:** H0 "Hack the Zero Stack with Vercel and AWS Databases" · Track 3 (Million-scale Global App)
**Deadline:** 2026-06-29 5:00pm PDT · **Submit-by target:** June 27 (2-day buffer)
**Live app:** https://orbis-exchange.vercel.app
**Last updated:** 2026-06-19 (QA pass — docs reconciled to live repo state; see `SUBMISSION-CHECKLIST.md` for the live-verified matrix)

> This is the single source of truth for *what's done and what's left to submit*. The
> deep roadmap/spec-coverage lives in [`roadmap.md`](roadmap.md); the credential-bearing
> deploy steps live in the gitignored `VERCEL-ENV-CHECKLIST.md` at the repo root.

---

## Done & verified (2026-06-14)

| Area | State | Evidence |
|---|---|---|
| App code (spec §3–§14, less deliberate cuts) | ✅ feature-complete on `main` | git history |
| Test suite | ✅ **123 green** (db 52 · web 27 · worker 44) | `pnpm -r test` |
| Lint (3 packages) · `next build` · Lambda bundle | ✅ clean | `pnpm -r lint` / `next build` / `pnpm --filter @orbis/worker bundle` |
| **Aurora DSQL cluster** | ✅ **ACTIVE**, deletion-protected, migrated 0001–0004 + seeded | `aws dsql get-cluster` |
| **Worker Lambda `orbis-tick`** | ✅ Active (nodejs22) — **unscheduled by design → $0** | `aws lambda get-function-configuration` |
| AWS Budget `orbis-monthly` $10/mo alert | ✅ set | `aws budgets describe-budgets` |
| **Vercel production deploy** | ✅ **LIVE → https://orbis-exchange.vercel.app** | `/api/health` 200 (all 4 migrations over DSQL/IAM); `/world` renders; no SSO wall |
| Worker→DSQL write path in prod | ✅ validated | 2 one-off `lambda invoke` (35 ticks, 0 errors) — world advanced to gen 64 |
| Repo presentation | ✅ MIT LICENSE, default branch `main` | — |

**The whole read+write spine is proven in the cloud.** What remains is making the world
*continuously* alive (scheduling), then capturing and submitting.

---

## Remaining steps (in order) — all user/interactive

### 1. ✅ Deploy `apps/web` to Vercel — DONE
Live at https://orbis-exchange.vercel.app. For redeploys, deploy **from the repo root** (not `apps/web`):
```
vercel deploy --prod --yes --scope steves-projects-a71becf4
```
> **Monorepo gotcha:** the project's **Root Directory = `apps/web`** (set via the Vercel API; no CLI flag exists) and deploys must run from the repo root so the pnpm workspace (incl. `packages/db`) uploads. Local `vercel build` fails on Windows (`EPERM` symlink) — use the remote build.

### 2. Vercel spend cap — *if on Pro* (Hobby = N/A)
Vercel → Project → Settings → **Spend Management** → auto-pause (~$20). AWS budget already set.

### 3. Schedule the worker (turn the world ON) — ✅ DONE 2026-06-19
EventBridge Scheduler **`orbis-heartbeat`** (`rate(1 minute)` → `orbis-tick`, role `orbis-scheduler`) is **ENABLED**. Live-verified: world advanced gen 64 → 87 → 99 → 123… at **~16/min** (clean, continuous). **Roll back instantly:** `aws scheduler delete-schedule --name orbis-heartbeat --region us-east-1` (and `aws iam delete-role-policy --role-name orbis-scheduler --policy-name invoke-orbis-tick; aws iam delete-role --role-name orbis-scheduler`). **Cost:** ≈ $13/mo Lambda (AWS credits; $10 budget alerts). **Tear down after capture if conserving.** Monitor: `aws logs tail /aws/lambda/orbis-tick --follow --region us-east-1`.

### 3b. Re-seed the demo world for a clean leaderboard — ✅ DONE 2026-06-19 (targeted delete)
The 2 stale dev fixtures (`alice` human + `bot-maker` agent, the old 1.5M-era seed) were deleted directly from live DSQL — orphan-checked first (0 orders/inventory/agents/cells). **Leaderboard is now a clean 14 agents, 0 humans.** ⚠️ **Open demo-quality call:** this was a *targeted* delete — the 14 agents kept their **old accumulated credits** (most ~1.5M; **`scout-r0` is a runaway, ~5M+ and climbing** as the world ticks). For the most compelling demo, consider a **full fresh re-seed** (wipe + re-seed to gen 0, all agents at 1.0M near parity) instead — Claude can do this on request (it's destructive: resets the world). The targeted-delete state is submittable as-is; the fresh re-seed just looks better on camera.

### Settlement mechanic — ✅ live-verified 2026-06-19
Join → crossing buy on `ore` → **filled at 102**, buyer credits 10000→9898, inventory +1 ore, trade on the tape — the strongly-consistent settlement works end-to-end on live DSQL. (Test player removed afterward.)

### 4. Cloud dogfood (quality gate before footage) — ~30 min
On the live URL: join → claim → mine → cross an order against a bot → see the fill + balance change → upgrade extraction → list a cell, buy it from a 2nd incognito handle → leaderboard moves. On a phone too. Watch: SSE behind Vercel (holds or polls?), DSQL settlement latency, auth-token refresh on a 20-min-idle tab. Fix breakage as its own tested commit. *(This is synthetic E2E — state that in any "done" claim.)*

### 5. Multi-region capture (brief, then tear down) — plan Part B Task 18
Stand up a peered DSQL pair only for footage + the **storage-config screenshots** (a submission requirement). Show a write in one region read from the other. Capture, then tear down; confirm no budget surprise next day.

### 6. Record the demo video — 3–5 min hard cap — [`demo-video-script.md`](demo-video-script.md)
Record against the **deployed** app: living world → place a trade, watch it settle → reveal the traders are AI → leaderboard → multi-region/consistency close. Publish public/unlisted-public.

### 7. Repo + README presentation pass — ~15 min
Add the **live URL + video link** to the top of [`../README.md`](../README.md). Fill the [`devpost-submission.md`](devpost-submission.md) checklist: video link, Vercel project link + **Team ID**, storage screenshots.

### 8. Devpost submission — **submit by June 27**
Description naming **Amazon Aurora DSQL**, video link, Vercel link + Team ID, architecture diagram ([`architecture.png`](architecture.png)), storage screenshots. **Verify every link opens logged-out/incognito.** Optional bonus: build write-up with the event hashtag + attribution. Re-verify the live app the morning of June 29.

---

## Operational follow-ups

- **Rotate the `orbis-vercel` AWS access key** — its secret was exposed in a dev session transcript (least-privilege, DSQL-connect only, but rotate as hygiene). Create a new key, update `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in Vercel + redeploy, then delete the old key (command in `VERCEL-ENV-CHECKLIST.md`).
- The live world sits at the generation of the last invoke until scheduled (step 3).

## Out of scope (deliberate, per spec §15)
Refine step (= identity in v1) and §16 stretch (civic voting, Bedrock analyst, futures, replay, magic-link) — build only if everything above is done with ≥3 days of buffer.
