import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createPool, listCell } from "@orbis/db";
import { verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

// POST /api/claims/:id/list { price } — list one of your cells for sale (spec §9).
// price omitted/null unlists it. price must be a positive integer.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });

  const token = (await cookies()).get("orbis_session")?.value;
  const claims = token ? verifySession(token, secret) : null;
  if (!claims) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { price?: number | null };
  const price = body.price ?? null;
  if (price !== null && (!Number.isInteger(price) || price <= 0)) {
    return NextResponse.json({ error: "price must be a positive integer or null" }, { status: 400 });
  }

  const pool = createPool();
  try {
    const result = await listCell(pool, claims.playerId, id, price);
    return NextResponse.json(result, { status: result.listed || price === null ? 200 : 403 });
  } finally {
    await pool.end();
  }
}
