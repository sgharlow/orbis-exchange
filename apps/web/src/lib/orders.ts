// Shared order helpers so the market ticket and the dashboard's one-click sell use
// ONE order path (no duplicated fetch logic, no cross-component event hop). The
// matching/settlement engine behind /api/orders is unchanged.

import type { Commodity } from "@/lib/market-view";

export function friendly(code: string): string {
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

export interface OrderResult {
  ok: boolean;
  status: number;
  filled: number;
  error?: string;
}

// Place one order. `price` is the crossing price for a market trade, or the chosen
// price for a limit order. The caller is responsible for surfacing the result.
export async function postOrder(
  commodity: Commodity,
  side: "buy" | "sell",
  price: number,
  qty: number
): Promise<OrderResult> {
  if (qty < 1 || price <= 0) return { ok: false, status: 0, filled: 0, error: "invalid_input" };
  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commodity, side, price, qty }),
    });
    let data: { fills?: { qty: string }[]; error?: string } = {};
    try {
      data = await res.json();
    } catch {
      /* empty body */
    }
    if (!res.ok) return { ok: false, status: res.status, filled: 0, error: data.error ?? "order_failed" };
    const filled = (data.fills ?? []).reduce((s, f) => s + Number(f.qty), 0);
    return { ok: true, status: res.status, filled };
  } catch {
    return { ok: false, status: 0, filled: 0, error: "network error" };
  }
}

// Best bid (price + open depth) for a commodity — used by the one-click sell to
// know what a market sell would fill at, without changing any visible panel state.
export async function bestBid(commodity: Commodity): Promise<{ price: number; qty: number } | null> {
  try {
    const r = await fetch(`/api/market/${commodity}`, { cache: "no-store" });
    if (!r.ok) return null;
    const m = (await r.json()) as { bids?: { price: string; qty_open: string }[] };
    const b = m.bids?.[0];
    return b ? { price: Number(b.price), qty: Number(b.qty_open) } : null;
  } catch {
    return null;
  }
}
