"use client";

import { useEffect, useState } from "react";

// First-visit coachmark: a dismissible overlay that states the goal and the three
// steps, then never shows again (localStorage). A small "?" button reopens it on
// demand (spec §D).

const SEEN_KEY = "orbis_seen_intro";

const STEPS = [
  ["Enter the market", "Pick a handle — it's free and you start with 10,000 credits."],
  ["Claim cells", "Click any cell in the living world. It costs 500 cr and then mines its resource every 3-second tick."],
  ["Trade & climb", "Sell what you mine on the global order book. AI agents trade the same book — out-earn them on the net-worth leaderboard."],
];

export function Coachmark() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem(SEEN_KEY) !== "1") setOpen(true);
  }, []);

  function dismiss() {
    window.localStorage.setItem(SEEN_KEY, "1");
    setOpen(false);
  }

  return (
    <>
      <button className="coach-help" aria-label="How to play" onClick={() => setOpen(true)}>
        ?
      </button>
      {open && (
        <div className="coach-scrim" role="dialog" aria-modal="true" aria-label="How to play" onClick={dismiss}>
          <div className="coach-card" onClick={(e) => e.stopPropagation()}>
            <p className="coach-eyebrow">How to play</p>
            <h2 className="coach-title">Out-trade the machine.</h2>
            <p className="coach-lede">
              One living world, one global market — you and the AI agents trade on the exact same
              strongly-consistent ledger.
            </p>
            <ol className="coach-steps">
              {STEPS.map(([t, d], i) => (
                <li key={i}>
                  <span className="coach-num">{i + 1}</span>
                  <span>
                    <b>{t}</b>
                    <span className="coach-d">{d}</span>
                  </span>
                </li>
              ))}
            </ol>
            <button className="coach-go" onClick={dismiss}>
              Got it — let me play
            </button>
          </div>
        </div>
      )}
    </>
  );
}
