"use client";

import { useEffect, useRef, useState } from "react";
import type { ActivityKind } from "@/lib/activity";

// One consistent place for action feedback. Listens for `orbis:activity` and shows
// the most recent few entries as a stack that auto-expires. Replaces the three
// separate inline message spots (claim line, ticket message, dashboard message).

type Entry = { id: number; kind: ActivityKind; text: string };

const MAX = 4;
const TTL_MS = 4500;

export function ActivityFeed() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ kind: ActivityKind; text: string }>).detail;
      if (!d?.text) return;
      const id = ++idRef.current;
      setEntries((cur) => [{ id, kind: d.kind, text: d.text }, ...cur].slice(0, MAX));
      setTimeout(() => setEntries((cur) => cur.filter((x) => x.id !== id)), TTL_MS);
    };
    window.addEventListener("orbis:activity", on as EventListener);
    return () => window.removeEventListener("orbis:activity", on as EventListener);
  }, []);

  if (entries.length === 0) return null;
  return (
    <div className="activity" role="status" aria-live="polite" aria-label="Activity">
      {entries.map((e) => (
        <div className={`activity-row ${e.kind}`} key={e.id}>
          {e.text}
        </div>
      ))}
    </div>
  );
}
