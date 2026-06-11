"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlayerState } from "@orbis/db";
import { formatCredits } from "@/lib/market-view";
import { legendColor } from "@/lib/world-view";

export function PlayerDashboard() {
  const [me, setMe] = useState<PlayerState | null>(null);
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/me", { cache: "no-store" });
      if (res.status === 401) {
        setJoined(false);
        setMe(null);
        return;
      }
      setJoined(true);
      setMe((await res.json()) as PlayerState);
    } catch {
      /* keep last state */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    const onPlayer = () => refresh();
    window.addEventListener("orbis:player", onPlayer);
    return () => {
      clearInterval(id);
      window.removeEventListener("orbis:player", onPlayer);
    };
  }, [refresh]);

  async function upgrade() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/invest", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMsg(`extraction → level ${data.level}`);
        await refresh();
      } else {
        setMsg(data.error === "insufficient_credits" ? "not enough credits to upgrade" : "upgrade failed");
      }
    } catch {
      setMsg("network error");
    } finally {
      setBusy(false);
    }
  }

  if (!joined || !me) {
    return (
      <section className="dash dash-empty" aria-label="Player dashboard">
        join the market to start trading &amp; claiming
      </section>
    );
  }

  return (
    <section className="dash" aria-label="Player dashboard">
      <div className="dash-top">
        <span className="dash-handle">{me.handle}</span>
        <span className="dash-credits">{formatCredits(me.credits)} <em>cr</em></span>
      </div>
      <div className="dash-stats">
        <span className="dash-stat"><b>{me.owned_cells}</b> cells</span>
        <span className="dash-stat">extraction <b>L{me.level}</b></span>
        <button className="dash-upgrade" disabled={busy} onClick={upgrade}>↑ upgrade</button>
      </div>
      <div className="dash-inv">
        {me.inventory.length === 0 && <span className="dash-none">no holdings yet — claim a cell to mine</span>}
        {me.inventory.map((h) => (
          <span className="dash-hold" key={h.commodity}>
            <span className="dash-dot" style={{ background: legendColor(h.commodity) }} />
            {h.qty} {h.commodity}
          </span>
        ))}
      </div>
      {msg && <div className="dash-msg">{msg}</div>}
    </section>
  );
}
