// Money fields (credits, price, qty) are BIGINT in SQL and surface as string in TS.
// 'market' = infrastructure liquidity bots (makers + pulse), excluded from the
// leaderboard; 'agent' = the strategic opponents shown on it; 'human' = real players.
export type PlayerKind = "human" | "agent" | "market";

export interface PlayerRow {
  id: string;
  handle: string;
  kind: PlayerKind;
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
  kind: PlayerKind;
  net_worth: string;
}
