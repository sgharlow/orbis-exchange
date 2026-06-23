"use client";

import { useEffect, useState } from "react";
import type { LeaderboardEntry } from "@orbis/db";
import { formatCredits } from "@/lib/market-view";

const TOP = 12;

export function LeaderboardPanel({ initial }: { initial: LeaderboardEntry[] }) {
  const [board, setBoard] = useState<LeaderboardEntry[]>(initial);
  // Identify "you" by handle (carried on `orbis:me` from the dashboard, sourced from
  // the session cookie). Handles are unique and, unlike localStorage `orbis_player_id`,
  // are always present — including after a session rehydrate.
  const [myHandle, setMyHandle] = useState<string | null>(null);

  useEffect(() => {
    const onMe = (e: Event) => {
      const d = (e as CustomEvent<{ handle?: string | null }>).detail;
      setMyHandle(d?.handle ?? null);
    };
    window.addEventListener("orbis:me", onMe as EventListener);
    return () => window.removeEventListener("orbis:me", onMe as EventListener);
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

  // Broadcast the viewer's rank AND net worth so the dashboard ("rank N / M") and the
  // goal bar (progress toward the next milestone) update without a second fetch. The
  // server-computed net_worth (credits + inventory at last price) is the source of
  // truth — don't recompute it client-side. Depends on net_worth so it re-fires when
  // the player's worth changes even if their rank position is unchanged.
  const myIndex = myHandle ? board.findIndex((e) => e.handle === myHandle) : -1;
  const me = myIndex >= 0 ? board[myIndex] : null;
  const myNetWorth = me ? Number(me.net_worth) : null;
  useEffect(() => {
    if (myIndex >= 0) {
      window.dispatchEvent(
        new CustomEvent("orbis:rank", {
          detail: { rank: myIndex + 1, total: board.length, netWorth: myNetWorth },
        })
      );
    }
  }, [myIndex, board.length, myNetWorth]);

  const top = board.slice(0, TOP);
  const meOutsideTop = myIndex >= TOP; // joined but below the fold -> pin a row

  return (
    <section className="board" aria-label="Leaderboard">
      <h2 className="panel-h">Leaderboard — AI vs human</h2>
      <ol className="board-list">
        {top.map((e, i) => (
          <li className="board-row" key={e.id} data-kind={e.kind} data-you={!!myHandle && e.handle === myHandle}>
            <span className="board-rank">{String(i + 1).padStart(2, "0")}</span>
            <span className="board-handle">
              {e.handle}
              {!!myHandle && e.handle === myHandle && <span className="board-you">YOU</span>}
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
