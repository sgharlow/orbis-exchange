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

await page.goto(`${BASE}/world`, { waitUntil: "load" });
await page.waitForSelector("canvas");
await sleep(TICK_MS + 500); // at least one live tick on screen

// 02 — join (captured BEFORE joining)
await badge(page, 1, 'input[aria-label="handle"]', "tl", -20, 0);
await shot(page, "02-join.png", 'section[aria-label="Market"]');

// join as "guide" — a fresh player with 10,000 credits
await page.fill('input[aria-label="handle"]', "guide");
await page.press('input[aria-label="handle"]', "Enter");
await page.waitForSelector(".ticket-who");
// After joining the market panel expands (price/qty inputs get focused by the browser)
// which auto-scrolls the page away from the canvas. Scroll back to top.
await page.evaluate(() => window.scrollTo(0, 0));

// pick the brightest unclaimed interior cell, claim it (retry next-best if raced)
let claimed = null;
for (let attempt = 0; attempt < 3 && !claimed; attempt++) {
  const cells = (await worldCells(page))
    .filter((c) => c.owner_id === null && c.x >= 5 && c.x <= 58 && c.y >= 5 && c.y <= 58)
    .sort((a, b) => b.density - a.density);
  const target = cells[attempt];
  const { px, py } = await cellPoint(page, target.x, target.y);
  await page.mouse.click(px, py);
  // wait for the resolved state (ok or err), not just the info/pending flash
  const msg = await page.waitForSelector(".claim-msg.ok, .claim-msg.err", { timeout: 10_000 });
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
// Badges must stay inside the .dash crop — use absolute placement with clear spacing
await page.waitForSelector(".dash-hold"); // at least one holding has accrued
{
  const r = await page.evaluate(() => {
    const el = document.querySelector(".dash");
    const b = el.getBoundingClientRect();
    return { l: b.left + window.scrollX, t: b.top + window.scrollY, w: b.width, h: b.height };
  });
  // Badge 1 = credits (quarter-right of width, near top)
  await badgeAt(page, 1, r.l + Math.round(r.w * 0.55), r.t + 14);
  // Badge 2 = stats row (left third)
  await badgeAt(page, 2, r.l + 14, r.t + Math.round(r.h * 0.35));
  // Badge 3 = holdings/inventory (left, lower)
  await badgeAt(page, 3, r.l + 14, r.t + Math.round(r.h * 0.7));
  // Badge 4 = upgrade button (right side, stats row height)
  await badgeAt(page, 4, r.l + Math.round(r.w * 0.75), r.t + Math.round(r.h * 0.35));
}
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
  // scroll back to top before clicking the canvas (market panel may have scrolled page)
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
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
