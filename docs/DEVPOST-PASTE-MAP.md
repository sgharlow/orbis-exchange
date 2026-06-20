# Orbis Exchange — Devpost field → paste source

Fill the Devpost project form top to bottom. Each row = one form field, the exact
text/source to paste, and where it comes from. Prose lives in
[`devpost-submission.md`](devpost-submission.md); don't rewrite it — copy it.

**Hackathon:** H0 "Hack the Zero Stack with Vercel and AWS Databases" · **Track 3: Million-scale Global App** · AWS Database: **Amazon Aurora DSQL** · deadline 2026-06-29 5:00pm PDT (submit by 6-27).

---

## A. Top-of-form fields

| Devpost field | Paste this | Source |
|---|---|---|
| **Project name** | `Orbis Exchange` | — |
| **Tagline / elevator pitch** (one line) | `A single living world and one global market, where AI and humans trade on the exact same strongly-consistent ledger. Can you out-trade the machine?` | `devpost-submission.md` "Tagline" |
| **"Built with"** (tags) | `amazon-aurora-dsql`, `aws-sdk-dsql-signer`, `vercel`, `next.js`, `react`, `typescript`, `node-postgres`, `server-sent-events`, `pnpm`, `vitest` | `devpost-submission.md` "Built with" |

## B. Story sections (Devpost "About the project")

Paste each section from `devpost-submission.md` under the matching Devpost heading:

| Devpost heading | Source section in `devpost-submission.md` |
|---|---|
| **Inspiration** | "Inspiration" |
| **What it does** | "What it does" + "Who it's for — and why the pattern ships" |
| **How we built it** | "How we built it" |
| **Challenges we ran into** | "Challenges we ran into" |
| **Accomplishments that we're proud of** | "Accomplishments we're proud of" |
| **What we learned** | "What we learned" |
| **What's next for Orbis Exchange** | "What's next" |

> The "Who it's for — and why the pattern ships" block (ticketing / flash-sale /
> escrow framing) is the strongest judge-facing argument — keep it in "What it does".

## C. Links ("Try it out" / submission links)

| Field | Value |
|---|---|
| **Live app** | https://orbis-exchange.vercel.app |
| **GitHub repo** | https://github.com/sgharlow/orbis-exchange |
| **Demo video** (YouTube/Vimeo, public/unlisted) | _paste after recording — ≤5 min, script: `demo-video-script.md`_ |

## D. Image gallery (upload)

| Asset | File | Notes |
|---|---|---|
| **Architecture diagram** | `docs/architecture.png` (214 KB raster) | Devpost wants a raster; `.png` is ready. `architecture.svg` is the source. |
| **Storage screenshot** (Aurora DSQL console — cluster + region config) | _capture during the multi-region stand-up (Step D-3 / SUBMISSION-STATUS §5)_ | **H0 hard requirement.** |
| Gameplay screenshots (optional but recommended) | _capture from the live, ticking `/world`_ | After scheduling the worker + re-seed (clean 14-agent leaderboard). |

## E. H0-specific custom fields (the rubric items)

These are the requirements judges score directly — verify each is present:

- [ ] **Text description names Amazon Aurora DSQL as the database** — covered by the "How we built it" paste (hero = Aurora DSQL).
- [ ] **Published Vercel project link + Vercel Team ID** — get the Team ID from Vercel → Settings → General (or the URL slug `steves-projects-…`). Paste both.
- [ ] **Architecture diagram** — `architecture.png` in the gallery (§D).
- [ ] **Storage screenshot proving Aurora DSQL usage** — §D.
- [ ] **Demo video link** — §C.
- [ ] **(Bonus, +≤0.6)** build write-up published before 6-29 with `#H0Hackathon` + required attribution — source: `blog-post.md`; add its public URL to the Devpost entry.

## F. Pre-submit gate (do all before clicking Submit)

1. [ ] World is **ticking** (worker scheduled) and **re-seeded** to the clean 14-agent roster (SUBMISSION-STATUS §3, §3b) — so the live app a judge clicks looks alive and the leaderboard matches the docs.
2. [ ] Every link above opens **logged-out / incognito** (live app, video, GitHub, blog).
3. [ ] Video is public/unlisted-public and ≤5 min.
4. [ ] Architecture + storage screenshots uploaded.
5. [ ] **Submit by June 27**; re-verify the live app + all links the morning of June 29.

---
*Companion to `SUBMISSION-STATUS.md` (ordered steps) + `SUBMISSION-CHECKLIST.md` (live-verified evidence). Generated 2026-06-19.*
