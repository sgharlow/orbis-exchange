# Player's Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Orbis Exchange Player's Guide per `docs/superpowers/specs/2026-06-11-user-guide-design.md` — 10 staged annotated screenshots, `docs/user-guide.md`, a generated PDF, and retirement of the old how-to-play files.

**Architecture:** A committed Playwright script plays the live local game to stage each state, injects numbered badge annotations in-page, and screenshots to `docs/guide/`. The guide markdown is the single source; a second script renders it to a dark-themed PDF via marked + Playwright print. Both scripts are re-runnable (capture honors `GUIDE_BASE_URL` for post-deploy re-shoots).

**Tech Stack:** Playwright (root devDep), marked (root devDep), Node ESM scripts, existing pnpm monorepo.

**Conventions that bind every task:**
- Windows + PowerShell (`$env:NAME='value'; cmd`). Repo: `C:\Users\sghar\CascadeProjects\orbis-exchange`, branch `main` (commit there, push only where a step says so).
- **Commit messages: NO `Co-Authored-By` trailer, NO "Generated with Claude" line — ever.** Verify each commit with `git log -1 --format=%B`.
- Verified game constants used throughout (do not re-derive): start 10,000 cr (`STARTING_CREDITS`, packages/db/src/queries.ts), claim 500 cr (`CLAIM_COST`), upgrade cost (level+1)×1,000 cr (`INVEST_BASE_COST`, escalating in `investExtraction`), tick 3s, mining = `floor(density × 0.1 × (1 + 0.5×level))` per owned cell per tick with the same amount subtracted from the cell (`EXTRACT_RATE`/`EXTRACT_LEVEL_STEP`, apps/worker/src/mining.ts), fills at the resting order's price, net worth = credits + Σ(qty × last price).

**File structure:**

| File | Responsibility |
|---|---|
| `scripts/capture-guide-shots.mjs` | Create — stage + annotate + capture the 10 PNGs |
| `scripts/build-user-guide-pdf.mjs` | Create — user-guide.md → styled PDF |
| `docs/guide/*.png` | Create — the 10 screenshots (committed) |
| `docs/user-guide.md` | Create — the guide (single source) |
| `docs/user-guide.pdf` | Create — generated, committed |
| `package.json` (root) | Modify — devDeps + `guide:shots`/`guide:pdf` scripts |
| `.npmrc` | Modify — approve-builds for playwright |
| `README.md` | Modify — docs links |
| `docs/how-to-play.pdf`, `docs/how-to-play.html` | Delete |

---

### Task 1: Tooling — playwright + marked at the repo root

**Files:**
- Modify: `package.json` (repo root)
- Modify: `.npmrc`

- [ ] **Step 1: Add devDeps and convenience scripts.** In the root `package.json`, add to (or create) `devDependencies`:

```json
    "playwright": "^1.49.0",
    "marked": "^15.0.0"
```

and add to `scripts`:

```json
    "guide:shots": "node scripts/capture-guide-shots.mjs",
    "guide:pdf": "node scripts/build-user-guide-pdf.mjs"
```

Append to `.npmrc`:

```
approve-builds[]=playwright
```

- [ ] **Step 2: Install.**

```powershell
pnpm install
pnpm exec playwright install chromium
```
Expected: install completes; chromium downloads (~150MB, one-time).

- [ ] **Step 3: Verify playwright drives a browser.**

```powershell
node -e "import('playwright').then(async ({chromium}) => { const b = await chromium.launch(); const p = await b.newPage(); await p.setContent('<h1>ok</h1>'); console.log('playwright OK:', await p.textContent('h1')); await b.close(); })"
```
Expected: `playwright OK: ok`.

- [ ] **Step 4: Commit.**

```bash
git add package.json pnpm-lock.yaml .npmrc
git commit -m "build: playwright + marked for the player's guide pipeline"
```

### Task 2: The capture script + the 10 screenshots

**Files:**
- Create: `scripts/capture-guide-shots.mjs`
- Create: `docs/guide/01-overview.png` … `10-leaderboard.png` (by running it)

- [ ] **Step 1: Reset + boot the local stack (clean world for pretty shots).**

```powershell
docker compose up -d
docker compose exec -T postgres psql -U orbis -d orbis -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
$env:DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis'; pnpm db:migrate
$env:DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis'; pnpm db:seed
```

