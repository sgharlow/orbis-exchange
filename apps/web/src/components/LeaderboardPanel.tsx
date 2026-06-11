"use client";

import { useEffect, useState } from "react";
import type { LeaderboardEntry } from "@orbis/db";
import { formatCredits } from "@/lib/market-view";

export function LeaderboardPanel({ initial }: { initial: LeaderboardEntry[] }) {
  const [board, setBoard] = useState<LeaderboardEntry[]>(initial);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/leaderboard", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { leaderboard: LeaderboardEntry[] };
        if (!cancelled) setBoard(data.leaderboard);
      } catch {
        /* keep last */
      }
    };
    load();
    const id = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <section className="board" aria-label="Leaderboard">
      <h2 className="panel-h">Leaderboard — AI vs human</h2>
      <ol className="board-list">
        {board.slice(0, 12).map((e, i) => (
          <li className="board-row" key={e.id} data-kind={e.kind}>
            <span className="board-rank">{String(i + 1).padStart(2, "0")}</span>
            <span className="board-handle">
              {e.handle}
              {e.kind === "agent" && <span className="board-ai">AI</span>}
            </span>
            <span className="board-net">{formatCredits(e.net_worth)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
