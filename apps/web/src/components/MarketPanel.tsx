"use client";

import { useEffect, useState } from "react";
import type { MarketSnapshot } from "@orbis/db";
import {
  COMMODITIES,
  type Commodity,
  formatCredits,
  cumulativeDepth,
  spread,
  sparklinePath,
} from "@/lib/market-view";
import { legendColor } from "@/lib/world-view";

const POLL_MS = 2500;

function friendly(code: string): string {
  switch (code) {
    case "insufficient_credits":
      return "not enough credits";
    case "insufficient_inventory":
      return "not enough inventory";
    case "invalid_input":
      return "invalid order";
    case "not_authenticated":
      return "re-enter the market";
    default:
      return code.replace(/_/g, " ");
  }
}

export function MarketPanel({
  initialCommodity,
  initialMarket,
}: {
  initialCommodity: Commodity;
  initialMarket: MarketSnapshot;
}) {
  const [commodity, setCommodity] = useState<Commodity>(initialCommodity);
  const [market, setMarket] = useState<MarketSnapshot>(initialMarket);
  const [handle, setHandle] = useState<string | null>(null);
  const [joinName, setJoinName] = useState("");
  const [price, setPrice] = useState(initialMarket.last_price ?? "100");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const h = window.localStorage.getItem("orbis_handle");
    if (h) setHandle(h);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/market/${commodity}`, { cache: "no-store" });
        if (r.ok) {
          const d = (await r.json()) as MarketSnapshot;
          if (!cancelled) setMarket(d);
        }
      } catch {
        /* keep last snapshot on a transient error */
      }
    };
    load();
    const id = setInterval(load, POLL_MS);

    // Realtime market updates (spec §5.3); the poll above is the fallback.
    const es = new EventSource(`/api/stream?commodity=${encodeURIComponent(commodity)}`);
    es.addEventListener("market", (ev) => {
      try {
        if (!cancelled) setMarket(JSON.parse((ev as MessageEvent).data) as MarketSnapshot);
      } catch {
        /* ignore a malformed frame */
      }
    });

    return () => {
      cancelled = true;
      clearInterval(id);
      es.close();
    };
  }, [commodity]);

  const refresh = async () => {
    const r = await fetch(`/api/market/${commodity}`, { cache: "no-store" });
    if (r.ok) setMarket((await r.json()) as MarketSnapshot);
  };

  async function join() {
    const name = joinName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: name }),
      });
      if (res.ok) {
        const d = (await res.json()) as { handle: string; playerId: string };
        setHandle(d.handle);
        window.localStorage.setItem("orbis_handle", d.handle);
        window.localStorage.setItem("orbis_player_id", d.playerId);
        // let the world view learn our id so our claimed cells outline brightly
        window.dispatchEvent(new CustomEvent("orbis:player", { detail: d.playerId }));
        setMsg({ kind: "ok", text: `joined as ${d.handle} · 10,000 credits` });
      } else {
        setMsg({ kind: "err", text: "could not join" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function place(side: "buy" | "sell") {
    setMsg(null);
    const p = Number(price);
    const q = Number(qty);
    if (!Number.isInteger(p) || p <= 0 || !Number.isInteger(q) || q <= 0) {
      setMsg({ kind: "err", text: "enter a positive whole price and quantity" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commodity, side, price: p, qty: q }),
      });
      if (res.status === 401) {
        setHandle(null);
        window.localStorage.removeItem("orbis_handle");
        setMsg({ kind: "err", text: "session expired — re-enter the market" });
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: friendly(data.error ?? "order_failed") });
        return;
      }
      const filled = (data.fills ?? []).reduce((s: number, f: { qty: string }) => s + Number(f.qty), 0);
      setMsg({
        kind: "ok",
        text: filled > 0 ? `${side} filled ${filled} — order ${data.status}` : `${side} order resting`,
      });
      await refresh();
    } catch {
      setMsg({ kind: "err", text: "network error" });
    } finally {
      setBusy(false);
    }
  }

  const asks = cumulativeDepth(market.asks);
  const bids = cumulativeDepth(market.bids);
  const sp = spread(market.bids[0]?.price, market.asks[0]?.price);
  const tradePrices = [...market.recent_trades].reverse().map((t) => Number(t.price));
  const spark = sparklinePath(tradePrices, 220, 38);

  return (
    <section className="market" aria-label="Market panel">
      <div className="commodity-tabs">
        {COMMODITIES.map((c) => (
          <button
            key={c}
            className="commodity-tab"
            data-active={c === commodity}
            style={{ ["--hue" as string]: legendColor(c) }}
            onClick={() => setCommodity(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="price-row">
        <div className="price-block">
          <span className="price-last">{formatCredits(market.last_price)}</span>
          <span className="price-unit">cr · last</span>
        </div>
        <svg className="spark" viewBox="0 0 220 38" width="220" height="38" aria-hidden="true">
          {spark && <path d={spark} fill="none" stroke="url(#sparkGrad)" strokeWidth="1.5" />}
          <defs>
            <linearGradient id="sparkGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#38e0f5" stopOpacity="0.2" />
              <stop offset="1" stopColor="#38e0f5" stopOpacity="1" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      <div className="book">
        <div className="book-side asks">
          {[...asks.rows].reverse().map((r, i) => (
            <div className="book-row" key={`a${i}`}>
              <span className="depth depth-ask" style={{ width: `${(r.cum / asks.max) * 100}%` }} />
              <span className="book-price ask">{formatCredits(r.price)}</span>
              <span className="book-qty">{r.qty}</span>
            </div>
          ))}
          {asks.rows.length === 0 && <div className="book-empty">no asks</div>}
        </div>
        <div className="book-spread">
          <span>spread</span>
          <span className="book-spread-val">{sp === null ? "—" : formatCredits(sp)}</span>
        </div>
        <div className="book-side bids">
          {bids.rows.map((r, i) => (
            <div className="book-row" key={`b${i}`}>
              <span className="depth depth-bid" style={{ width: `${(r.cum / bids.max) * 100}%` }} />
              <span className="book-price bid">{formatCredits(r.price)}</span>
              <span className="book-qty">{r.qty}</span>
            </div>
          ))}
          {bids.rows.length === 0 && <div className="book-empty">no bids</div>}
        </div>
      </div>

      <div className="ticket">
        {handle ? (
          <>
            <div className="ticket-inputs">
              <label className="field">
                <span>price</span>
                <input
                  inputMode="numeric"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  aria-label="price"
                />
              </label>
              <label className="field">
                <span>qty</span>
                <input
                  inputMode="numeric"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  aria-label="quantity"
                />
              </label>
            </div>
            <div className="ticket-actions">
              <button className="btn btn-buy" disabled={busy} onClick={() => place("buy")}>
                Buy
              </button>
              <button className="btn btn-sell" disabled={busy} onClick={() => place("sell")}>
                Sell
              </button>
            </div>
            <div className="ticket-who">trading as {handle}</div>
          </>
        ) : (
          <div className="join">
            <input
              placeholder="choose a handle"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && join()}
              aria-label="handle"
            />
            <button className="btn btn-join" disabled={busy} onClick={join}>
              Enter the market
            </button>
          </div>
        )}
        {msg && <div className={`ticket-msg ${msg.kind}`}>{msg.text}</div>}
      </div>

      <ul className="tape" aria-label="Recent trades">
        {market.recent_trades.slice(0, 8).map((t, i) => (
          <li className="tape-row" key={`${t.executed_at}-${i}`}>
            <span className="tape-qty">{t.qty}</span>
            <span className="tape-at">@</span>
            <span className="tape-price">{formatCredits(t.price)}</span>
          </li>
        ))}
        {market.recent_trades.length === 0 && <li className="book-empty">no trades yet</li>}
      </ul>
    </section>
  );
}