Then in two background processes (note which port the dev server takes — 3000, or 3001 if busy):

```powershell
$env:DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis'; $env:SESSION_SECRET='dev'; pnpm dev
$env:DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis'; pnpm --filter @orbis/worker dev
```

Let the worker run ~60s before capturing (≥20 generations) so the world has visible blooms/withers and the bots have quoted and traded — the chart needs history.

- [ ] **Step 2: Write the capture script.** Create `scripts/capture-guide-shots.mjs`:

```js
// Stages and captures the 10 annotated screenshots for docs/user-guide.md.
//
// Prereqs (local): docker compose up; dev DB migrated + seeded; BOTH running:
//   dev server : DATABASE_URL=postgres://orbis:orbis@localhost:5434/orbis SESSION_SECRET=dev pnpm dev
//   worker     : DATABASE_URL=postgres://orbis:orbis@localhost:5434/orbis pnpm --filter @orbis/worker dev
// Give the worker ~60s before running so the world and market look alive.
//
// Run:   pnpm guide:shots
// Env:   GUIDE_BASE_URL overrides http://localhost:3000 (e.g. the prod URL
//        after deploy — the same script re-shoots the guide against live).

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE = process.env.GUIDE_BASE_URL ?? "http://localhost:3000";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "guide");
const GRID = 64;
const TICK_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

// ---------- annotation badges (gold chips in the game's own language) ----------

async function badgeAt(page, n, docX, docY) {
  await page.evaluate(
    ([n, x, y]) => {
      const b = document.createElement("div");
      b.className = "guide-badge";
      b.textContent = String(n);
      Object.assign(b.style, {
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        zIndex: 9999,
        width: "28px",
        height: "28px",
        borderRadius: "50%",
        background: "#f5c450",
        color: "#05070d",
        font: "700 15px 'IBM Plex Mono', monospace",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 0 14px rgba(245,196,80,0.9), 0 0 0 2px rgba(5,7,13,0.8)",
      });
      document.body.appendChild(b);
    },
    [n, docX, docY]
  );
}

// Badge anchored to an element's corner. anchor: tl | tr | bl | br
async function badge(page, n, selector, anchor = "tl", dx = 0, dy = 0) {
  const pos = await page.evaluate(
    ([selector, anchor]) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = (anchor.includes("r") ? r.right - 14 : r.left - 14) + window.scrollX;
      const y = (anchor.includes("b") ? r.bottom - 14 : r.top - 14) + window.scrollY;
      return { x, y };
    },
    [selector, anchor]
  );
  if (!pos) throw new Error(`badge target not found: ${selector}`);
  await badgeAt(page, n, pos.x + dx, pos.y + dy);
}

async function clearBadges(page) {
  await page.evaluate(() => document.querySelectorAll(".guide-badge").forEach((b) => b.remove()));
}

async function shot(page, name, selector, opts = {}) {
  const file = path.join(OUT, name);
  if (selector) {
    await page.locator(selector).screenshot({ path: file, ...opts });
  } else {
    await page.screenshot({ path: file, ...opts });
  }
  console.log(`captured ${name}`);
  await clearBadges(page);
}

// ---------- world helpers ----------

async function worldCells(page) {
  const res = await page.request.get(`${BASE}/api/world?region=r0`);
  if (!res.ok()) throw new Error(`world fetch failed: ${res.status()}`);
  return (await res.json()).cells;
}

// Document coords of a cell's center on the canvas.
async function cellPoint(page, x, y) {
  const box = await page.locator("canvas").boundingBox();
  if (!box) throw new Error("canvas not found");
  return { px: box.x + ((x + 0.5) / GRID) * box.width, py: box.y + ((y + 0.5) / GRID) * box.height };
}

async function docPointOfCell(page, x, y) {
  const p = await cellPoint(page, x, y);
  const scroll = await page.evaluate(() => ({ sx: window.scrollX, sy: window.scrollY }));
  return { x: p.px + scroll.sx - 14, y: p.py + scroll.sy - 14 };
}

// ---------- main ----------

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1380, height: 960 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(20_000);

await page.goto(`${BASE}/world`, { waitUntil: "networkidle" });
await page.waitForSelector("canvas");
await sleep(TICK_MS + 500); // at least one live tick on screen

// 02 — join (captured BEFORE joining)
await badge(page, 1, 'input[aria-label="handle"]', "tl", -20, 0);
await shot(page, "02-join.png", 'section[aria-label="Market"]');

// join as "guide" — a fresh player with 10,000 credits
await page.fill('input[aria-label="handle"]', "guide");
await page.press('input[aria-label="handle"]', "Enter");
await page.waitForSelector(".ticket-who");

// pick the brightest unclaimed interior cell, claim it (retry next-best if raced)
let claimed = null;
for (let attempt = 0; attempt < 3 && !claimed; attempt++) {
  const cells = (await worldCells(page))
    .filter((c) => c.owner_id === null && c.x >= 5 && c.x <= 58 && c.y >= 5 && c.y <= 58)
    .sort((a, b) => b.density - a.density);
  const target = cells[attempt];
  const { px, py } = await cellPoint(page, target.x, target.y);
  await page.mouse.click(px, py);
  const msg = await page.waitForSelector(".claim-msg", { timeout: 10_000 });
  const ok = (await msg.getAttribute("class")).includes("ok");
  if (ok) claimed = target;
}
if (!claimed) throw new Error("could not claim a cell in 3 attempts");
console.log(`claimed cell (${claimed.x},${claimed.y}) density ${claimed.density}`);

// 03 — claimed cell (white outline) + claim hint
{
  const p = await docPointOfCell(page, claimed.x, claimed.y);
  await badgeAt(page, 1, p.x, p.y);
  await badge(page, 2, ".claim-line", "tl", -8, -8);
  await shot(page, "03-claim.png", 'section[aria-label="World"]');
}

// 04 — reading the world: brightest cluster, darkest region, legend
{
  const cells = await worldCells(page);
  const bright = [...cells].sort((a, b) => b.density - a.density)[0];
  const dark = [...cells].filter((c) => c.x >= 3 && c.x <= 60 && c.y >= 3 && c.y <= 60).sort((a, b) => a.density - b.density)[0];
  const bp = await docPointOfCell(page, bright.x, bright.y);
  const dp = await docPointOfCell(page, dark.x, dark.y);
  await badgeAt(page, 1, bp.x, bp.y);
  await badgeAt(page, 2, dp.x, dp.y);
  await badge(page, 3, ".legend", "tl", -8, -8);
  await shot(page, "04-world-reading.png", 'section[aria-label="World"]');
}

// mine for ~5 ticks so the dashboard shows holdings
await sleep(TICK_MS * 5);

// 05 — dashboard: credits, stats+upgrade, holdings
await page.waitForSelector(".dash-hold"); // at least one holding has accrued
await badge(page, 1, ".dash-credits", "tr", 20, 0);
await badge(page, 2, ".dash-stats", "tl", -20, 0);
await badge(page, 3, ".dash-inv", "bl", -20, 0);
await badge(page, 4, ".dash-upgrade", "tr", 20, -6);
await shot(page, "05-dashboard.png", ".dash");

// 06 — the market panel, fully annotated
await badge(page, 1, ".commodity-tabs", "tl", -8, -8);
await badge(page, 2, ".price-block", "bl", -8, 8);
await badge(page, 3, ".chart-wrap", "tr", 8, -8);
await badge(page, 4, ".book", "tl", -8, 0);
await badge(page, 5, ".ticket", "tl", -8, 0);
await badge(page, 6, ".tape", "bl", -8, 0);
await shot(page, "06-market.png", 'section[aria-label="Market"]');

// 07 — a real fill: sell mined yield at the best bid (fallback: buy 1 ore at ask)
{
  let placed = false;
  // switch to the claimed cell's commodity tab
  await page.click(`.commodity-tab:has-text("${claimed.resource_type}")`);
  await sleep(500);
  for (let i = 0; i < 4 && !placed; i++) {
    const m = await (await page.request.get(`${BASE}/api/market/${claimed.resource_type}`)).json();
    const bid = m.bids?.[0]?.price;
    if (bid) {
      await page.fill('input[aria-label="price"]', String(bid));
      await page.fill('input[aria-label="quantity"]', "1");
      await page.click(".btn-sell");
      placed = true;
    } else {
      await sleep(TICK_MS); // maker quotes next round
    }
  }
  if (!placed) {
    // fallback: buy 1 ore at the ask
    await page.click('.commodity-tab:has-text("ore")');
    const m = await (await page.request.get(`${BASE}/api/market/ore`)).json();
    await page.fill('input[aria-label="price"]', String(m.asks[0].price));
    await page.fill('input[aria-label="quantity"]', "1");
    await page.click(".btn-buy");
  }
  await page.waitForSelector(".ticket-msg.ok");
  await badge(page, 1, ".ticket-msg", "tl", -8, 0);
  await badge(page, 2, ".dash-credits", "tr", 20, 0);
  await shot(page, "07-trade-fill.png", 'section[aria-label="Market"]');
}

// 08 — sell form open on our own cell
{
  const { px, py } = await cellPoint(page, claimed.x, claimed.y);
  await page.mouse.click(px, py);
  await page.waitForSelector(".list-form");
  await page.fill('input[aria-label="list price"]', "750");
  await badge(page, 1, ".list-form", "tl", -8, -8);
  await shot(page, "08-sell-form.png", 'section[aria-label="World"]');
}

// 09 — listed: gold outline + legend + confirmation
{
  await page.click('.list-form button:has-text("list")');
  await page.waitForSelector(".claim-msg.ok");
  const p = await docPointOfCell(page, claimed.x, claimed.y);
  await badgeAt(page, 1, p.x, p.y);
  await badge(page, 2, ".legend-listed", "tl", -20, -6);
  await badge(page, 3, ".claim-msg", "tl", -8, -8);
  await shot(page, "09-listed-cell.png", 'section[aria-label="World"]');
}

// 10 — leaderboard with AI tags
await page.waitForSelector(".board-ai");
await badge(page, 1, ".board-ai", "tr", 16, -6);
await badge(page, 2, ".board-row .board-net", "tr", 20, 0);
await shot(page, "10-leaderboard.png", "section.board");

// 01 — full-page overview (captured last: world busy, player on the board)
await badge(page, 1, 'section[aria-label="World"]', "tl", 6, 6);
await badge(page, 2, 'section[aria-label="Market"]', "tr", -6, 6);
await badge(page, 3, ".dash", "tr", -34, -6);
await badge(page, 4, "section.board", "tl", 6, 6);
await shot(page, "01-overview.png", null, { fullPage: true });

await browser.close();
console.log(`done — 10 shots in ${OUT}`);
```

