// Money fields (credits, price, qty) are BIGINT in SQL and surface as string in TS.
export interface PlayerRow {
  id: string;
  handle: string;
  kind: "human" | "agent";
  credits: string;
  home_region: string;
  created_at: string;
}

export interface MarketStateRow {
  commodity: string;
  last_price: string;
  best_bid: string | null;
  best_ask: string | null;
  generation: string;
}

export interface LeaderboardEntry {
  id: string;
  handle: string;
  kind: "human" | "agent";
  net_worth: string;
}
