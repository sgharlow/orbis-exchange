"use client";

import { useEffect, useState } from "react";

// The "how to play" rail doubles as a progress tracker: it highlights the step
// you're on and checks off what you've done, driven by the dashboard's /api/me
// poll via the `orbis:me` event (no extra fetch). Default (pre-join) state lights
// step 1 (spec §D + post-playtest refinement).

const STEPS = [
  { n: 1, t: "Enter the market", d: "free · 10,000 credits" },
  { n: 2, t: "Click a cell to claim it", d: "it mines its resource every tick" },
  { n: 3, t: "Sell your goods", d: "beat the AI on net worth" },
];

type State = { joined: boolean; owned: number };

function stepState(n: number, s: State): "done" | "active" | "todo" {
  if (n === 1) return s.joined ? "done" : "active";
  if (n === 2) return !s.joined ? "todo" : s.owned > 0 ? "done" : "active";
  return s.owned > 0 ? "active" : "todo"; // step 3
}

export function ObjectiveRail() {
  const [s, setS] = useState<State>({ joined: false, owned: 0 });

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ joined: boolean; owned_cells: number }>).detail;
      setS({ joined: d.joined, owned: d.owned_cells ?? 0 });
    };
    window.addEventListener("orbis:me", on as EventListener);
    return () => window.removeEventListener("orbis:me", on as EventListener);
  }, []);

  return (
    <ol className="rail" aria-label="How to play">
      {STEPS.map((step, i) => {
        const state = stepState(step.n, s);
        return (
          <li className="rail-step" key={step.n} data-state={state}>
            <span className="rail-num">{state === "done" ? "✓" : step.n}</span>
            <span className="rail-text">
              <span className="rail-t">{step.t}</span>
              <span className="rail-d">{step.d}</span>
            </span>
            {i < STEPS.length - 1 && <span className="rail-arrow" aria-hidden="true">→</span>}
          </li>
        );
      })}
    </ol>
  );
}