- [ ] **Step 3: Run it.**

```powershell
pnpm guide:shots
```
(If the dev server took port 3001: `$env:GUIDE_BASE_URL='http://localhost:3001'; pnpm guide:shots`.)
Expected output: ten `captured NN-*.png` lines then `done`.

- [ ] **Step 4: LOOK at every screenshot.** Open each `docs/guide/*.png` with the Read tool and verify against the spec's shot list: badges present and positioned sensibly (not covering the thing they label), the claimed cell visibly white-outlined in 03, gold outline visible in 09, chart showing movement in 06, fill message in 07, AI tags in 10, everything legible at full-column width. If a badge lands badly, adjust its dx/dy in the script and re-run (the script is idempotent except it claims one more cell per full run — acceptable; or re-run only after a DB reset for pristine state). **Report any UX rough edges noticed while staging — do not paper over them.**

- [ ] **Step 5: Commit.**

```bash
git add scripts/capture-guide-shots.mjs docs/guide
git commit -m "docs: guide screenshot pipeline + 10 staged annotated captures"
```

### Task 3: The guide — `docs/user-guide.md`

**Files:**
- Create: `docs/user-guide.md`

- [ ] **Step 1: Write the guide.** Create `docs/user-guide.md` with exactly this content:

```markdown
# Orbis Exchange — Player's Guide

*One living world. One global market. The machines trade against you.*

Orbis Exchange is a persistent economic simulation. A 64×64 resource field
evolves on its own every 3 seconds — regions bloom, spread, and collapse — and
one global order book per commodity turns that scarcity into price. Nobody
authors the prices. AI agents are real players on the same ledger: they mine,
quote, and trade exactly the way you do. One leaderboard ranks everyone by net
worth. **Can you out-trade the machine?**

![The whole game on one screen](guide/01-overview.png)

**① The Living World** — the resource field, evolving every tick.
**② The Global Market** — the order book, chart, and your trade ticket.
**③ Your dashboard** — credits, cells, holdings, upgrades.
**④ The leaderboard** — humans and machines, one ranking.

---

## 1 · Quickstart: your first trade in five minutes

1. **Enter the market.** Type a handle and press Enter. You start with
   **10,000 credits**.

   ![Enter the market](guide/02-join.png)

2. **Read the field.** Brightness is abundance. Each color is a commodity —
   amber **ore**, cyan **energy**, green **biomass**, violet **rare**.

3. **Claim a bright cell** — click it (**500 cr**). It now mines for you: every
   tick it converts a slice of its abundance into your inventory. Your cells
   are outlined **white**.

   ![A freshly claimed cell](guide/03-claim.png)
   *① your claimed cell — white outline · ② the status line confirms the claim*

4. **Watch your dashboard.** Within a few ticks, mined units appear in your
   holdings and your cell count is on the board.

5. **Sell the yield.** Switch the market panel to your commodity, set your
   price at (or below) the best bid, set a quantity, hit **Sell**. A crossing
   order **settles instantly** — credits in, inventory out, one atomic
   transaction on the ledger.

   ![A fill, settled](guide/07-trade-fill.png)
   *① the fill confirmation · ② your balance moved the same moment*

That's the loop. Everything else is strategy.

---

## 2 · Reading the living world

![Reading the field](guide/04-world-reading.png)
*① a blooming region — dense, spreading to its neighbors · ② a depleted region
— dark cells fade toward the background · ③ the legend*

The world runs by Conway-style rules, applied every 3-second tick:

- A cell with a **balanced, healthy neighborhood blooms** — its density rises,
  and rich cells **seed their weakest neighbor**, so abundance spreads.
- An **isolated** cell withers. An **overcrowded** one collapses. Booms sow
  their own busts.
- **Mining is extra pressure.** Every owned cell depletes as it yields. Mine a
  region hard enough and you trigger the local crash yourself.

What this means for you:

- **Claim into blooms, not peaks.** A cell at maximum brightness surrounded by
  bright neighbors is near its overcrowding collapse. The frontier of a
  spreading bloom lasts longer.
- **Abandoned ground regrows.** Depleted regions with a few healthy neighbors
  regenerate — yesterday's crash is next week's bloom.
- **Scarcity moves prices.** When a commodity's region collapses, supply dries
  up and its price climbs. The field is a price forecast if you read it early.

---

## 3 · The global market

![The market panel](guide/06-market.png)
*① commodity tabs · ② last trade price · ③ the price chart · ④ the order book —
asks above, bids below, the spread between · ⑤ your order ticket · ⑥ the tape —
recent trades*

- There is **one market** — one order book per commodity, shared by every
  human and every bot.
- Orders are **limit orders**: your price, your quantity. Matching is
  **price-time priority**.
- A crossing trade fills **at the resting order's price** — if you sell into a
  standing bid of 104, you get 104 even if you asked 100. Unfilled remainder
  rests on the book until it fills or you cancel.
- Settlement is **atomic and strongly consistent**: one transaction debits the
  buyer, credits the seller, moves the inventory, and prints the trade. No
  double-spends, no oversells — for you *and* for the bots.

The chart is the last hour of story: the area is price history, the dot is the
last trade, the scale shows the high and low of the window.

---

## 4 · Growing your empire

![Your dashboard](guide/05-dashboard.png)
*① credits · ② cells owned + extraction level · ③ holdings — what you've mined
and bought · ④ the upgrade button*

**Mining.** Each owned cell yields `floor(density × 10% × multiplier)` units
per tick, and the cell loses the same amount — extraction is depletion.

**Upgrades.** Each extraction level adds **+50%** to the multiplier (level 1 →
1.5×, level 2 → 2×, …). The next level costs **(level + 1) × 1,000 cr** —
1,000, then 2,000, then 3,000. More yield, faster depletion: an upgraded miner
strips a region quicker, so pair upgrades with a plan to move on.

**The land market.** Cells themselves are assets:

- **Sell a cell:** click one of your own cells, set a price, hit **list**. It
  gets a **gold outline** — anyone who clicks it buys it at your price.
- **Unlist:** click it again, hit unlist.
- **Buy:** click anyone else's gold cell. Claim, flip, profit.

![Listing a cell for sale](guide/08-sell-form.png)
*① the sell form — price, list, close*

![Listed — the gold outline](guide/09-listed-cell.png)
*① your cell, now marked for sale · ② the legend's "for sale" swatch · ③ the
confirmation*

**Holdings are positions.** Inventory floats with the market — what you don't
sell is a bet that the price rises.

---

## 5 · Know your opponents

![The leaderboard](guide/10-leaderboard.png)
*① bots are tagged AI · ② net worth — credits plus inventory at the last price*

Five algorithmic traders work the same book you do:

| Bot | What it does | How to beat it |
|---|---|---|
| **Market makers** (`mm-*`) | Quote both sides around the last price, every tick | Their quotes lag the world — when you see a region collapse, hit their stale asks before they reprice |
| **Momentum** | Buys what's rising, sells what's falling | It chases — fade the overshoot and sell into its buying |
| **Value** | Buys below the rolling mean, sells above | Don't fight it at extremes; it's usually the one catching your panic sells |
| **Scout** | Claims the brightest unclaimed cells | Beat it to fresh blooms — it reacts, you can anticipate |
| **Arb** | Rebalances across commodities toward their means | Its trades telegraph relative value — watch what it accumulates |

The bots keep the world liquid — there is always a price. But they follow
rules. You can read the field, anticipate the cycle, and front-run the lot of
them. That is the game.

---

## 6 · Scoring

**Net worth = credits + inventory valued at the last trade price.** One
leaderboard, humans and machines together, re-ranked continuously. Mining
builds inventory, trading converts it, land flips compound it — every path
runs through the same ledger.

---

## 7 · Quick reference

| Thing | Value |
|---|---|
| Starting credits | 10,000 cr |
| Claim an unclaimed cell | 500 cr |
| Extraction upgrade | (level + 1) × 1,000 cr — escalating |
| Mining yield per tick | floor(density × 10% × (1 + 0.5 × level)) |
| Depletion | equal to the yield — extraction is depletion |
| World tick | every 3 seconds |
| Commodities | ore · energy · biomass · rare |
| Order type | limit (price × quantity) |
| Fill price | the resting order's price |
| Sell a cell | click your own cell → set price → list (gold outline) |
| Net worth | credits + inventory × last price |

*Plays in any modern browser, phones included. Every number above comes from
the game's source — if the game and this guide ever disagree, file it as a bug.*
```

