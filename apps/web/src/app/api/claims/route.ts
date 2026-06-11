import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createPool, claimCell, buyListedCell, ensurePlayer } from "@orbis/db";
import { verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

// POST /api/claims { cell_id } — acquire a cell as the signed-in player (spec
// §4.4, §9): claim it if unclaimed, or buy it if another player has listed it for
// sale. The cell then yields its resource to you each tick.
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
    if (result.claimed) return NextResponse.json(result);
    // already owned — if it's listed for sale, buy it instead
    if (result.reason === "taken") {
      const buy = await buyListedCell(pool, claims.playerId, body.cell_id);
      if (buy.bought) return NextResponse.json({ claimed: true, bought: true, price: buy.price });
      return NextResponse.json({ claimed: false, reason: buy.reason === "not_listed" ? "taken" : buy.reason }, { status: 409 });
    }
    return NextResponse.json(result, { status: 409 });
  } finally {
    await pool.end();
  }
}
