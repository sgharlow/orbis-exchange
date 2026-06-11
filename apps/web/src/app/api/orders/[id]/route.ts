import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createPool, cancelOrder } from "@orbis/db";
import { verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

// DELETE /api/orders/:id — cancel one of your own open orders (spec §9).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });

  const token = (await cookies()).get("orbis_session")?.value;
  const claims = token ? verifySession(token, secret) : null;
  if (!claims) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const { id } = await params;
  const pool = createPool();
  try {
    const owner = (
      await pool.query<{ player_id: string }>("SELECT player_id FROM orders WHERE id = $1", [id])
    ).rows[0];
    if (!owner) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (owner.player_id !== claims.playerId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json(await cancelOrder(pool, id));
  } finally {
    await pool.end();
  }
}
