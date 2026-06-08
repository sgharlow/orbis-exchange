import { NextResponse } from "next/server";
import { createPool, getLeaderboard } from "@orbis/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const pool = createPool();
  try {
    const board = await getLeaderboard(pool);
    return NextResponse.json({ leaderboard: board });
  } finally {
    await pool.end();
  }
}