- [ ] **Step 2: Verify rendering.** Confirm every image referenced exists: from the repo root,

```powershell
Select-String -Path docs\user-guide.md -Pattern "guide/\d\d-[a-z-]+\.png" -AllMatches | ForEach-Object { $_.Matches.Value } | Sort-Object -Unique | ForEach-Object { if (-not (Test-Path "docs\$_")) { Write-Output "MISSING $_" } }
```
Expected: no output. Also Read the markdown top-to-bottom once for typos/flow.

- [ ] **Step 3: Commit.**

```bash
git add docs/user-guide.md
git commit -m "docs: the player's guide"
```

### Task 4: PDF build

**Files:**
- Create: `scripts/build-user-guide-pdf.mjs`
- Create: `docs/user-guide.pdf` (by running it)

- [ ] **Step 1: Write the build script.** Create `scripts/build-user-guide-pdf.mjs`:

```js
// Renders docs/user-guide.md to docs/user-guide.pdf (dark theme, Letter).
// The markdown is the single source — never edit the PDF or the temp HTML.
// Run: pnpm guide:pdf

import { chromium } from "playwright";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { marked } from "marked";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const md = readFileSync(path.join(root, "docs", "user-guide.md"), "utf8");
const body = marked.parse(md);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Orbis Exchange — Player's Guide</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=IBM+Plex+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root { --bg:#05070d; --ink:#c9d4e8; --dim:#7f8fb0; --line:rgba(120,160,220,0.16); --gold:#f5c450; --cyan:#38e0f5; }
  * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  @page { size: Letter; margin: 11mm 13mm; }
  body { background:var(--bg); color:var(--ink); font:12px/1.55 'IBM Plex Mono',monospace; margin:0; padding:6mm 2mm; }
  h1 { font-family:Fraunces,Georgia,serif; font-style:italic; font-size:34px; color:#eef3ff; margin:0 0 4px; }
  h2 { font-size:12px; letter-spacing:0.3em; text-transform:uppercase; color:#6f86b3; border-top:1px solid var(--line); padding-top:12px; margin:20px 0 10px; break-after:avoid; }
  em { color:var(--dim); }
  strong { color:#e7eefc; font-weight:500; }
  img { max-width:100%; border:1px solid var(--line); border-radius:8px; margin:6px 0 2px; break-inside:avoid; }
  p, li { color:var(--ink); }
  blockquote { margin:0; padding-left:10px; border-left:2px solid var(--line); color:var(--dim); }
  table { border-collapse:collapse; width:100%; font-size:11px; break-inside:avoid; }
  th, td { border:1px solid var(--line); padding:5px 8px; text-align:left; vertical-align:top; }
  th { color:#9fe9f6; font-weight:500; }
  code { color:var(--cyan); }
  hr { border:0; border-top:1px solid var(--line); margin:14px 0; }
  ol, ul { padding-left: 20px; }
</style></head><body>${body}</body></html>`;

