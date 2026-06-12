# Orbis Exchange — Player's Guide: Design

**Date:** 2026-06-11 · **Status:** approved (pre-implementation) · **Owner:** Steve

## Purpose

A new-player training guide with real, annotated gameplay screenshots. Two jobs:

1. Take a brand-new player from opening `/world` to their first trade in ~5
   minutes, then teach every mechanic in the game.
2. Serve as the **pre-deployment alignment artifact**: every number and
   behavior in the guide is pulled from the code, so reviewing the guide is
   reviewing the game. If something in the guide surprises us, we fix the game
   before cloud deployment — not the prose.

Audience: new players first (judges benefit because it proves learnability).

## Deliverables

| Artifact | Path | Notes |
|---|---|---|
| Guide (single source of truth) | `docs/user-guide.md` | GitHub-renderable markdown, embeds the PNGs |
| Screenshots | `docs/guide/*.png` | 10 staged, annotated captures (list below) |
| Capture script | `scripts/capture-guide-shots.mjs` | Playwright; stages game states + injects callout badges; re-runnable against prod later via `GUIDE_BASE_URL` |
| PDF build script | `scripts/build-user-guide-pdf.mjs` | marked → styled HTML (print CSS, dark theme to match the site) → Playwright print → `docs/user-guide.pdf` |
| PDF | `docs/user-guide.pdf` | Generated, committed (like the old how-to-play.pdf was) |

**Retired:** `docs/how-to-play.pdf`, `docs/how-to-play.html` — deleted in the
same change; README link (`How to Play (PDF)`) and any other references point
to the new guide (md primary, PDF linked).

## Production pipeline (Approach A — approved)

1. `capture-guide-shots.mjs` boots against a base URL (default
   `http://localhost:3000`, env-overridable for prod re-shoots). Local runs
   require the dev server + worker running and the dev DB seeded.
2. The script **plays the game** to stage each state: joins with a guide
   handle, claims a specific bright cell, waits ticks for mining yield, lists
   the cell, places orders that cross the bots' quotes, etc.
3. Before each capture it injects absolutely-positioned numbered callout
   badges (①②③…) via `page.evaluate` — styled in the game's own language
   (IBM Plex Mono, gold `#f5c450` / cyan `#38e0f5`, dark chip background) —
   then screenshots the relevant element or viewport to `docs/guide/`.
4. Deterministic where possible: fixed viewport 1380×900 (desktop shots),
   fixed handle (`guide`), the same staged cell each run. The world itself is
   live (CA keeps moving) — acceptable; shots need to be representative, not
   byte-identical.
5. Staging doubles as a mini-dogfood: any rough edge found while staging is
   reported, not worked around.

## Screenshot list

| # | File | Staged state | Annotations |
|---|---|---|---|
| 1 | `01-overview.png` | Full `/world`, joined, world alive, market busy | ① living world ② market panel ③ your dashboard ④ leaderboard |
| 2 | `02-join.png` | Market panel, not joined | handle input + "Enter the market"; note: 10,000 starting credits |
| 3 | `03-claim.png` | World view, one freshly claimed cell (white outline) near a bright bloom | ① bright = abundant ② your cell (white) ③ claim hint line |
| 4 | `04-world-reading.png` | World close-up with a visible bloom region and a depleted/dark region | ① bloom (spreading) ② collapse/depleted ③ resource hues legend |
| 5 | `05-dashboard.png` | Dashboard after several mined ticks: credits, ≥1 cell, holdings, upgrade button | ① credits ② cells/extraction level ③ holdings ④ upgrade |
| 6 | `06-market.png` | Market panel with chart showing movement, populated book | ① commodity tabs ② last price ③ price chart ④ book + spread ⑤ order ticket ⑥ trade tape |
| 7 | `07-trade-fill.png` | Just placed an order that crossed a bot's quote; fill message visible | ① fill confirmation ② updated balance direction |
| 8 | `08-sell-form.png` | Sell form open on own cell (clicked own cell; price typed, not yet listed) | ① sell form (price input, list button) |
| 9 | `09-listed-cell.png` | After listing: gold-outlined cell + ok message + legend visible | ① gold outline = for sale ② "for sale" legend ③ confirmation message |
| 10 | `10-leaderboard.png` | Leaderboard with (AI)-tagged bots and the guide player on it | ① (AI) tags ② net-worth ranking |

