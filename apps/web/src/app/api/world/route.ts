import { NextResponse } from "next/server";
import { createPool, getWorld, getLatestGeneration } from "@orbis/db";

export const dynamic = "force-dynamic";

// GET /api/world?region=r0 — world snapshot for rendering (spec §9).
export async function GET(request: Request) {
  const region = new URL(request.url).searchParams.get("region") ?? "r0";
  const pool = createPool();
  try {
    const [cells, generation] = await Promise.all([
      getWorld(pool, region),
      getLatestGeneration(pool),
    ]);
    return NextResponse.json({ region, generation, cells });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  } finally {
    await pool.end();
  }
}
