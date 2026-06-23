"use client";

import { useEffect, useRef, useState } from "react";
import { formatCredits } from "@/lib/market-view";
import { emitActivity } from "@/lib/activity";

// A reachable, escalating goal so the player always has a near target to climb to —
// instead of an unreachable "catch the 1.5M-net-worth AI" scoreboard. Net worth is
// the same metric the leaderboard ranks on (credits + inventory at last price); we
// receive it via `orbis:rank` from the leaderboard, never recompute it here.

const START = 10000; // everyone joins with 10,000 credits / 10k net worth
const MILESTONES = [20000, 50000, 100000, 250000, 500000, 1_000_000, 2_500_000, 5_000_000, 10_000_000];

export function GoalBar() {
  const [nw, setNw] = useState<number | null>(null);
  const [rank, setRank] = useState<{ rank: number; total: number } | null>(null);
  const [pulse, setPulse] = useState(false);
  // -2 = not yet initialized; on the first reading we adopt the current bracket
  // silently so we never celebrate milestones the player passed before this load.
  const celebratedRef = useRef<number>(-2);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ rank: number; total: number; netWorth?: number | null }>).detail;
      if (!d) return;
      setRank({ rank: d.rank, total: d.total });
      if (typeof d.netWorth === "number") setNw(d.netWorth);
    };
    window.addEventListener("orbis:rank", on as EventListener);
    return () => window.removeEventListener("orbis:rank", on as EventListener);
  }, []);

  useEffect(() => {
    if (nw === null) return;
    const achieved = MILESTONES.filter((m) => nw >= m).length;
    if (celebratedRef.current === -2) {
      celebratedRef.current = achieved; // adopt current progress, no celebration
      return;
    }
    if (achieved > celebratedRef.current) {
      celebratedRef.current = achieved;
      emitActivity("ok", `🎯 milestone reached — net worth ${formatCredits(MILESTONES[achieved - 1])} cr`);
      setPulse(true);
      setTimeout(() => setPulse(false), 1400);
    }
  }, [nw]);

  if (nw === null) return null;

  const idx = MILESTONES.findIndex((m) => nw < m);
  const cleared = idx === -1;
  const target = cleared ? MILESTONES[MILESTONES.length - 1] : MILESTONES[idx];
  const floor = cleared
    ? MILESTONES[MILESTONES.length - 2]
    : idx === 0
      ? START
      : MILESTONES[idx - 1];
  const progress = cleared ? 1 : Math.max(0, Math.min(1, (nw - floor) / (target - floor)));

  return (
    <div className={`goal${pulse ? " goal-pulse" : ""}`} aria-label="Goal progress">
      <div className="goal-head">
        <span className="goal-label">
          {cleared ? "🏆 every milestone cleared — now out-grow the AI" : `goal · reach ${formatCredits(target)} cr`}
        </span>
        <span className="goal-now">
          net worth <b>{formatCredits(nw)}</b>
          {rank && (
            <>
              {" "}
              · rank <b>{rank.rank}</b>/{rank.total}
            </>
          )}
        </span>
      </div>
      <div className="goal-track">
        <span className="goal-fill" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}
