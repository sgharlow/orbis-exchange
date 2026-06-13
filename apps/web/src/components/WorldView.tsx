"use client";

import { useEffect, useRef, useState } from "react";
import type { WorldCell } from "@orbis/db";
import {
  cellColor,
  legendColor,
  WORLD_RESOURCE_TYPES,
  outlineFor,
  cellIndexFromPoint,
} from "@/lib/world-view";
import { formatCredits } from "@/lib/market-view";

const CELL = 9; // logical px per cell
const POLL_MS = 3000; // matches the simulation tick (spec §5.2)
const FIELD_BG = "#05070d";

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
  const [generation, setGeneration] = useState(initialGeneration);
  const [live, setLive] = useState(true);
  const [claimMsg, setClaimMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  const size = gridSize(initialCells);
  const n = size * size;

  const typesRef = useRef<string[]>([]);
  const displayRef = useRef<Float32Array>(new Float32Array(n));
  const targetRef = useRef<Float32Array>(new Float32Array(n));
  const idsRef = useRef<string[]>([]); // cell id by index (for claiming)
  const ownerIdsRef = useRef<(string | null)[]>([]); // owner by index (for outlines)
  const listPricesRef = useRef<(string | null)[]>([]);
  const [sel, setSel] = useState<{ idx: number; cellId: string; price: string | null } | null>(null);
  const [askPrice, setAskPrice] = useState("");
  const myIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const redrawRef = useRef<(() => void) | null>(null);

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
    }
    typesRef.current = types;
    idsRef.current = ids;
    ownerIdsRef.current = owners;
    listPricesRef.current = prices;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    myIdRef.current = window.localStorage.getItem("orbis_player_id");

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const dim = size * CELL;
    canvas.width = dim * dpr;
    canvas.height = dim * dpr;
    ctx.scale(dpr, dpr);

    const draw = () => {
      ctx.fillStyle = FIELD_BG;
      ctx.fillRect(0, 0, dim, dim);
      const types = typesRef.current;
      const display = displayRef.current;
      const owners = ownerIdsRef.current;
      const me = myIdRef.current;
      for (let i = 0; i < n; i++) {
        const x = (i % size) * CELL;
        const y = Math.floor(i / size) * CELL;
        ctx.fillStyle = cellColor(types[i], display[i]);
        ctx.fillRect(x, y, CELL - 0.6, CELL - 0.6); // tiny gap reads as a grid
        const o = outlineFor(owners[i], me, listPricesRef.current[i]);
        if (o !== null) {
          if (o === "listed") {
            ctx.fillStyle = "rgba(245, 196, 80, 0.38)";
            ctx.fillRect(x, y, CELL - 0.6, CELL - 0.6);
          }
          ctx.strokeStyle =
            o === "own"
              ? "rgba(238,243,255,0.95)"
              : o === "listed"
                ? "rgba(245,196,80,0.95)"
                : "rgba(150,170,210,0.5)";
          ctx.lineWidth = o === "other" ? 1 : 1.5;
          ctx.strokeRect(x + 0.75, y + 0.75, CELL - 2.1, CELL - 2.1);
        }
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

    draw();

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
        setGeneration(data.generation);
        const target = targetRef.current;
        const owners = ownerIdsRef.current;
        const ids = idsRef.current;
        for (const c of data.cells) {
          const i = c.y * size + c.x;
          target[i] = c.density;
          owners[i] = c.owner_id; // refresh ownership outlines
          ids[i] = c.id;
          listPricesRef.current[i] = c.list_price;
        }
        kick();
        draw(); // ensure ownership repaint even if densities are settled
      } catch {
        if (!cancelled) setLive(false);
      }
    };
    const id = setInterval(poll, POLL_MS);

    // Realtime cell-density deltas (spec §5.3); poll above is the fallback.
    const es = new EventSource(`/api/stream?region=${encodeURIComponent(region)}`);
    es.addEventListener("world", (ev) => {
      try {
        const d = JSON.parse((ev as MessageEvent).data) as {
          generation: number;
          cells: { x: number; y: number; density: number }[];
        };
        const target = targetRef.current;
        for (const c of d.cells) target[c.y * size + c.x] = c.density;
        setGeneration(d.generation);
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

    return () => {
      cancelled = true;
      clearInterval(id);
      es.close();
      window.removeEventListener("orbis:player", onPlayer);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [region, size, n]);

  async function handleClaim(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const idx = cellIndexFromPoint(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height, size);
    if (idx === null) return;
    const cellId = idsRef.current[idx];
    if (!cellId) return;

    const meNow = myIdRef.current ?? window.localStorage.getItem("orbis_player_id");
    if (ownerIdsRef.current[idx] !== null && meNow !== null && ownerIdsRef.current[idx] === meNow) {
      const price = listPricesRef.current[idx];
      setAskPrice(price ?? "");
      setSel({ idx, cellId, price });
      setClaimMsg(null);
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
        setClaimMsg({ kind: "ok", text: `claimed cell ${cellId} — it now mines for you` });
      } else {
        const r = data.reason;
        setClaimMsg({
          kind: "err",
          text: r === "taken" ? "already claimed" : r === "insufficient_credits" ? "not enough credits (500)" : "could not claim",
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", alignItems: "center" }}>
      <canvas
        ref={canvasRef}
        onClick={handleClaim}
        title="Click a cell to claim it"
        aria-label={`Living resource field for region ${region}, ${size} by ${size} cells. Click a cell to claim it.`}
        style={{
          width: "min(92vw, 72vh, 620px)",
          height: "min(92vw, 72vh, 620px)",
          borderRadius: 10,
          background: FIELD_BG,
          cursor: "crosshair",
          boxShadow:
            "0 0 0 1px rgba(120,160,220,0.18), 0 0 60px rgba(40,120,200,0.15), inset 0 0 80px rgba(0,0,0,0.6)",
        }}
      />
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
          <span className="hud-value" data-live={live}>
            {live ? "● LIVE" : "○ STALLED"}
          </span>
        </span>
      </div>
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
            <button onClick={() => setSel(null)} aria-label="close">✕</button>
          </span>
        ) : claimMsg ? (
          <span className={`claim-msg ${claimMsg.kind}`}>{claimMsg.text}</span>
        ) : (
          <span className="claim-hint">click a cell to claim it — claimed cells mine resources each tick · click your own cell to sell it</span>
        )}
      </div>
      <ul className="legend" aria-label="Resource legend">
        {WORLD_RESOURCE_TYPES.map((t) => (
          <li key={t} className="legend-item">
            <span className="legend-swatch" style={{ background: legendColor(t) }} />
            {t}
          </li>
        ))}
        <li className="legend-item">
          <span className="legend-swatch legend-own" />
          your cell
        </li>
        <li className="legend-item">
          <span className="legend-swatch legend-listed" />
          for sale
        </li>
      </ul>
    </div>
  );
}
