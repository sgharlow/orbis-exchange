import { NextResponse } from "next/server";
import { createPool, getWorld, getWorldSince, getLatestGeneration } from "@orbis/db";

export const dynamic = "force-dynamic";

// Snapshots are CDN-cacheable for one tick (spec §12 read scaling): the world
// only changes every 3 seconds, so a 2s edge TTL keeps reads off the write path.
const CACHE = { "Cache-Control": "public, s-maxage=2, stale-while-revalidate=4" };

// GET /api/world?region=r0[&since=GEN] — full world snapshot, or only the cells
// changed strictly after generation GEN (spec §9).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const region = url.searchParams.get("region") ?? "r0";
  const sinceRaw = url.searchParams.get("since");
  const pool = createPool();
  try {
    const generation = await getLatestGeneration(pool);
    if (sinceRaw !== null) {
      const since = Number(sinceRaw);
      if (!Number.isInteger(since) || since < 0) {
        return NextResponse.json(
          { ok: false, error: "since must be a non-negative integer" },
          { status: 400 }
        );
      }
      const cells = await getWorldSince(pool, region, since);
      return NextResponse.json({ region, generation, since, cells }, { headers: CACHE });
    }
    const cells = await getWorld(pool, region);
    return NextResponse.json({ region, generation, cells }, { headers: CACHE });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  } finally {
    await pool.end();
  }
}