const tmp = path.join(root, "docs", "user-guide.tmp.html");
writeFileSync(tmp, html);
try {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle" });
  await page.pdf({
    path: path.join(root, "docs", "user-guide.pdf"),
    format: "Letter",
    printBackground: true,
    margin: { top: "11mm", bottom: "11mm", left: "13mm", right: "13mm" },
  });
  await browser.close();
  console.log("wrote docs/user-guide.pdf");
} finally {
  unlinkSync(tmp);
}
```

- [ ] **Step 2: Build and inspect.**

```powershell
pnpm guide:pdf
```
Expected: `wrote docs/user-guide.pdf`. Read the PDF (Read tool, it handles PDFs) and verify: all 10 images render, dark theme, tables legible, ≤ ~7 pages, no image split across a page awkwardly. If something breaks badly across pages, adjust the CSS (`break-inside`) and re-run.

- [ ] **Step 3: Commit.**

```bash
git add scripts/build-user-guide-pdf.mjs docs/user-guide.pdf
git commit -m "docs: PDF build for the player's guide"
```

### Task 5: Retire the old how-to-play + update links + push

**Files:**
- Delete: `docs/how-to-play.pdf`, `docs/how-to-play.html`
- Modify: `README.md:19`

- [ ] **Step 1: Swap the README link.** In `README.md`, replace the line

```markdown
- 📖 **[How to Play (PDF)](docs/how-to-play.pdf)** — the illustrated guide.
```

with

```markdown
- 📖 **[Player's Guide](docs/user-guide.md)** — how to play, with annotated screenshots ([PDF](docs/user-guide.pdf)).
```

- [ ] **Step 2: Delete the old files and check for dangling references.**

```powershell
git rm docs/how-to-play.pdf docs/how-to-play.html
```

Then `grep -rn "how-to-play"` across the repo (excluding node_modules) — remaining hits must be only historical plan/spec docs under `docs/superpowers/` (acceptable per spec).

- [ ] **Step 3: Final gate + commit + push.**

```powershell
$env:TEST_DATABASE_URL='postgres://orbis:orbis@localhost:5434/orbis_test'; pnpm -r test
pnpm -r lint
(git log --all --format=%B | Select-String -Pattern "co-authored-by: claude|noreply@anthropic" -AllMatches).Matches.Count
```
Expected: 114 tests green, lint clean, trailer count 0 (the guide work adds no code under test — counts unchanged).

```bash
git add README.md
git commit -m "docs: player's guide replaces how-to-play; README links updated"
git push origin main
```

---

## Self-review notes

- Spec coverage: capture script + 10 shots (T2), guide md (T3), PDF + script (T4), retirement + links (T5), tooling (T1). Constants in §7 of the guide match the verified values in the plan header. `GUIDE_BASE_URL` honored (T2 script). Staging-as-dogfood reporting required in T2 Step 4.
- The guide's image paths are `guide/*.png` relative to `docs/` — correct for both GitHub rendering of `docs/user-guide.md` and the temp HTML written into `docs/` for the PDF.
- Selector inventory used by the capture script, all verified present in the components: `input[aria-label="handle"]`, `.ticket-who`, `.claim-msg`, `.claim-line`, `.legend`, `.legend-listed`, `.dash`, `.dash-credits`, `.dash-stats`, `.dash-inv`, `.dash-upgrade`, `.dash-hold`, `.commodity-tabs`, `.commodity-tab`, `.price-block`, `.chart-wrap`, `.book`, `.ticket`, `.tape`, `.ticket-msg`, `.btn-buy`, `.btn-sell`, `input[aria-label="price"]`, `input[aria-label="quantity"]`, `.list-form`, `input[aria-label="list price"]`, `section.board`, `.board-ai`, `.board-row .board-net`, `section[aria-label="World"]`, `section[aria-label="Market"]`, `canvas`.
