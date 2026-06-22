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
  const [rank, setRank] = useState<{ rank: number; total: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [renameErr, setRenameErr] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/me", { cache: "no-store" });
      if (!res.ok) return; // transient server error — keep last state
      // 200 with a null body = anonymous (not joined yet); an object = joined.
      const data = (await res.json()) as PlayerState | null;
      if (!data) {
        setJoined(false);
        setMe(null);
        // tell the rail + market we're anonymous
        window.dispatchEvent(
          new CustomEvent("orbis:me", { detail: { joined: false, owned_cells: 0, credits: 0, holdings: {} } })
        );
        return;
      }
      setJoined(true);
      setMe(data);
      const holdings: Record<string, number> = {};
      for (const h of data.inventory) holdings[h.commodity] = Number(h.qty);
      window.dispatchEvent(
        new CustomEvent("orbis:me", {
          detail: { joined: true, owned_cells: data.owned_cells, credits: Number(data.credits), holdings },
        })
      );
    } catch {
      /* keep last state */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    const onPlayer = () => refresh();
    const onRank = (e: Event) => setRank((e as CustomEvent<{ rank: number; total: number }>).detail);
    window.addEventListener("orbis:player", onPlayer);
    window.addEventListener("orbis:rank", onRank as EventListener);
    return () => {
      clearInterval(id);
      window.removeEventListener("orbis:player", onPlayer);
      window.removeEventListener("orbis:rank", onRank as EventListener);
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

  async function saveName() {
    const name = nameInput.trim();
    if (!name) return;
    setRenaming(true);
    setRenameErr(null);
    try {
      const res = await fetch("/api/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: name }),
      });
      const data = await res.json();
      if (res.ok) {
        setEditing(false);
        window.localStorage.setItem("orbis_handle", data.handle);
        window.dispatchEvent(new CustomEvent("orbis:renamed", { detail: data.handle }));
        await refresh();
      } else {
        setRenameErr(
          data.error === "name_taken"
            ? "that name is taken — try another"
            : data.error === "invalid_handle"
              ? "2–24 chars: letters, numbers, space, - or _"
              : "could not rename"
        );
      }
    } catch {
      setRenameErr("network error");
    } finally {
      setRenaming(false);
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
        {editing ? (
          <span className="dash-rename">
            <input
              autoFocus
              maxLength={24}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") setEditing(false);
              }}
              aria-label="new name"
            />
            <button onClick={saveName} disabled={renaming}>save</button>
            <button onClick={() => setEditing(false)} aria-label="cancel">✕</button>
          </span>
        ) : (
          <button
            className="dash-handle"
            title="Change your name"
            onClick={() => {
              setNameInput(me.handle);
              setRenameErr(null);
              setEditing(true);
            }}
          >
            {me.handle} <span className="dash-edit" aria-hidden="true">✎</span>
          </button>
        )}
        <span className="dash-credits">{formatCredits(me.credits)} <em>cr</em></span>
      </div>
      {renameErr && <div className="dash-rename-err">{renameErr}</div>}
      <div className="dash-stats">
        <span className="dash-stat"><b>{me.owned_cells}</b> cells</span>
        <span className="dash-stat">extraction <b>L{me.level}</b></span>
        {rank && <span className="dash-stat">rank <b>{rank.rank}</b> / {rank.total}</span>}
        <button className="dash-upgrade" disabled={busy} onClick={upgrade}>↑ upgrade</button>
      </div>
      <div className="dash-inv">
        {me.inventory.length === 0 && (
          <span className="dash-none">
            {me.owned_cells > 0
              ? "your cells mine each tick — holdings appear here"
              : "no holdings yet — claim a cell to mine"}
          </span>
        )}
        {me.inventory.map((h) => (
          <button
            className="dash-hold"
            key={h.commodity}
            title={`Sell your ${h.commodity} on the market`}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("orbis:sell", { detail: { commodity: h.commodity, qty: Number(h.qty) } })
              )
            }
          >
            <span className="dash-dot" style={{ background: legendColor(h.commodity) }} />
            {h.qty} {h.commodity}
            <span className="dash-sell">sell →</span>
          </button>
        ))}
      </div>
      {Number(me.credits) < 500 && (
        <div className="dash-recover">
          {me.inventory.length > 0
            ? "low on credits — sell your holdings below to earn more"
            : me.owned_cells > 0
              ? "low on credits — your cells are mining; sell what they produce to recover"
              : "low on credits — claim a cell, then sell what it mines"}
        </div>
      )}
      {msg && <div className="dash-msg">{msg}</div>}
    </section>
  );
}
