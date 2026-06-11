// Server-Sent Events helpers (spec §5.3). Pure: formatting an SSE frame and
// deciding whether a market snapshot is materially different from the last one
// sent (so the stream only emits on real change, not every poll).

// Encode a named SSE event with a JSON data payload.
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// A compact signature of the parts of a market the client renders. If two
// signatures match, nothing visible changed and the stream can stay quiet.
export function marketSignature(m: {
  last_price: string | null;
  bids: { price: string; qty_open: string }[];
  asks: { price: string; qty_open: string }[];
  recent_trades: { executed_at: string }[];
}): string {
  const side = (levels: { price: string; qty_open: string }[]) =>
    levels.map((l) => `${l.price}:${l.qty_open}`).join(",");
  return [
    m.last_price ?? "-",
    side(m.bids),
    side(m.asks),
    m.recent_trades[0]?.executed_at ?? "-",
  ].join("|");
}
