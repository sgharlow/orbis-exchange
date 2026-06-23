"use client";

import { useEffect, useRef, useState } from "react";
import type { WorldCell } from "@orbis/db";
import {
  rampColor,
  resourceRgb,
  hoverLabel,
  ACCENT_DENSITY_THRESHOLD,
  WORLD_RESOURCE_TYPES,
  cellIndexFromPoint,
} from "@/lib/world-view";
import { formatCredits } from "@/lib/market-view";

const CELL = 9; // logical px per cell
const POLL_MS = 3000; // matches the simulation tick (spec §5.2)
const PAUSE_AFTER_MS = 10000; // no generation advance for this long -> show PAUSED
const FIELD_BG = "#05070d";

// CSS gradient mirroring rampColor's stops, for the density scale key.
const DENSITY_SCALE =
  "linear-gradient(90deg, rgb(8,12,26), rgb(18,54,112), rgb(32,140,205), rgb(56,224,245), rgb(214,250,255))";

function gridSize(cells: WorldCell[]): number {
  let max = 0;
  for (const c of cells) max = Math.max(max, c.x, c.y);
  return max + 1;
}

export function WorldView({
  region,
  initialCells,
  initialGeneration,
}: {
  region: string;
  initialCells: WorldCell[];
  initialGeneration: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [generation, setGeneration] = useState(initialGeneration);
  const [live, setLive] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reveal, setReveal] = useState<string | null>(null);
  const [hover, setHover] = useState<{ left: number; top: number; text: string } | null>(null);
  const [claimMsg, setClaimMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  const size = gridSize(initialCells);
  const n = size * size;

  const typesRef = useRef<string[]>([]);
  const displayRef = useRef<Float32Array>(new Float32Array(n));
  const targetRef = useRef<Float32Array>(new Float32Array(n));
  const densityRef = useRef<Int16Array>(new Int16Array(n)); // latest true density (for hover)
  const idsRef = useRef<string[]>([]); // cell id by index (for claiming)
  const ownerIdsRef = useRef<(string | null)[]>([]); // owner by index (for outlines)
  const listPricesRef = useRef<(string | null)[]>([]);
  const [sel, setSel] = useState<{ idx: number; cellId: string; price: string | null } | null>(null);
  const [askPrice, setAskPrice] = useState("");

  // Wheel-to-zoom view transform (CSS transform on the canvas, origin top-left). Hit
  // testing reads getBoundingClientRect, which already reflects the transform, so
  // claiming stays pixel-accurate at any zoom. viewRef mirrors the state so the native
  // wheel listener (set up in the effect below) reads the current view without a stale
  // closure; setView re-renders to apply the transform.
  const MIN_Z = 1;
  const MAX_Z = 9;
  const [view, setView] = useState({ z: 1, tx: 0, ty: 0 });
  const viewRef = useRef({ z: 1, tx: 0, ty: 0 });
  const dragRef = useRef({ active: false, sx: 0, sy: 0, tx: 0, ty: 0, moved: false });
  const myIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const redrawRef = useRef<(() => void) | null>(null);
  const revealRef = useRef<string | null>(null);
  const selIdxRef = useRef<number | null>(null);
  const lastGenRef = useRef(initialGeneration);
  const lastAdvanceRef = useRef<number>(0);

  revealRef.current = reveal;
  selIdxRef.current = sel?.idx ?? null;

  // Seed the buffers from the server-rendered snapshot once (no window access).
  if (typesRef.current.length === 0) {
    const types = new Array<string>(n).fill("ore");
    const ids = new Array<string>(n).fill("");
    const owners = new Array<string | null>(n).fill(null);
    const prices = new Array<string | null>(n).fill(null);
    const display = displayRef.current;
    for (const c of initialCells) {
      const i = c.y * size + c.x;
      types[i] = c.resource_type;
      ids[i] = c.id;
      owners[i] = c.owner_id;
      prices[i] = c.list_price;
      display[i] = c.density;
      targetRef.current[i] = c.density;
      densityRef.current[i] = c.density;
    }
    typesRef.current = types;
    idsRef.current = ids;
    ownerIdsRef.current = owners;
    listPricesRef.current = prices;
  }

  // Keep the field covering the viewport: translate stays within [D*(1-z), 0] per axis.
  function clampPan(t: number, z: number, D: number): number {
    return Math.min(0, Math.max(D * (1 - z), t));
  }
  function applyView(next: { z: number; tx: number; ty: number }) {
    viewRef.current = next;
    setView(next);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    myIdRef.current = window.localStorage.getItem("orbis_player_id");
    lastAdvanceRef.current = Date.now();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const dim = size * CELL;
    canvas.width = dim * dpr;
    canvas.height = dim * dpr;
    ctx.scale(dpr, dpr);

    // Offscreen 64x64 field: one pixel per cell, painted by rampColor, then scaled
    // up with smoothing so the cellular automaton's structure reads as a living
    // field instead of per-cell confetti (spec §A).
    const off = document.createElement("canvas");
    off.width = size;
    off.height = size;
    const offctx = off.getContext("2d")!;
    const img = offctx.createImageData(size, size);

    const draw = () => {
      const display = displayRef.current;
      const types = typesRef.current;
      const data = img.data;
      for (let i = 0; i < n; i++) {
        const [r, g, b] = rampColor(display[i]);
        const o = i * 4;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = 255;
      }
      offctx.putImageData(img, 0, 0);

      ctx.clearRect(0, 0, dim, dim);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, dim, dim);

      // Bloom: an additive, blurred copy makes dense cells emit light.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.5;
      ctx.filter = "blur(6px)";
      ctx.drawImage(off, 0, 0, dim, dim);
      ctx.restore();

      // Reveal layer: fleck the cells of one commodity, on demand (spec §B).
      const rev = revealRef.current;
      if (rev && rev !== "mine") {
        for (let i = 0; i < n; i++) {
          if (types[i] !== rev || display[i] < ACCENT_DENSITY_THRESHOLD) continue;
          const cx = (i % size) * CELL + CELL / 2;
          const cy = Math.floor(i / size) * CELL + CELL / 2;
          const [pr, pg, pb] = rev === "energy" ? [235, 245, 255] : resourceRgb(rev);
          ctx.fillStyle = `rgba(${pr}, ${pg}, ${pb}, 0.88)`;
          ctx.beginPath();
          ctx.arc(cx, cy, CELL * 0.32, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // "Find my cells": dim the whole field so your handful of cells stand alone.
      if (rev === "mine") {
        ctx.fillStyle = "rgba(5, 7, 13, 0.66)";
        ctx.fillRect(0, 0, dim, dim);
      }

      // Agency overlays: your cells (bold bright marker + cyan glow), for-sale cells
      // (gold), and the selected cell. Other players' plain holdings are not outlined
      // (≈0.1% of cells own them — clutter for nothing).
      const me = myIdRef.current;
      const owners = ownerIdsRef.current;
      const prices = listPricesRef.current;
      for (let i = 0; i < n; i++) {
        const x = (i % size) * CELL;
        const y = Math.floor(i / size) * CELL;
        if (prices[i] !== null) {
          ctx.fillStyle = "rgba(245, 196, 80, 0.20)";
          ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
          ctx.strokeStyle = "rgba(245, 196, 80, 0.95)";
          ctx.lineWidth = 1.4;
          ctx.strokeRect(x + 1.2, y + 1.2, CELL - 2.4, CELL - 2.4);
        } else if (owners[i] !== null && me !== null && owners[i] === me) {
          const cx = x + CELL / 2;
          const cy = y + CELL / 2;
          ctx.save();
          ctx.shadowColor = "rgba(56, 224, 245, 0.9)";
          ctx.shadowBlur = 7;
          ctx.fillStyle = "rgba(238, 243, 255, 0.96)";
          ctx.beginPath();
          ctx.arc(cx, cy, CELL * 0.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          ctx.strokeStyle = "rgba(56, 224, 245, 0.95)";
          ctx.lineWidth = 1.6;
          ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
        }
      }

      const selIdx = selIdxRef.current;
      if (selIdx !== null) {
        const x = (selIdx % size) * CELL;
        const y = Math.floor(selIdx / size) * CELL;
        ctx.strokeStyle = "rgba(56, 224, 245, 0.95)";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
      }
    };
    redrawRef.current = draw;

    const step = () => {
      const display = displayRef.current;
      const target = targetRef.current;
      let moving = false;
      for (let i = 0; i < n; i++) {
        const d = display[i];
        const t = target[i];
        const nd = d + (t - d) * 0.18;
        if (Math.abs(t - nd) > 0.4) moving = true;
        display[i] = nd;
      }
      draw();
      rafRef.current = moving ? requestAnimationFrame(step) : null;
    };
    const kick = () => {
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(step);
    };

    // Record a generation advance so the FEED indicator can tell LIVE from PAUSED.
    const noteGeneration = (g: number) => {
      setGeneration(g);
      if (g > lastGenRef.current) {
        lastGenRef.current = g;
        lastAdvanceRef.current = Date.now();
        setPaused(false);
      }
    };

    draw();

    // Mouse-wheel zoom, centered on the cursor so the cell under the pointer stays put
    // while it grows — the clearest way to see which cell you're about to claim. Native
    // listener (not React onWheel) so we can preventDefault and stop the page scrolling.
    const onWheel = (e: WheelEvent) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      e.preventDefault();
      const r = wrap.getBoundingClientRect();
      const D = r.width;
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const cur = viewRef.current;
      const nz = Math.min(MAX_Z, Math.max(MIN_Z, cur.z * Math.exp(-e.deltaY * 0.0015)));
      // World-local point under the cursor before zoom; keep it fixed after.
      const ux = (px - cur.tx) / cur.z;
      const uy = (py - cur.ty) / cur.z;
      const ntx = clampPan(px - ux * nz, nz, D);
      const nty = clampPan(py - uy * nz, nz, D);
      viewRef.current = { z: nz, tx: ntx, ty: nty };
      setView(viewRef.current);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/world?region=${encodeURIComponent(region)}`, { cache: "no-store" });
        if (!res.ok) {
          setLive(false);
          return;
        }
        const data: { generation: number; cells: WorldCell[] } = await res.json();
        if (cancelled) return;
        setLive(true);
        noteGeneration(data.generation);
        const target = targetRef.current;
        const owners = ownerIdsRef.current;
        const ids = idsRef.current;
        for (const c of data.cells) {
          const i = c.y * size + c.x;
          target[i] = c.density;
          densityRef.current[i] = c.density;
          owners[i] = c.owner_id; // refresh ownership outlines
          ids[i] = c.id;
          listPricesRef.current[i] = c.list_price;
        }
        kick();
        draw(); // ensure ownership/listing repaint even if densities are settled
      } catch {
        if (!cancelled) setLive(false);
      }
    };
    const id = setInterval(poll, POLL_MS);

    // PAUSED watchdog: the feed is reachable but the world has stopped advancing.
    const pauseCheck = setInterval(() => {
      if (Date.now() - lastAdvanceRef.current > PAUSE_AFTER_MS) setPaused(true);
    }, 2000);

    // Realtime cell-density deltas (spec §5.3); poll above is the fallback.
    const es = new EventSource(`/api/stream?region=${encodeURIComponent(region)}`);
    es.addEventListener("world", (ev) => {
      try {
        const d = JSON.parse((ev as MessageEvent).data) as {
          generation: number;
          cells: { x: number; y: number; density: number }[];
        };
        const target = targetRef.current;
        for (const c of d.cells) {
          const i = c.y * size + c.x;
          target[i] = c.density;
          densityRef.current[i] = c.density;
        }
        noteGeneration(d.generation);
        setLive(true);
        kick();
      } catch {
        /* ignore a malformed frame */
      }
    });

    // When the viewer joins the market (in MarketPanel), learn their id so their
    // own cells outline brightly.
    const onPlayer = (e: Event) => {
      myIdRef.current = (e as CustomEvent<string>).detail;
      draw();
    };
    window.addEventListener("orbis:player", onPlayer);

    // Reveal-layer sync: the world chips and the market commodity tabs both emit
    // `orbis:reveal`; this is the single source of truth for the active layer.
    const onReveal = (e: Event) => {
      const detail = (e as CustomEvent<string | null>).detail ?? null;
      revealRef.current = detail;
      setReveal(detail);
      redrawRef.current?.();
    };
    window.addEventListener("orbis:reveal", onReveal as EventListener);

    return () => {
      cancelled = true;
      canvas.removeEventListener("wheel", onWheel);
      clearInterval(id);
      clearInterval(pauseCheck);
      es.close();
      window.removeEventListener("orbis:player", onPlayer);
      window.removeEventListener("orbis:reveal", onReveal as EventListener);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [region, size, n]);

  function selectReveal(layer: string | null) {
    // Dispatch only; the `orbis:reveal` listener is the single source of truth and
    // also lets the market panel switch its commodity tab in lock-step.
    window.dispatchEvent(new CustomEvent("orbis:reveal", { detail: layer }));
  }

  function cellAt(e: React.MouseEvent<HTMLCanvasElement>): { idx: number; ox: number; oy: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    const idx = cellIndexFromPoint(ox, oy, rect.width, rect.height, size);
    if (idx === null) return null;
    return { idx, ox, oy };
  }

  function handleHover(e: React.MouseEvent<HTMLCanvasElement>) {
    const at = cellAt(e);
    if (!at) {
      setHover(null);
      return;
    }
    const text = hoverLabel(
      {
        x: at.idx % size,
        y: Math.floor(at.idx / size),
        resource_type: typesRef.current[at.idx] || "ore",
        density: densityRef.current[at.idx],
        owner_id: ownerIdsRef.current[at.idx],
        list_price: listPricesRef.current[at.idx],
      },
      myIdRef.current ?? (typeof window !== "undefined" ? window.localStorage.getItem("orbis_player_id") : null)
    );
    // Position the tip at the cursor relative to the wrap (not the canvas), so it
    // tracks correctly even when the canvas is zoomed/panned by a transform.
    const wrect = wrapRef.current?.getBoundingClientRect();
    setHover({ left: e.clientX - (wrect?.left ?? 0), top: e.clientY - (wrect?.top ?? 0), text });
  }

  // Drag-to-pan, only meaningful when zoomed in. A >4px move marks it as a drag so the
  // ensuing click doesn't claim a cell. At z===1 there's nothing to pan, so a press is
  // never treated as a drag and click-to-claim works normally.
  function onPointerDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0 || viewRef.current.z <= 1) return;
    const cur = viewRef.current;
    dragRef.current = { active: true, sx: e.clientX, sy: e.clientY, tx: cur.tx, ty: cur.ty, moved: false };
  }
  function onCanvasMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const d = dragRef.current;
    if (d.active) {
      const D = wrapRef.current?.getBoundingClientRect().width ?? 0;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      const z = viewRef.current.z;
      applyView({ z, tx: clampPan(d.tx + dx, z, D), ty: clampPan(d.ty + dy, z, D) });
      setHover(null);
      return;
    }
    handleHover(e);
  }
  function onPointerUp() {
    dragRef.current.active = false;
  }

  async function handleClaim(e: React.MouseEvent<HTMLCanvasElement>) {
    // A pan drag ends with a click event — don't let it claim the cell it lands on.
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    const at = cellAt(e);
    if (!at) return;
    const idx = at.idx;
    const cellId = idsRef.current[idx];
    if (!cellId) return;

    const meNow = myIdRef.current ?? window.localStorage.getItem("orbis_player_id");
    if (ownerIdsRef.current[idx] !== null && meNow !== null && ownerIdsRef.current[idx] === meNow) {
      const price = listPricesRef.current[idx];
      setAskPrice(price ?? "");
      setSel({ idx, cellId, price });
      setClaimMsg(null);
      redrawRef.current?.();
      return;
    }

    setClaimMsg({ kind: "info", text: "claiming…" });
    try {
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cell_id: cellId }),
      });
      if (res.status === 401) {
        setClaimMsg({ kind: "err", text: "join via the market panel to claim cells" });
        return;
      }
      const data = await res.json();
      if (data.claimed) {
        ownerIdsRef.current[idx] = myIdRef.current ?? window.localStorage.getItem("orbis_player_id");
        redrawRef.current?.();
        setClaimMsg({
          kind: "ok",
          text: paused
            ? `claimed cell ${cellId} — it mines each tick once the world is live`
            : `claimed cell ${cellId} — it now mines for you`,
        });
      } else {
        const r = data.reason;
        setClaimMsg({
          kind: "err",
          text:
            r === "taken"
              ? "already claimed"
              : r === "insufficient_credits"
                ? "need 500 cr — sell some holdings (click a holding in your dashboard) to afford it"
                : r === "cell_cap"
                  ? "cell limit reached (12) — sell or list a cell before claiming another"
                  : "could not claim",
        });
      }
    } catch {
      setClaimMsg({ kind: "err", text: "network error" });
    }
  }

  async function submitListing(price: number | null) {
    if (!sel) return;
    try {
      const res = await fetch(`/api/claims/${sel.cellId}/list`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ price }),
      });
      if (res.status === 401) {
        setClaimMsg({ kind: "err", text: "join via the market panel first" });
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setClaimMsg({ kind: "err", text: data.error ?? "could not list" });
        return;
      }
      listPricesRef.current[sel.idx] = price === null ? null : String(price);
      redrawRef.current?.();
      setClaimMsg({
        kind: "ok",
        text: price === null ? "cell unlisted" : `listed for ${formatCredits(price)} cr — gold outline marks it for sale`,
      });
      setSel(null);
    } catch {
      setClaimMsg({ kind: "err", text: "network error" });
    }
  }

  const feedState = !live ? "stalled" : paused ? "paused" : "live";
  const feedText = !live ? "○ STALLED" : paused ? "○ PAUSED" : "● LIVE";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", alignItems: "center" }}>
      <div
        className="canvas-wrap"
        ref={wrapRef}
        style={{
          width: "min(92vw, 72vh, 620px)",
          height: "min(92vw, 72vh, 620px)",
          overflow: "hidden",
          borderRadius: 10,
          background: FIELD_BG,
          boxShadow:
            "0 0 0 1px rgba(120,160,220,0.18), 0 0 60px rgba(40,120,200,0.15), inset 0 0 80px rgba(0,0,0,0.6)",
        }}
      >
        <canvas
          ref={canvasRef}
          onClick={handleClaim}
          onMouseDown={onPointerDown}
          onMouseMove={onCanvasMove}
          onMouseUp={onPointerUp}
          onMouseLeave={() => {
            onPointerUp();
            setHover(null);
          }}
          aria-label={`Living resource field for region ${region}, ${size} by ${size} cells. Click a cell to claim it. Scroll to zoom; drag to pan when zoomed in.`}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            background: FIELD_BG,
            cursor: view.z > 1 ? (dragRef.current.active ? "grabbing" : "grab") : "crosshair",
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.z})`,
            transformOrigin: "0 0",
            willChange: "transform",
          }}
        />
        {hover && (
          <span className="cell-tip" style={{ left: hover.left, top: hover.top }}>
            {hover.text}
          </span>
        )}
        {view.z > 1 && (
          <button
            className="zoom-reset"
            onClick={() => applyView({ z: 1, tx: 0, ty: 0 })}
            aria-label="Reset zoom"
          >
            {view.z.toFixed(1)}× · reset
          </button>
        )}
      </div>

      <div className="hud-row">
        <span className="hud-stat">
          <span className="hud-label">GEN</span>
          <span className="hud-value">{String(generation).padStart(5, "0")}</span>
        </span>
        <span className="hud-stat">
          <span className="hud-label">REGION</span>
          <span className="hud-value">{region}</span>
        </span>
        <span className="hud-stat">
          <span className="hud-label">FEED</span>
          <span className="hud-value" data-feed={feedState}>
            {feedText}
          </span>
        </span>
      </div>

      {feedState === "paused" && (
        <p className="feed-note">the world advances while the simulation worker runs</p>
      )}

      <div className="claim-line">
        {sel ? (
          <span className="list-form">
            <span className="list-cell">cell {sel.cellId}{sel.price ? ` · listed at ${formatCredits(sel.price)}` : ""}</span>
            <input
              inputMode="numeric"
              placeholder="price"
              value={askPrice}
              onChange={(e) => setAskPrice(e.target.value)}
              aria-label="list price"
            />
            <button
              onClick={() => {
                const p = Number(askPrice);
                if (!Number.isInteger(p) || p <= 0) {
                  setClaimMsg({ kind: "err", text: "enter a positive whole price" });
                  return;
                }
                submitListing(p);
              }}
            >
              list
            </button>
            {sel.price !== null && <button onClick={() => submitListing(null)}>unlist</button>}
            <button
              onClick={() => {
                setSel(null);
                redrawRef.current?.();
              }}
              aria-label="close"
            >
              ✕
            </button>
          </span>
        ) : claimMsg ? (
          <span className={`claim-msg ${claimMsg.kind}`}>{claimMsg.text}</span>
        ) : (
          <span className="claim-hint">hover a cell to inspect it · scroll to zoom (drag to pan) · click to claim — your cells mine every tick · click a cell you own to list the plot for sale</span>
        )}
      </div>

      <div className="reveal-row" role="group" aria-label="Reveal a commodity's cells">
        <span className="reveal-label">reveal</span>
        <button className="reveal-chip" data-active={reveal === null} onClick={() => selectReveal(null)}>
          none
        </button>
        {WORLD_RESOURCE_TYPES.map((t) => (
          <button
            key={t}
            className="reveal-chip"
            data-active={reveal === t}
            style={{ ["--hue" as string]: `rgb(${resourceRgb(t).join(",")})` }}
            onClick={() => selectReveal(t)}
          >
            {t}
          </button>
        ))}
        <button
          className="reveal-chip reveal-mine"
          data-active={reveal === "mine"}
          onClick={() => selectReveal("mine")}
          title="Spotlight the cells you've claimed"
        >
          ◎ my cells
        </button>
      </div>

      <div className="scale-row" aria-label="Density scale and cell markers">
        <span className="scale-key">
          <span className="scale-cap">scarce</span>
          <span className="scale-bar" style={{ background: DENSITY_SCALE }} />
          <span className="scale-cap">abundant</span>
        </span>
        <span className="scale-marks">
          <span className="scale-mark"><span className="mk mk-own" /> your cell</span>
          <span className="scale-mark"><span className="mk mk-listed" /> for sale</span>
        </span>
      </div>
    </div>
  );
}
