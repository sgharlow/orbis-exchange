# Orbis Exchange — Demo Video Script & Shot List

**Target length:** **~2:50 — keep it under 3:00.** (Rules allow 3–5 min, but the H0
judges' guidance says "Under 3 minutes" and the video carries a lot of weight since
they aren't required to test the app. Tight beats long.) **Format:** screen recording
+ voiceover. **Tone:** confident, builder-voice, a little wonder. **Throughline:**
*the database is the hero — strong consistency is what makes the game fair.*

The narrative arc (spec §14): open on the living world → introduce the single market
→ place a trade and watch it settle instantly → reveal the traders are AI →
leaderboard + "out-trade the machine" → close on Aurora DSQL + the consistency claim.

> **What's on screen now (current UI — the script matches this):** the field renders
> as a **crisp** density heatmap (brightness = abundance; no blur). **Scroll to zoom
> in; once zoomed, scroll or drag to pan** (ctrl-scroll / pinch also zooms). Trading is
> one-tap: **quick-size chips (1 / 5 / 25 / max)** then a **Buy / Sell button that shows
> the price** (e.g. `Buy 5 · 100 cr`) and always fills — limit orders are tucked behind
> an "advanced" link. The leaderboard shows the **9 strategy opponents** (momentum ×4,
> value ×4, arb); the liquidity bots (market-makers + the pulse trader) and the scout
> **supplier** run the market behind the scenes and are intentionally **off** the board.

---

## Pre-flight (do this before recording)

1. **Record against LIVE (recommended):** the deployed app on Vercel + **Aurora DSQL** —
   <https://orbis-exchange.vercel.app/world>. This is the real DSQL path, so every
   on-camera claim is true. The field animates on its own (~10/min) and the market tape
   moves continuously, so there's always motion.
2. **Reseed to a clean, lively world right before you record**, then **join as your demo
   player AFTER it finishes** (otherwise your tab self-heals into a fresh guest mid-take):
   ```bash
   pnpm db:reseed-live        # ~90s: pauses worker, resets to baseline, resumes worker
   ```
   After it prints "done — world re-seeded," open `/world` (auto-joins you as a guest).
3. **Capture settings:** 1920×1080 (or 1440p) @ 30fps. Full-screen browser, hide the
   bookmarks bar, zoom 100%, quiet desktop notifications.
4. **Tabs to pre-open:** `/world` (two-panel), the **AWS Aurora DSQL console** (cluster
   overview + Peers/region tab — the multi-region storage proof), and
   `docs/architecture.png` (or `.svg`). The home `/` route also carries the leaderboard,
   but `/world` already shows it below the panels — you can stay on `/world` throughout.
5. **Pick your beats:** a **bright cell** near the center to claim; confirm the book has a
   resting **best ask** so the one-tap **Buy** fills on camera (it will — the pulse bots
   keep both sides quoted).

> *Optional B-roll:* if you want an extra-fast field animation for a cutaway, run it
> locally with a 3s tick — but only say "running on Aurora DSQL" over the live/cloud and
> console shots, never the localhost ones.

---

## Shot list

| # | ~Time | Screen / action | Voiceover |
|---|-------|-----------------|-----------|
| 1 | 0:00–0:15 | `/world` full screen — already auto-joined (no login). Let the **crisp cyan density heatmap** visibly tick/evolve. **Scroll to zoom in** on a bright bloom of cells, then **scroll/drag to pan** across it. | "One living world. A grid of resources that grows, spreads, and collapses on its own — no script, just rules. Brightness is abundance — the field you see *is* the data, evolving in real time. I can zoom right into it." |
| 2 | 0:15–0:35 | Zoom back out. Hover a cell (inline tooltip: coords / commodity / density); click a **bright cell** → white outline + claim toast. Tap **"my cells"** so the field dims to just yours. | "No signup — I'm already in, and I can rename myself anytime. I claim a piece of it: that cell is mine now — every few seconds it mines its resource into my inventory and depletes the land. Scarcity is emergent: where the land thins, prices are about to move." |
| 3 | 0:35–0:55 | Look at the **market panel** (right): last price, the order-book depth (red asks / green bids), the trade tape ticking. | "On the right is the other half of the same screen: one global market. One order book per commodity, price-time priority. The map and the book are the same ledger, seen two ways." |
| 4 | 0:55–1:25 | In the ticket, tap a **quantity chip** (e.g. **5**), then hit **Buy** — the button reads the live price (`Buy 5 · 100 cr`). Fill toast appears; book depth drops; last price updates; a new row hits the tape. | "Trading is one tap. I pick a size, and Buy — it takes the best ask and settles instantly. No price to enter, nothing left resting. One short transaction debited me, paid the seller, moved the inventory, and recorded the trade — with the balance and inventory checks asserted *inside* that transaction." |
| 5 | 1:25–1:45 | Stay on the market; let the tape and price keep moving while you talk. | "Here's the twist: almost none of these orders are people. Market-maker and liquidity bots quote both sides every tick to keep the book alive — and momentum, value and arbitrage bots trade it as first-class players: same order book, same code path I just used, zero inference cost." |
| 6 | 1:45–2:05 | Scroll to the **leaderboard** (below the panels). Ranked list, AI tags, your row highlighted. | "One leaderboard ranks the real competition — human and AI — by net worth: credits plus holdings at last price. Which comes down to one question. Can you out-trade the machine?" |
| 7 | 2:05–2:35 | Cut to the **AWS Aurora DSQL console**: cluster overview / endpoint, then the multi-region **Peers** view (or a quick `players`/`trades` table peek). Then cut to `docs/architecture.png`. | "All of this rests on Amazon Aurora DSQL — the single source of truth. Strongly consistent, so no order can double-spend credits or sell the same unit twice, and there's no reconciliation pass, ever. Three runtimes share one ledger: the Next.js app on Vercel, the simulation heartbeat, and the agents." |
| 8 | 2:35–2:50 | Hold on the diagram; highlight the multi-region note, then a quick cut back to `/world` evolving + title card "Orbis Exchange". | "And DSQL is active-active across regions by design — a player in Frankfurt and one in Virginia would trade on one consistent world, with zero coordination in our code. That's the million-scale story: not a benchmark, a guarantee. Orbis Exchange — one living world, one ledger, and a machine to beat." |

---

## Continuous voiceover (read straight through, ~2:50)

> One living world. A grid of resources that grows, spreads, and collapses on its own —
> no script, just rules. Brightness is abundance — the field you see is the data,
> evolving in real time. I can zoom right into it.
>
> No signup — I'm already in, and I can rename myself anytime. I claim a piece of it.
> That cell is mine now — every few seconds it mines its resource into my inventory and
> depletes the land. Scarcity is emergent: where the land thins, prices are about to move.
>
> On the right is the other half of the same screen: one global market. One order book
> per commodity, price-time priority. The map and the book are the same ledger, seen two ways.
>
> Trading is one tap. I pick a size, and Buy — it takes the best ask and settles
> instantly. No price to enter, nothing left resting. One short transaction debited me,
> paid the seller, moved the inventory, and recorded the trade — with the balance and
> inventory checks asserted inside that transaction.
>
> Here's the twist: almost none of these orders are people. Market-maker and liquidity
> bots quote both sides every tick to keep the book alive — and momentum, value and
> arbitrage bots trade it as first-class players: same order book, same code path I just
> used, zero inference cost.
>
> One leaderboard ranks the real competition — human and AI — by net worth. Which comes
> down to one question: can you out-trade the machine?
>
> All of this rests on Amazon Aurora DSQL — the single source of truth. Strongly
> consistent, so no order can double-spend credits or sell the same unit twice, and
> there's no reconciliation pass, ever. Three runtimes share one ledger: the Next.js app
> on Vercel, the simulation heartbeat, and the agents.
>
> And DSQL is active-active across regions by design — a player in Frankfurt and one in
> Virginia would trade on one consistent world, with zero coordination in our code.
> That's the million-scale story: not a benchmark, a guarantee.
>
> Orbis Exchange — one living world, one ledger, and a machine to beat.

---

## On-screen text / lower-thirds (optional but recommended)

- 0:02 — `ORBIS EXCHANGE`
- 0:08 — `No login — auto-join as a guest`
- 0:11 — `Scroll to zoom · scroll or drag to pan`
- 0:20 — `Claim a cell → it mines for you`
- 1:00 — `One tap — pick a size, Buy at the best ask`
- 1:08 — `One transaction. No double-spend. No oversell.`
- 1:30 — `Liquidity + strategy bots — same book, zero inference`
- 2:05 — `Net worth = credits + holdings`
- 2:28 — `Amazon Aurora DSQL — the single source of truth`
- 2:42 — `Active-active, multi-region — one consistent world`

## Capture tips

- The live field ticks ~10×/min, so it's always moving — start a world shot a beat
  before a tick lands so the motion reads on camera. The market tape and prices move
  continuously regardless.
- Shot #4: confirm a resting **best ask** before the take (the pulse + maker bots keep
  one quoted). Tap a size chip, then **Buy** — one click, it fills fully and shows the
  price on the button. If a button is disabled it shows the reason ("need credits" /
  "no ore") — clear it off-camera first.
- Keep the cursor deliberate; pause ~1s after each click so the toast and book update
  are legible.
- The leaderboard intentionally shows only the **strategy opponents** (momentum / value
  / arb). The makers, the pulse liquidity bot, and the scout supplier run the market but
  stay off the board — so don't call them out as "competitors"; they're the market.
- Storage proof (H0 requirement): in the DSQL console capture (a) the cluster
  overview/endpoint and (b) the multi-region **Peers** tab (or a `players`/`trades`
  table result) — this is the "storage configuration proving AWS database usage."

## Checklist before upload

- [ ] Length **under 3:00** (target ~2:50; rules allow up to 5:00 but judges asked for under 3).
- [ ] Shows the world evolving **and** a trade settling.
- [ ] Names **Amazon Aurora DSQL** out loud and on screen.
- [ ] Shows storage config (DSQL console) + the architecture diagram.
- [ ] Upload **public** (YouTube/Vimeo); paste the URL into Devpost, the README, and
      `docs/devpost-submission.md`.
