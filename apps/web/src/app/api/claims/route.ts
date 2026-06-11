import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createPool, claimCell, ensurePlayer } from "@orbis/db";
import { verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

// POST /api/claims { cell_id } — claim an unclaimed cell as the signed-in
// player (spec §4.4, §9). The cell then yields its resource to you each tick.
export async function POST(request: Request) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });

  const token = (await cookies()).get("orbis_session")?.value;
  const claims = token ? verifySession(token, secret) : null;
  if (!claims) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { cell_id?: number | string };
  if (body.cell_id === undefined || body.cell_id === null) {
    return NextResponse.json({ error: "cell_id is required" }, { status: 400 });
  }

  const pool = createPool();
  try {
    await ensurePlayer(pool, { id: claims.playerId, handle: claims.handle });
    const result = await claimCell(pool, claims.playerId, body.cell_id);
    return NextResponse.json(result, { status: result.claimed ? 200 : 409 });
  } finally {
    await pool.end();
  }
}
