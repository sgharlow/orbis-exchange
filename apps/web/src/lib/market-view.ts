// Pure helpers for the market panel: number formatting, cumulative order-book
// depth (for the depth bars), bid/ask spread, and the price sparkline path.
// Unit-tested; the React panel is a thin shell over these.

export const COMMODITIES = ["ore", "energy", "biomass", "rare"] as const;
export type Commodity = (typeof COMMODITIES)[number];

// Group a (possibly very large) integer credit value with thousands separators.
export function formatCredits(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const raw = typeof value === "string" ? value : String(Math.trunc(value));
  const neg = raw.startsWith("-");
  const digits = (neg ? raw.slice(1) : raw).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + digits;
}

export interface DepthLevel {
  price: string;
  qty_open: string;
}
export interface CumulativeLevel {
  price: string;
  qty: number;
  cum: number;
}

// Cumulative quantity per level (input already sorted best-first), plus the max
// cumulative total so callers can scale depth bars to [0, 1].
export function cumulativeDepth(levels: DepthLevel[]): { rows: CumulativeLevel[]; max: number } {
  let cum = 0;
  const rows = levels.map((l) => {
    const qty = Number(l.qty_open);
    cum += qty;
    return { price: l.price, qty, cum };
  });
  return { rows, max: cum || 1 };
}

export function spread(bestBid?: string, bestAsk?: string): number | null {
  if (bestBid == null || bestAsk == null) return null;
  return Number(bestAsk) - Number(bestBid);
}

// SVG path string for a price sparkline (prices in chronological order).
export function sparklinePath(prices: number[], width: number, height: number, pad = 2): string {
  if (prices.length === 0) return "";
  if (prices.length === 1) {
    const y = height / 2;
    return `M ${pad} ${y} L ${width - pad} ${y}`;
  }
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const step = innerW / (prices.length - 1);
  return prices
    .map((p, i) => {
      const x = pad + i * step;
      const y = pad + innerH - ((p - min) / range) * innerH;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}
