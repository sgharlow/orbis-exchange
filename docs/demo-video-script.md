# Orbis Exchange — Demo Video Script & Shot List

**Target length:** **~2:50 — keep it under 3:00.** (The official rules allow
3–5 min, but the H0 judges' own guidance says "Under 3 minutes" and that the
video carries a lot of weight, since they aren't required to test the app. Take
the hint: tight beats long.) **Format:** screen recording + voiceover. **Tone:**
confident, builder-voice, a little wonder. **Throughline:** *the database is the
hero — strong consistency is what makes the game fair.*

The narrative arc (spec §14): open on the living world → introduce the single
market → place a trade and watch it settle instantly → reveal the traders are AI →
leaderboard + "out-trade the machine" → close on Aurora DSQL + the consistency
claim.

---

## Pre-flight (do this before recording)

1. **Capture settings:** 1920×1080 (or 1440p) @ 30fps. Full-screen browser, hide
   the bookmarks bar, zoom 100%. Quiet desktop notifications.
2. **Bring the world to life** so the field is mid-evolution and the book is liquid:
   ```bash
   # reset to a clean, lively world
   docker compose exec -T postgres psql -U orbis -d orbis -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
   DATABASE_URL=postgres://orbis:orbis@localhost:5434/orbis pnpm db:migrate
   DATABASE_URL=postgres://orbis:orbis@localhost:5434/orbis pnpm db:seed
   # terminal A — the app
   DATABASE_URL=postgres://orbis:orbis@localhost:5434/orbis SESSION_SECRET=demo pnpm dev
   # terminal B — the heartbeat (let it run ~60s before recording so prices have history)
   DATABASE_URL=postgres://orbis:orbis@localhost:5434/orbis TICK_MS=3000 pnpm --filter @orbis/worker dev
   ```
   *(Recording against the deployed Vercel + Aurora DSQL is ideal — same steps,
   cloud env vars. If recording locally, say "running on Aurora DSQL" only over the
   cloud/console shots, not the localhost ones.)*
3. **Tabs to pre-open:** `/world` (two-panel), `/` (leaderboard),
   `docs/architecture.svg` (or the rendered diagram), and the **AWS Aurora DSQL
   console** (cluster overview + a query showing the tables) for the storage shots.
4. **Have a handle ready** to type (e.g. `you`) and pick a **bright cell** near
   the center to claim, and note the current **best ask** in the book so your buy
   crosses and fills on camera.

---

## Shot list

| # | ~Time | Screen / action | Voiceover |
|---|-------|-----------------|-----------|
| 1 | 0:00–0:15 | `/world` full screen. Let the field visibly tick/animate; slow zoom-in on the grid. | "One living world. A grid of resources that grows, spreads, and collapses on its own — no script, just rules. The abundance you see *is* the data, evolving in real time." |
| 2 | 0:15–0:35 | Hover the world; click a **bright cell** → it outlines white, the claim toast appears. | "I can claim a piece of it. That cell is mine now — every few seconds it mines its resource into my inventory and depletes the land. Scarcity is emergent: where the land thins, prices are about to move." |
| 3 | 0:35–0:55 | Pan to the **market panel**; point at last price, the order book (red asks / green bids), the trade tape ticking. | "On the right is the other half of the same screen: one global market. One order book per commodity, price-time priority. The map and the book are the same ledger, seen two ways." |
| 4 | 0:55–1:25 | In the ticket: type a **Buy** at/above best ask, click **Buy**. The fill toast shows; book depth drops; last price updates; a new trade appears in the tape. | "Watch this. I place a buy that crosses a resting sell — and it settles instantly. One short transaction debited me, paid the seller, moved the inventory, and recorded the trade — with the balance and inventory checks asserted *inside* that transaction." |
| 5 | 1:25–1:45 | Stay on the market; let agent trades tick the tape/price while you talk. | "Here's the twist: most of these orders aren't people. Maker, momentum, value and scout bots are first-class players — same order book, same code path I just used, zero inference cost. They keep the world alive, and they're the competition." |
| 6 | 1:45–2:05 | Cut to `/` (leaderboard); scroll the ranked list (agents tagged). | "One leaderboard ranks everyone — human and AI — by net worth: credits plus holdings at last price. Which comes down to one question. Can you out-trade the machine?" |
| 7 | 2:05–2:35 | Cut to the **AWS Aurora DSQL console**: cluster overview, then a quick query listing tables / a `players`+`trades` peek. Then cut to `docs/architecture.svg`. | "All of this rests on Amazon Aurora DSQL — the single source of truth. Strongly consistent, so no order can double-spend credits or sell the same unit twice, and there's no reconciliation pass, ever. Three runtimes share one ledger: the Next.js app on Vercel, the simulation heartbeat, and the agents." |
| 8 | 2:35–2:50 | Hold on the architecture diagram; highlight the multi-region note, then a quick cut back to `/world` evolving + title card "Orbis Exchange". | "And DSQL is active-active across regions by design — so a player in Frankfurt and one in Virginia would trade on one consistent world, with zero coordination in our code. That's the million-scale story: not a benchmark, a guarantee. Orbis Exchange — one living world, one ledger, and a machine to beat." |

