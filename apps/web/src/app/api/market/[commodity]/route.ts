import { NextResponse } from "next/server";
import { createPool, getMarket } from "@orbis/db";

export const dynamic = "force-dynamic";

// GET /api/market/:commodity — order book depth, last price, recent trades (spec §9).
export async function GET(_request: Request, { params }: { params: Promise<{ commodity: string }> }) {
  const { commodity } = await params;
  const pool = createPool();
  try {
    return NextResponse.json(await getMarket(pool, commodity));
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  } finally {
    await pool.end();
  }
}
