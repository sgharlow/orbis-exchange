"use client";

import { useEffect, useState } from "react";
import type { LeaderboardEntry } from "@orbis/db";
import { formatCredits } from "@/lib/market-view";

const TOP = 12;

export function LeaderboardPanel({ initial }: { initial: LeaderboardEntry[] }) {
  const [board, setBoard] = useState<LeaderboardEntry[]>(initial);
  const [myId, setMyId] = useState<string | null>(null);

  useEffect(() => {
    setMyId(window.localStorage.getItem("orbis_player_id"));
    // Joining/leaving updates our id; re-read so our row lights up.
    const onPlayer = () => setMyId(window.localStorage.getItem("orbis_player_id"));
    window.addEventListener("orbis:player", onPlayer);
    return () => window.removeEventListener("orbis:player", onPlayer);
  }, []);

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

  // Broadcast the viewer's rank so the dashboard can show "rank N / M" without a
  // second leaderboard fetch.
  const myIndex = myId ? board.findIndex((e) => e.id === myId) : -1;
  useEffect(() => {
    if (myIndex >= 0) {
      window.dispatchEvent(
        new CustomEvent("orbis:rank", { detail: { rank: myIndex + 1, total: board.length } })
      );
    }
  }, [myIndex, board.length]);

  const top = board.slice(0, TOP);
  const me = myIndex >= 0 ? board[myIndex] : null;
  const meOutsideTop = myIndex >= TOP; // joined but below the fold -> pin a row

  return (
    <section className="board" aria-label="Leaderboard">
      <h2 className="panel-h">Leaderboard — AI vs human</h2>
      <ol className="board-list">
        {top.map((e, i) => (
          <li className="board-row" key={e.id} data-kind={e.kind} data-you={e.id === myId}>
            <span className="board-rank">{String(i + 1).padStart(2, "0")}</span>
            <span className="board-handle">
              {e.handle}
              {e.id === myId && <span className="board-you">YOU</span>}
              {e.kind === "agent" && <span className="board-ai">AI</span>}
            </span>
            <span className="board-net">{formatCredits(e.net_worth)}</span>
          </li>
        ))}
      </ol>
      {meOutsideTop && me && (
        <ol className="board-list board-pin" aria-label="Your rank">
          <li className="board-row" data-kind={me.kind} data-you="true">
            <span className="board-rank">{String(myIndex + 1).padStart(2, "0")}</span>
            <span className="board-handle">
              {me.handle}
              <span className="board-you">YOU</span>
            </span>
            <span className="board-net">{formatCredits(me.net_worth)}</span>
          </li>
        </ol>
      )}
    </section>
  );
}
