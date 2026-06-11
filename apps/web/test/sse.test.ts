import { describe, it, expect } from "vitest";
import { sseFrame, marketSignature } from "../src/lib/sse.js";

describe("sseFrame", () => {
  it("formats a named event with a JSON data line and blank terminator", () => {
    expect(sseFrame("tick", { generation: 5 })).toBe('event: tick\ndata: {"generation":5}\n\n');
  });
});

describe("marketSignature", () => {
  const base = {
    last_price: "100",
    bids: [{ price: "98", qty_open: "5" }],
    asks: [{ price: "102", qty_open: "5" }],
    recent_trades: [{ executed_at: "2026-06-11T00:00:00Z" }],
  };

  it("is stable for identical snapshots", () => {
    expect(marketSignature(base)).toBe(marketSignature({ ...base }));
  });

  it("changes when the price, book, or latest trade changes", () => {
    expect(marketSignature(base)).not.toBe(marketSignature({ ...base, last_price: "101" }));
    expect(marketSignature(base)).not.toBe(
      marketSignature({ ...base, bids: [{ price: "97", qty_open: "5" }] })
    );
    expect(marketSignature(base)).not.toBe(
      marketSignature({ ...base, recent_trades: [{ executed_at: "2026-06-11T00:00:05Z" }] })
    );
  });
});
