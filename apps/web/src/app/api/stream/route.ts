import {
  createPool,
  getLatestGeneration,
  getWorldSince,
  getMarket,
} from "@orbis/db";
import { sseFrame, marketSignature } from "@/lib/sse";

export const dynamic = "force-dynamic";

const STREAM_MS = 1500;

// GET /api/stream?region=r0&commodity=ore — Server-Sent Events (spec §5.3).
// Server-side polls DSQL and pushes only changes: `world` (cell deltas since the
// last generation), `tick` (new generation), and `market` (book/price/trades).
// Vercel can't hold sockets, so this is a short-lived stream the client reopens;
// the components also keep a slow poll as a fallback when SSE drops.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const region = url.searchParams.get("region");
  const commodity = url.searchParams.get("commodity");

  const encoder = new TextEncoder();
  const pool = createPool();

  let lastGen = await getLatestGeneration(pool);
  let lastMarketSig = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(sseFrame(event, data)));

      send("hello", { region, commodity, generation: lastGen });

      const tickOnce = async () => {
        if (region) {
          const gen = await getLatestGeneration(pool);
          if (gen > lastGen) {
            const cells = await getWorldSince(pool, region, lastGen);
            send("world", { generation: gen, cells });
            send("tick", { generation: gen });
            lastGen = gen;
          }
        }
        if (commodity) {
          const market = await getMarket(pool, commodity);
          const sig = marketSignature(market);
          if (sig !== lastMarketSig) {
            send("market", market);
            lastMarketSig = sig;
          }
        }
      };

      const interval = setInterval(() => {
        tickOnce().catch(() => {
          /* transient read error — try again next interval */
        });
      }, STREAM_MS);

      // Tear down when the client disconnects.
      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        pool.end().catch(() => {});
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
