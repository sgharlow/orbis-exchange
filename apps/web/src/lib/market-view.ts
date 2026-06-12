// Pure helpers for the market panel: number formatting, cumulative order-book
// depth (for the depth bars), bid/ask spread, and the price chart geometry.
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

export interface ChartGeometry {
  line: string; // SVG path of the price line (chronological)
  area: string; // the line closed down to the baseline, for the gradient fill
  min: number;
  max: number;
  lastX: number; // last trade's point, for the marker dot
  lastY: number;
}

// Geometry for the price chart. Prices are chronological. Null when empty; a
// single trade renders as a centered flat point so the chart never looks broken.
export function chartGeometry(
  prices: number[],
  width: number,
  height: number,
  pad = 4
): ChartGeometry | null {
  if (prices.length === 0) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const single = prices.length === 1;
  const step = single ? 0 : innerW / (prices.length - 1);
  const pts = prices.map((p, i) => {
    const x = pad + (single ? innerW / 2 : i * step);
    const y = pad + innerH - ((p - min) / range) * innerH;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const base = (height - pad).toFixed(1);
  const area = `${line} L ${pts[pts.length - 1][0].toFixed(1)} ${base} L ${pts[0][0].toFixed(1)} ${base} Z`;
  const [lastX, lastY] = pts[pts.length - 1];
  return { line, area, min, max, lastX, lastY };
}
