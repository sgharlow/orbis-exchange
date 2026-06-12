import { NextResponse } from "next/server";
import { createPool, getLeaderboard } from "@orbis/db";

export const dynamic = "force-dynamic";

// GET /api/leaderboard — net-worth ranking across humans and agents (spec §9).
export async function GET() {
  const pool = createPool();
  try {
    const board = await getLeaderboard(pool);
    return NextResponse.json(
      { leaderboard: board },
      { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" } }
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  } finally {
    await pool.end();
  }
}
