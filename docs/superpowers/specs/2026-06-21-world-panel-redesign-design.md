# World-Panel Redesign — design

**Date:** 2026-06-21
**Status:** Approved (brainstorming) — ready for implementation planning
**Scope:** `apps/web` world view only. No simulation, market/settlement, agent, or DB changes.

## Why

A judge-perspective review (and the user's own play-test) found the `/world` page
unintuitive: the living-world board reads as random colored static, the page is
"too full," and nothing on-screen explains the goal or how to play. This redesign
makes the board legible and alive, teaches the game inline, and de-clutters the
panel — without touching any working contract.

### Root cause (verified on live data, gen 269)

- The board paints **two visual variables in a 9px cell** — hue = resource type,
  brightness = density — across **four spatially-interleaved commodities**, so it
  reads as confetti.
- **Resource type is assigned per-cell by a hash** (`packages/db/src/world.ts`,
  `generateWorld`) — it is **scattered, never spatially clustered.** A
  single-commodity view is therefore holey dots, not legible territory.
- The structure the cellular automaton actually creates lives in the **density
  field** (`apps/worker/src/ca.ts`, Conway-style Moore-neighborhood rules). At the
  shipped parameters that field is **reticular (a fine vein/maze texture), not big
  blobs** — so no rendering trick manufactures "continents"; the win is converting
  noise into a coherent *living* field, with motion as the hero.
- Live ownership is **5/4096 cells (0.1%), 0 listed** — claiming is wide open, so
  competitor-ownership overlays are unnecessary clutter.

Evidence renders (real gen-269 data) live in `demo-out/`:
`mockup-board-variants.png`, `mockup-smoothing.png`,
`mockup-heatmap-treatments.png`, `mockup-layer-toggle.png`.

## Locked visual decisions

- **Base field:** single-hue **cyan density heatmap, smoothed, + bloom glow**,
  animated on the tick. (Chosen over flat cyan, ice, viridis, thermal/magma, and
  topographic-contour variants — all rendered on real data.)
- **Resource type** is **not** the base layer. It becomes **toggleable
  single-commodity accent layers**, default **off / one-at-a-time**, synced to the
  market commodity tab. "All on" is allowed but intentionally busy (it reproduces
  the original noise — that's the teaching point).

## Design

### A. Living density field (base render)

Replace per-cell hue rendering in `WorldView.tsx` with a smoothed single-hue field:

1. Add `rampColor(density: number): [r,g,b]` to `apps/web/src/lib/world-view.ts`
   — cyan stops: `0→[8,12,26]`, `0.35→[18,54,112]`, `0.6→[32,140,205]`,
   `0.82→[56,224,245]`, `1→[214,250,255]` (linear interp, density 0..100).
2. Each frame, build a **64×64 `ImageData`** from the (lerp-animated) density
   buffer via `rampColor`, `putImageData` to a 64×64 offscreen canvas, then
   `drawImage` it onto the display canvas scaled up with
   `ctx.imageSmoothingEnabled = true` → free bilinear smoothing.
3. **Bloom:** draw a blurred bright-pass over the field with
   `ctx.filter = "blur(6px)"` and `globalCompositeOperation = "lighter"`, then
   reset filter/composite.
4. Keep the existing `display→target` lerp (`step()`/`requestAnimationFrame`) so
   density transitions animate; the 64×64 ImageData rebuild per frame is cheap.
5. **Unchanged:** `CELL`, canvas display size, and `cellIndexFromPoint` — so
   click→cell mapping and the claim/list flow are untouched.

### B. Resource-type toggle layers

- A chip row near the board: **`Reveal: none · ore · energy · biomass · rare`**,
  default **none**, single-select (radio semantics; "all" is an extra chip).
- When a layer is active, cells of that type with **density ≥ 55** get an accent
  in the commodity's brand color (`ore [245,176,66]`, `biomass [64,224,148]`,
  `rare [196,132,252]`). **Energy uses a white-cored pip / brightened ring**
  because cyan vanishes into the cyan base.
- **Sync with the market tab:** selecting a commodity in `MarketPanel` sets the
  reveal layer to match, and vice-versa, via the existing
  `window` CustomEvent bus (same pattern as `orbis:player`). Add an
  `orbis:reveal` event (detail: commodity | null). No shared store needed.

### C. Agency overlays + hover tooltip

- Keep: **your cells** = bright white ring; **for-sale** = gold ring; **selected
  cell** highlight. **Remove** the "other owned" faint outline (0.1% owned — noise).
- **Hover tooltip:** `onMouseMove` over the canvas → `cellIndexFromPoint` → an
  absolutely-positioned label near the cursor showing cell `(x,y)`, resource type,
  density, and state-specific call to action:
  - unclaimed → `"(12,40) · ore · density 82 · click to claim · 500 cr"`
  - yours → `"(12,40) · yours · mining ore · click to sell"`
  - listed → `"(12,40) · listed · 1,200 cr"`
- Tooltip state is local to `WorldView`; throttle to animation frame.

### D. Onboarding / goal layer

- **Objective rail** (always visible, above the board): three chips —
  **① Enter the market (free · 10,000 cr) → ② Click a cell to claim it (mines
  every tick) → ③ Sell what it mines · beat the AI.**
- **First-visit coachmark:** a dismissible overlay with the same three steps + a
  "Got it" button, gated by `localStorage` key `orbis_seen_intro`; reopenable via
  a small **"?"** button on the board. No overlay on return visits.

### E. De-clutter the chrome

- Move the primary instruction out of the 0.66rem low-contrast claim-hint into the
  objective rail (D).
- Replace the 6-item resource legend with: a **density scale bar** (low→high cyan
  gradient, labeled) + **your-cell** and **for-sale** marker keys. Resource colors
  now live only in the toggle chips (no duplication).
- Keep the GEN / REGION / FEED HUD. Replace the cryptic footer
  (`density = abundance · …`) with a one-line plain caption or remove it.

### F. Motion & honesty

- Keep SSE + 3s poll animation.
- Make the live indicator truthful: track the last generation-advance time; if
  `generation` has not advanced in **~10s**, render **`○ PAUSED`** instead of
  `● LIVE`. (Prevents a frozen board labeled "LIVE".)
- **Optional (only if time):** a faint per-frame idle shimmer so the field breathes
  between ticks.

### G. Root page

- **Redirect `/` → `/world`** (the apex page is currently raw unstyled HTML).
  Optional alternative (only if time): a thin styled splash reusing the
  `demo-out/intro.png` aesthetic with a single "Enter" CTA.

### H. Contracts & testing

- **No API or data-contract changes.** `/api/world`, `/api/claims`,
  `/api/claims/:id/list`, `/api/orders`, `/api/session`, `/api/me`,
  `/api/leaderboard`, and SSE `/api/stream` are all untouched.
- Unit-test the new pure functions in `world-view.ts` (`rampColor` endpoints +
  monotonic ramp, accent threshold, hover→cell mapping reuse), matching the
  existing `world-view`/`market-view` test pattern. `pnpm -r test` and
  `pnpm -r lint` stay green; `next build` exit 0.

## Scope

- **Core (this change):** A, B, C, D, E, F (live indicator), G (redirect).
- **Optional (only if time before recording):** F idle shimmer, G styled splash,
  an "Atlas" all-four-colors toggle.
- **Explicitly out of scope:** the CA/simulation, market/settlement engine, agent
  logic, the database, and the market panel internals (it changes only by
  emitting/consuming the `orbis:reveal` sync event).

## Risks

- **Bloom performance:** `ctx.filter` blur per frame on a ~600px canvas is cheap,
  but verify on a mid laptop; fall back to a pre-blurred offscreen if needed.
- **Energy accent legibility** on the cyan base — validated as needing the
  white-cored treatment; confirm in implementation.
- **Recording timing:** core is intentionally bounded so it lands before narration;
  optionals are cut-first if time is short.
