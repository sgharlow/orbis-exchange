import { NextResponse } from "next/server";
import { createPool, appliedVersions } from "@orbis/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const pool = createPool();
  try {
    const versions = await appliedVersions(pool);
    return NextResponse.json({ ok: true, migrations: versions });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 503 }
    );
  } finally {
    await pool.end();
  }
}
