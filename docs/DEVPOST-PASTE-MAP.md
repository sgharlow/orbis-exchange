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
| **Demo video** (YouTube/Vimeo, public/unlisted) | `PASTE-VIDEO-URL` _(record per `demo-video-script.md`, ≤5 min; same token in README + devpost-submission.md)_ |

## D. Image gallery (upload)

| Asset | File | Notes |
|---|---|---|
| **Architecture diagram** | `docs/architecture.png` (214 KB raster) | Devpost wants a raster; `.png` is ready. `architecture.svg` is the source. |
| **Storage screenshot** (Aurora DSQL console — multi-region) | `docs/gallery/orbis-dsql-us-east-1.jpg` + `docs/gallery/orbis-dsql-us-west-2.jpg` | **H0 hard requirement — DONE.** Two AWS console captures of the active-active pair: us-east-1 primary `lbt34ey3…` (Peers tab → us-west-2 + us-east-2 witness) and us-west-2 peer `3rt34e6h…`. Upload both. Also spliced into the demo video at the multi-region beat (~2:24). |
| Gameplay screenshots (optional but recommended) | _capture from the live, ticking `/world`_ | Worker is scheduled (ENABLED) and the world is re-seeded clean (14-agent leaderboard); capture the cyan density heatmap + objective rail. |

## E. H0-specific custom fields (the rubric items)

These are the requirements judges score directly — verify each is present:

- [ ] **Text description names Amazon Aurora DSQL as the database** — covered by the "How we built it" paste (hero = Aurora DSQL).
- [ ] **Published Vercel project link + Vercel Team ID** — resolved from `.vercel/project.json`:
      - **Team ID:** `team_nP3HzRc3PNm6SaWiApTGkEWa`
      - **Project:** `orbis-exchange` (`prj_I9OZRIFiK6FdMISgVNrIRmc06T7I`) · **Live:** https://orbis-exchange.vercel.app
      - (Project dashboard link: Vercel → the `orbis-exchange` project; paste its URL + the Team ID above.)
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
