import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createPool, placeOrder, ensurePlayer, OrderError, type Side } from "@orbis/db";
import { verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

// POST /api/orders — place a limit order as the signed-in player (spec §9).
export async function POST(request: Request) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });

  const token = (await cookies()).get("orbis_session")?.value;
  const claims = token ? verifySession(token, secret) : null;
  if (!claims) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    commodity?: string;
    side?: string;
    price?: number;
    qty?: number;
  };

  const pool = createPool();
  try {
    await ensurePlayer(pool, { id: claims.playerId, handle: claims.handle });
    const result = await placeOrder(pool, {
      player_id: claims.playerId,
      commodity: String(body.commodity ?? ""),
      side: body.side as Side,
      price: Number(body.price),
      qty: Number(body.qty),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof OrderError) {
      return NextResponse.json({ error: err.code, detail: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "order_failed", detail: (err as Error).message }, { status: 500 });
  } finally {
    await pool.end();
  }
}
