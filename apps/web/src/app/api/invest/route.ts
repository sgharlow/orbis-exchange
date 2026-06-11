import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createPool, investExtraction, ensurePlayer } from "@orbis/db";
import { verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

// POST /api/invest — buy one extraction level for the signed-in player
// (spec §4.4, §9). Cost escalates with level; mined yield (and depletion) rises.
export async function POST() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });

  const token = (await cookies()).get("orbis_session")?.value;
  const claims = token ? verifySession(token, secret) : null;
  if (!claims) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const pool = createPool();
  try {
    await ensurePlayer(pool, { id: claims.playerId, handle: claims.handle });
    const result = await investExtraction(pool, claims.playerId);
    if (result.ok) return NextResponse.json(result);
    return NextResponse.json({ error: result.reason }, { status: 400 });
  } finally {
    await pool.end();
  }
}
