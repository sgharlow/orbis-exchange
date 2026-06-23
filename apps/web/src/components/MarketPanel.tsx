"use client";

import { useEffect, useRef, useState } from "react";
import type { MarketSnapshot } from "@orbis/db";
import {
  COMMODITIES,
  type Commodity,
  formatCredits,
  cumulativeDepth,
  spread,
  chartGeometry,
} from "@/lib/market-view";
import { legendColor } from "@/lib/world-view";

const POLL_MS = 2500;
const DEPTH_LEVELS = 5; // best N price levels rendered per side (compact: keeps the trade ticket above the fold)

function guestHandle(): string {
  // A login-free per-browser identity. Math.random is fine here (display name only).
  // 6 base-36 chars keeps collisions negligible; the player can rename anytime.
  return "guest-" + Math.random().toString(36).slice(2, 8);
}

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
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pendingSell, setPendingSell] = useState<{ commodity: Commodity; qty: number } | null>(null);
  // Wallet snapshot from the dashboard's /api/me poll — used to bound trades so we
  // only ever surface viable orders (no wrong-price rests, no can't-afford fails).
  const [wallet, setWallet] = useState<{ credits: number; holdings: Record<string, number> }>({
    credits: 0,
    holdings: {},
  });
  const ticketRef = useRef<HTMLDivElement>(null);

  // Sessions are login-free. The signed cookie (checked via /api/me) is the source
  // of truth — NOT localStorage — so a dead/expired cookie can never leave the UI
  // showing "joined" while every action 401s (the "locked" bug). If there's a valid
  // session we rehydrate it; otherwise we clear stale local state and auto-issue a
  // fresh guest so the player can always act.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/me", { cache: "no-store" });
        const me = r.ok ? ((await r.json()) as { handle: string } | null) : null;
        if (me && !cancelled) {
          setHandle(me.handle);
          window.localStorage.setItem("orbis_handle", me.handle);
          const pid = window.localStorage.getItem("orbis_player_id");
          if (pid) window.dispatchEvent(new CustomEvent("orbis:player", { detail: pid }));
          return;
        }
      } catch {
        /* fall through to a fresh session */
      }
      if (cancelled) return;
      window.localStorage.removeItem("orbis_handle");
      window.localStorage.removeItem("orbis_player_id");
      void join(guestHandle());
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reveal-layer sync: when the world board reveals a commodity (or a tab is picked
  // elsewhere), switch this panel to that commodity in lock-step.
  useEffect(() => {
    const onReveal = (e: Event) => {
      const detail = (e as CustomEvent<string | null>).detail ?? null;
      if (detail && (COMMODITIES as readonly string[]).includes(detail)) {
        setCommodity(detail as Commodity);
      }
    };
    window.addEventListener("orbis:reveal", onReveal as EventListener);
    return () => window.removeEventListener("orbis:reveal", onReveal as EventListener);
  }, []);

  // Keep the "trading as" label in step when the player renames in the dashboard.
  useEffect(() => {
    const onRenamed = (e: Event) => setHandle((e as CustomEvent<string>).detail);
    window.addEventListener("orbis:renamed", onRenamed as EventListener);
    return () => window.removeEventListener("orbis:renamed", onRenamed as EventListener);
  }, []);

  // Track wallet (credits + holdings) from the dashboard so the trade buttons can
  // bound quantity to what's actually executable.
  useEffect(() => {
    const onMe = (e: Event) => {
      const d = (e as CustomEvent<{ credits: number; holdings: Record<string, number> }>).detail;
      if (d) setWallet({ credits: d.credits ?? 0, holdings: d.holdings ?? {} });
    };
    window.addEventListener("orbis:me", onMe as EventListener);
    return () => window.removeEventListener("orbis:me", onMe as EventListener);
  }, []);

  function chooseCommodity(c: Commodity) {
    setCommodity(c);
    // Drive the world board's reveal layer to match (single source of truth is the
    // `orbis:reveal` event, consumed by WorldView).
    window.dispatchEvent(new CustomEvent("orbis:reveal", { detail: c }));
  }

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

  async function join(nameArg?: string) {
    const name = (nameArg ?? joinName).trim();
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
        setMsg({ kind: "ok", text: `playing as ${d.handle} · 10,000 credits` });
      } else {
        setMsg({ kind: "err", text: "could not start a session" });
      }
    } finally {
      setBusy(false);
    }
  }

  // Sell-from-holdings: clicking a holding in the dashboard switches to that
  // commodity and (once its book loads) pre-fills a crossing sell, then scrolls
  // the ticket into view — so selling is one obvious place, not a hunt.
  useEffect(() => {
    const onSell = (e: Event) => {
      const d = (e as CustomEvent<{ commodity: string; qty: number }>).detail;
      if (!d || !(COMMODITIES as readonly string[]).includes(d.commodity)) return;
      setCommodity(d.commodity as Commodity);
      window.dispatchEvent(new CustomEvent("orbis:reveal", { detail: d.commodity }));
      setPendingSell({ commodity: d.commodity as Commodity, qty: d.qty });
    };
    window.addEventListener("orbis:sell", onSell as EventListener);
    return () => window.removeEventListener("orbis:sell", onSell as EventListener);
  }, []);

  useEffect(() => {
    // One-click sell: once the holding's commodity book is loaded, execute the sell
    // immediately at the best bid (bounded to its depth so it fills fully). No second
    // click and no scroll to the ticket — the top "sell" button in the dashboard is
    // the whole interaction.
    if (!pendingSell || market.commodity !== pendingSell.commodity) return;
    const ps = pendingSell;
    setPendingSell(null);
    const bid = market.bids[0];
    if (!bid) {
      setMsg({ kind: "err", text: `no buyers for ${ps.commodity} right now` });
      return;
    }
    const px = Number(bid.price);
    const q = Math.max(1, Math.min(ps.qty, Number(bid.qty_open) || ps.qty));
    void placeOrder("sell", q, px);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSell, market]);

  // The single order path. BUY crosses the best ask, SELL crosses the best bid; the
  // caller passes an already-bounded quantity so the order always fills fully — never
  // rests, never fails. This is "only surface viable trades".
  async function placeOrder(side: "buy" | "sell", q: number, px: number) {
    if (q < 1 || px <= 0) return;
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commodity, side, price: px, qty: q }),
      });
      if (res.status === 401) {
        setHandle(null);
        window.localStorage.removeItem("orbis_handle");
        setMsg({ kind: "err", text: "session expired — reload to continue" });
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
        text: `${side === "buy" ? "bought" : "sold"} ${filled} ${commodity} @ ${formatCredits(px)} cr`,
      });
      await refresh();
      // Nudge the dashboard (credits + holdings) to update at once, so the result of a
      // top-of-UI one-click sell is visible immediately rather than on the next poll.
      const pid = window.localStorage.getItem("orbis_player_id");
      if (pid) window.dispatchEvent(new CustomEvent("orbis:player", { detail: pid }));
    } catch {
      setMsg({ kind: "err", text: "network error" });
    } finally {
      setBusy(false);
    }
  }

  // The ticket's Buy/Sell buttons read the quantity field, clamp it to what's
  // executable (best-level depth, credits, holdings), then place the order.
  async function trade(side: "buy" | "sell", maxQty: number, px: number) {
    let q = Math.floor(Number(qty));
    if (!Number.isFinite(q) || q < 1) q = 1;
    q = Math.min(q, maxQty);
    await placeOrder(side, q, px);
  }

  const asks = cumulativeDepth(market.asks);
  const bids = cumulativeDepth(market.bids);
  const sp = spread(market.bids[0]?.price, market.asks[0]?.price);
  const tradePrices = [...market.recent_trades].reverse().map((t) => Number(t.price));
  const chart = chartGeometry(tradePrices, 220, 84);

  // Viability of the player's next market order.
  const bestAsk = market.asks[0];
  const bestBid = market.bids[0];
  const askPrice = bestAsk ? Number(bestAsk.price) : 0;
  const bidPrice = bestBid ? Number(bestBid.price) : 0;
  const holding = wallet.holdings[commodity] ?? 0;
  const maxBuy = askPrice > 0 ? Math.min(Number(bestAsk!.qty_open), Math.floor(wallet.credits / askPrice)) : 0;
  const maxSell = bidPrice > 0 ? Math.min(Number(bestBid!.qty_open), holding) : 0;
  const buyLabel = maxBuy >= 1 ? `Buy ${commodity}` : bestAsk ? "need credits" : "no offers";
  const sellLabel = maxSell >= 1 ? `Sell ${commodity}` : holding < 1 ? `no ${commodity}` : "no buyers";

  return (
    <section className="market" aria-label="Market panel">
      <div className="commodity-tabs">
        {COMMODITIES.map((c) => (
          <button
            key={c}
            className="commodity-tab"
            data-active={c === commodity}
            style={{ ["--hue" as string]: legendColor(c) }}
            onClick={() => chooseCommodity(c)}
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
        <div className="chart-wrap">
          <svg className="chart" viewBox="0 0 220 84" width="220" height="84" aria-hidden="true">
            <defs>
              <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#38e0f5" stopOpacity="0.28" />
                <stop offset="1" stopColor="#38e0f5" stopOpacity="0" />
              </linearGradient>
            </defs>
            {chart && (
              <>
                <path d={chart.area} fill="url(#chartFill)" />
                <path d={chart.line} fill="none" stroke="#38e0f5" strokeWidth="1.5" />
                <circle cx={chart.lastX} cy={chart.lastY} r="2.5" fill="#38e0f5" />
              </>
            )}
          </svg>
          {chart && (
            <div className="chart-scale" aria-hidden="true">
              <span>{formatCredits(chart.max)}</span>
              <span>{formatCredits(chart.min)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="book">
        <div className="book-side asks">
          {(() => {
            const askMax = asks.rows[Math.min(DEPTH_LEVELS, asks.rows.length) - 1]?.cum ?? 1;
            return [...asks.rows.slice(0, DEPTH_LEVELS)].reverse().map((r, i) => (
              <div className="book-row" key={`a${i}`}>
                <span className="depth depth-ask" style={{ width: `${(r.cum / (askMax || 1)) * 100}%` }} />
                <span className="book-price ask">{formatCredits(r.price)}</span>
                <span className="book-qty">{r.qty}</span>
              </div>
            ));
          })()}
          {asks.rows.length === 0 && <div className="book-empty">no asks</div>}
        </div>
        <div className="book-spread">
          <span>spread</span>
          <span className="book-spread-val">{sp === null ? "—" : formatCredits(sp)}</span>
        </div>
        <div className="book-side bids">
          {(() => {
            const bidMax = bids.rows[Math.min(DEPTH_LEVELS, bids.rows.length) - 1]?.cum ?? 1;
            return bids.rows.slice(0, DEPTH_LEVELS).map((r, i) => (
              <div className="book-row" key={`b${i}`}>
                <span className="depth depth-bid" style={{ width: `${(r.cum / (bidMax || 1)) * 100}%` }} />
                <span className="book-price bid">{formatCredits(r.price)}</span>
                <span className="book-qty">{r.qty}</span>
              </div>
            ));
          })()}
          {bids.rows.length === 0 && <div className="book-empty">no bids</div>}
        </div>
      </div>

      <div className="ticket" ref={ticketRef}>
        {handle ? (
          <>
            <div className="trade-row">
              <label className="field qty-field">
                <span>quantity</span>
                <input
                  inputMode="numeric"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  aria-label="quantity"
                />
              </label>
              <div className="trade-quote">
                <span>buy @ <b>{bestAsk ? formatCredits(bestAsk.price) : "—"}</b></span>
                <span>sell @ <b>{bestBid ? formatCredits(bestBid.price) : "—"}</b></span>
              </div>
            </div>
            <div className="ticket-actions">
              <button
                className="btn btn-buy"
                disabled={busy || maxBuy < 1}
                title={maxBuy >= 1 ? `Buy up to ${maxBuy} at ${askPrice}` : buyLabel}
                onClick={() => trade("buy", maxBuy, askPrice)}
              >
                {buyLabel}
              </button>
              <button
                className="btn btn-sell"
                disabled={busy || maxSell < 1}
                title={maxSell >= 1 ? `Sell up to ${maxSell} at ${bidPrice}` : sellLabel}
                onClick={() => trade("sell", maxSell, bidPrice)}
              >
                {sellLabel}
              </button>
            </div>
            <div className="ticket-who">
              buy up to <b>{maxBuy}</b> · sell up to <b>{maxSell}</b> · you’re {handle}
            </div>
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
            <button className="btn btn-join" disabled={busy} onClick={() => join()}>
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