## Content outline (`docs/user-guide.md`)

1. **Welcome** — one world, one market, machines trade against you. [shot 1]
2. **Quickstart: first trade in 5 minutes** — numbered steps: enter handle →
   read the field → claim a bright cell → watch it mine → sell the yield →
   you're on the board. [shots 2, 3, 7]
3. **Reading the living world** — brightness = abundance, color = resource
   (ore amber, energy cyan, biomass green, rare violet); the world evolves by
   Conway-style rules every 3s tick: balanced neighborhoods bloom and spread,
   isolation withers, overcrowding collapses; mining adds depletion pressure.
   When to claim, when to abandon. [shot 4]
4. **The global market** — one order book per commodity; limit orders,
   price-time priority, **the resting order sets the fill price**; partial
   fills rest on the book; reading the chart, depth bars, spread, tape.
   Prices are emergent — nobody authors them. [shots 6, 7]
5. **Growing your empire** — claiming (500 cr); mining yield scales with cell
   density and your extraction level; upgrades cost (level+1)×1,000 cr and
   accelerate depletion (the trade-off stated honestly); selling cells: click
   your own cell → set a price → gold outline marks it; buying someone
   else's listed cell by clicking it. [shots 5, 8, 9]
6. **Know your opponents** — the 5 bot strategies, one line + one exploit
   hint each: maker (quotes both sides — cross its spread when it lags),
   momentum (chases trends — fade the overshoot), value (mean-reverts — don't
   fight it at extremes), scout (claims blooming cells — beat it to fresh
   blooms), arb (rebalances across commodities — its trades telegraph relative
   value). [shot 10]
7. **Scoring** — net worth = credits + inventory valued at last trade price;
   one leaderboard, humans and machines together.
8. **Quick reference** — every constant in one table, **pulled from code at
   writing time** (sources noted so reviewers can verify): starting credits
   10,000 (`STARTING_CREDITS`, queries.ts), claim 500 (`CLAIM_COST`),
   upgrade cost (level+1)×1,000 (`INVEST_BASE_COST` + escalation),
   tick 3s (`TICK_MS`), 4 commodities, mining formula (from
   `apps/worker/src/mining.ts` — implementation reads and states it
   precisely), fill price = resting order's price.

Tone: the game's existing voice (lowercase HUD-ish labels, plain confident
sentences). No marketing fluff in the body — §1 carries the hook.

## PDF styling

Dark theme consistent with the site and the retired one-pager (same palette
variables), Letter, print-color-adjust exact, images full-column width,
sections break-inside avoid. Generated only — never hand-edited.

## Acceptance criteria

- `docs/user-guide.md` renders correctly on GitHub with all 10 images.
- `docs/user-guide.pdf` builds from the md via the script; readable, ≤ ~6 pages.
- Every number in §8 verified against the named code constant in the same PR.
- Capture script re-runs cleanly from a seeded local stack
  (documented at the top of the script) and accepts `GUIDE_BASE_URL`.
- Old how-to-play files deleted; no dangling references (`grep how-to-play`
  → only historical docs/plans).
- Any UX rough edges found during staging are listed in the PR/commit message
  or reported, not silently absorbed.

## Out of scope

- Mobile-specific guide section (the mobile pass shipped; the guide's shots
  are desktop — one line noting "plays on phones too" is enough).
- Strategy depth beyond one exploit hint per bot.
- Localization, video tutorials, in-game onboarding tooltips.
