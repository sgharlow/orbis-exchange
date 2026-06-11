"use client";

import { useEffect, useRef, useState } from "react";
import type { WorldCell } from "@orbis/db";
import { cellColor, legendColor, WORLD_RESOURCE_TYPES } from "@/lib/world-view";

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

  const size = gridSize(initialCells);
  const n = size * size;

  // Resource type is fixed in Phase 1; density tweens toward the polled target.
  const typesRef = useRef<string[]>([]);
  const displayRef = useRef<Float32Array>(new Float32Array(n));
  const targetRef = useRef<Float32Array>(new Float32Array(n));
  const rafRef = useRef<number | null>(null);

  // Seed the buffers from the server-rendered snapshot once.
  if (typesRef.current.length === 0) {
    const types = new Array<string>(n).fill("ore");
    const display = displayRef.current;
    for (const c of initialCells) {
      const i = c.y * size + c.x;
      types[i] = c.resource_type;
      display[i] = c.density;
      targetRef.current[i] = c.density;
    }
    typesRef.current = types;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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
      for (let i = 0; i < n; i++) {
        const x = (i % size) * CELL;
        const y = Math.floor(i / size) * CELL;
        ctx.fillStyle = cellColor(types[i], display[i]);
        ctx.fillRect(x, y, CELL - 0.6, CELL - 0.6); // tiny gap reads as a grid
      }
    };

    // Ease displayed density toward target; stop the loop once settled.
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
        const res = await fetch(`/api/world?region=${encodeURIComponent(region)}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          setLive(false);
          return;
        }
        const data: { generation: number; cells: WorldCell[] } = await res.json();
        if (cancelled) return;
        setLive(true);
        setGeneration(data.generation);
        const target = targetRef.current;
        for (const c of data.cells) target[c.y * size + c.x] = c.density;
        kick();
      } catch {
        if (!cancelled) setLive(false);
      }
    };

    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [region, size, n]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", alignItems: "center" }}>
      <canvas
        ref={canvasRef}
        aria-label={`Living resource field for region ${region}, ${size} by ${size} cells`}
        style={{
          width: "min(72vmin, 620px)",
          height: "min(72vmin, 620px)",
          borderRadius: 10,
          background: FIELD_BG,
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
      <ul className="legend" aria-label="Resource legend">
        {WORLD_RESOURCE_TYPES.map((t) => (
          <li key={t} className="legend-item">
            <span className="legend-swatch" style={{ background: legendColor(t) }} />
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}