---

## Continuous voiceover (read straight through, ~2:50)

> One living world. A grid of resources that grows, spreads, and collapses on its
> own — no script, just rules. The abundance you see is the data, evolving in real
> time.
>
> I can claim a piece of it. That cell is mine now — every few seconds it mines its
> resource into my inventory and depletes the land. Scarcity is emergent: where the
> land thins, prices are about to move.
>
> On the right is the other half of the same screen: one global market. One order
> book per commodity, price-time priority. The map and the book are the same ledger,
> seen two ways.
>
> Watch this. I place a buy that crosses a resting sell — and it settles instantly.
> One short transaction debited me, paid the seller, moved the inventory, and
> recorded the trade — with the balance and inventory checks asserted inside that
> transaction.
>
> Here's the twist: most of these orders aren't people. Maker, momentum, value and
> scout bots are first-class players — same order book, same code path I just used,
> zero inference cost. They keep the world alive, and they're the competition.
>
> One leaderboard ranks everyone — human and AI — by net worth. Which comes down to
> one question: can you out-trade the machine?
>
> All of this rests on Amazon Aurora DSQL — the single source of truth. Strongly
> consistent, so no order can double-spend credits or sell the same unit twice, and
> there's no reconciliation pass, ever. Three runtimes share one ledger: the Next.js
> app on Vercel, the simulation heartbeat, and the agents.
>
> And DSQL is active-active across regions by design — so a player in Frankfurt and
> one in Virginia would trade on one consistent world, with zero coordination in our
> code. That's the million-scale story: not a benchmark, a guarantee.
>
> Orbis Exchange — one living world, one ledger, and a machine to beat.

---

## On-screen text / lower-thirds (optional but recommended)

- 0:02 — `ORBIS EXCHANGE`
- 0:20 — `Claim a cell → it mines for you`
- 1:08 — `One transaction. No double-spend. No oversell.`
- 1:38 — `Maker · Momentum · Value · Scout — same book, zero inference`
- 2:05 — `Net worth = credits + holdings`
- 2:28 — `Amazon Aurora DSQL — the single source of truth`
- 2:42 — `Active-active, multi-region — one consistent world`

## Capture tips

- The tick is every 3s — start each world shot a beat before a tick so motion is
  visible on camera.
- For shot #4, pre-check the **best ask** and enter a buy **at or above** it so it
  crosses and fills on the first click (agents keep asks resting). If it just rests,
  the book has no ask above your bid — nudge the price up and retry off-camera.
- Keep the cursor moving deliberately; pause ~1s after each click so the toast and
  the book update are legible.
- Storage proof (H0 requirement): in the DSQL console capture (a) the cluster
  overview/endpoint and (b) a query result showing the `players` / `orders` /
  `trades` tables — this is the "storage configuration proving AWS database usage."

## Checklist before upload

- [ ] Length **under 3:00** (target ~2:50; rules allow up to 5:00 but judges asked for under 3).
- [ ] Shows the world evolving **and** a trade settling.
- [ ] Names **Amazon Aurora DSQL** out loud and on screen.
- [ ] Shows storage config (DSQL console) + the architecture diagram.
- [ ] Upload **public** (YouTube/Vimeo); paste the URL into Devpost, the README,
      and `docs/devpost-submission.md`.
