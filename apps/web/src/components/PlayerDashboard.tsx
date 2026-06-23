"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerState } from "@orbis/db";
import { formatCredits, type Commodity } from "@/lib/market-view";
import { legendColor } from "@/lib/world-view";
import { bestBid, postOrder, friendly } from "@/lib/orders";
import { emitActivity } from "@/lib/activity";

export function PlayerDashboard() {
  const [me, setMe] = useState<PlayerState | null>(null);
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rank, setRank] = useState<{ rank: number; total: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [renameErr, setRenameErr] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  // Juice: transient feedback for what changed since the last poll.
  const [floaters, setFloaters] = useState<{ id: number; text: string; tone: "pos" | "neg" }[]>([]);
  const [creditFlash, setCreditFlash] = useState<"pos" | "neg" | null>(null);
  const [rankPulse, setRankPulse] = useState(false);
  const prevCreditsRef = useRef<number | null>(null);
  const prevHoldingsRef = useRef<Record<string, number>>({});
  const prevRankRef = useRef<number | null>(null);
  const fidRef = useRef(0);

  const pushFloater = useCallback((text: string, tone: "pos" | "neg") => {
    const fid = ++fidRef.current;
    setFloaters((f) => [...f.slice(-4), { id: fid, text, tone }]);
    setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== fid)), 1300);
  }, []);

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

      // Surface deltas as floaters/flash (skip the first poll so we don't animate the
      // initial state). Credit change → flash + ±delta floater; mined inventory →
      // +N floater. Decreases from selling are already reported by the activity feed.
      const firstPoll = prevCreditsRef.current === null;
      const newCredits = Number(data.credits);
      if (!firstPoll && newCredits !== prevCreditsRef.current) {
        const delta = newCredits - (prevCreditsRef.current ?? newCredits);
        pushFloater(`${delta > 0 ? "+" : "−"}${formatCredits(Math.abs(delta))} cr`, delta > 0 ? "pos" : "neg");
        setCreditFlash(delta > 0 ? "pos" : "neg");
        setTimeout(() => setCreditFlash(null), 650);
      }
      prevCreditsRef.current = newCredits;
      if (!firstPoll) {
        for (const [c, q] of Object.entries(holdings)) {
          const was = prevHoldingsRef.current[c] ?? 0;
          if (q > was) pushFloater(`+${q - was} ${c}`, "pos");
        }
      }
      prevHoldingsRef.current = holdings;

      // Carry the authoritative handle (from the session cookie) so the leaderboard
      // and goal bar can identify "you" reliably — localStorage `orbis_player_id` is
      // only set on an explicit join, not on session rehydrate.
      window.dispatchEvent(
        new CustomEvent("orbis:me", {
          detail: {
            joined: true,
            owned_cells: data.owned_cells,
            credits: Number(data.credits),
            holdings,
            handle: data.handle,
          },
        })
      );
    } catch {
      /* keep last state */
    }
  }, [pushFloater]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    const onPlayer = () => refresh();
    const onRank = (e: Event) => {
      const d = (e as CustomEvent<{ rank: number; total: number }>).detail;
      setRank(d);
      // Climbing the leaderboard (rank number goes down) gets a pulse.
      if (prevRankRef.current !== null && d.rank < prevRankRef.current) {
        setRankPulse(true);
        setTimeout(() => setRankPulse(false), 1300);
      }
      prevRankRef.current = d.rank;
    };
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
    try {
      const res = await fetch("/api/invest", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        emitActivity("ok", `extraction upgraded → level ${data.level}`);
        await refresh();
      } else {
        emitActivity("err", data.error === "insufficient_credits" ? "not enough credits to upgrade" : "upgrade failed");
      }
    } catch {
      emitActivity("err", "network error");
    } finally {
      setBusy(false);
    }
  }

  // One-click sell, self-contained: look up the best bid for this holding's commodity
  // and place a market sell bounded to that bid's depth. No cross-component hop and no
  // switching the market tab / map reveal as a side effect.
  async function sellHolding(commodity: string, qty: number) {
    setBusy(true);
    try {
      const bid = await bestBid(commodity as Commodity);
      if (!bid) {
        emitActivity("err", `no buyers for ${commodity} right now`);
        return;
      }
      const q = Math.max(1, Math.min(qty, bid.qty));
      const r = await postOrder(commodity as Commodity, "sell", bid.price, q);
      if (r.status === 401) {
        emitActivity("err", "session expired — reload to continue");
        return;
      }
      if (!r.ok) {
        emitActivity("err", friendly(r.error ?? "order_failed"));
        return;
      }
      emitActivity("ok", `sold ${r.filled} ${commodity} @ ${formatCredits(bid.price)} cr`);
      await refresh();
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
      <div className="dash-floaters" aria-hidden="true">
        {floaters.map((f) => (
          <span className={`floater ${f.tone}`} key={f.id}>
            {f.text}
          </span>
        ))}
      </div>
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
        <span className={`dash-credits${creditFlash ? ` flash-${creditFlash}` : ""}`}>{formatCredits(me.credits)} <em>cr</em></span>
      </div>
      {renameErr && <div className="dash-rename-err">{renameErr}</div>}
      <div className="dash-stats">
        <span className="dash-stat"><b>{me.owned_cells}</b> cells</span>
        <span className="dash-stat">extraction <b>L{me.level}</b></span>
        {rank && <span className={`dash-stat${rankPulse ? " rank-pulse" : ""}`}>rank <b>{rank.rank}</b> / {rank.total}</span>}
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
            disabled={busy}
            title={`Sell your ${h.commodity} now at the best bid`}
            onClick={() => sellHolding(h.commodity, Number(h.qty))}
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
    </section>
  );
}
