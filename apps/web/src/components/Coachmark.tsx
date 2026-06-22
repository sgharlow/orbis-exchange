"use client";

import { useEffect, useState } from "react";

// First-visit coachmark: a dismissible overlay that states the goal and the three
// steps, then never shows again (localStorage). A small "?" button reopens it on
// demand (spec §D).

const SEEN_KEY = "orbis_seen_intro";

const STEPS = [
  ["You're in — no login", "Opening the link drops you in as a guest with 10,000 credits. Rename yourself to anything unique, anytime."],
  ["Claim cells", "Click any cell in the living world (up to 12). It costs 500 cr, then mines its resource into your inventory every 3-second tick."],
  ["Trade & climb", "Sell what you mine with one click — Buy and Sell at the market price, always a viable trade. AI agents trade the same book; out-earn them on the leaderboard."],
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
