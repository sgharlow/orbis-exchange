import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createPool, ensurePlayer } from "@orbis/db";
import { verifySession, signSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// POST /api/rename — change the current session's display name. Names are unique
// (case-insensitive); enforced atomically by a guarded UPDATE so two simultaneous
// renames can't both take the same name. Same player id, so no progress is lost.
export async function POST(req: Request) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });

  const token = (await cookies()).get("orbis_session")?.value;
  const claims = token ? verifySession(token, secret) : null;
  if (!claims) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { handle?: string };
  const handle = (body.handle ?? "").trim();
  // 2–24 chars, starts alphanumeric, then letters/numbers/space/underscore/hyphen.
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{1,23}$/.test(handle)) {
    return NextResponse.json({ error: "invalid_handle" }, { status: 400 });
  }

  const pool = createPool();
  try {
    await ensurePlayer(pool, { id: claims.playerId, handle: claims.handle });
    // Atomic: take the name only if no *other* player holds it (case-insensitive).
    const upd = await pool.query(
      `UPDATE players SET handle = $2
         WHERE id = $1
           AND NOT EXISTS (
             SELECT 1 FROM players WHERE lower(handle) = lower($2) AND id <> $1
           )`,
      [claims.playerId, handle]
    );
    if (upd.rowCount === 0) {
      return NextResponse.json({ error: "name_taken" }, { status: 409 });
    }
    const newToken = signSession({ playerId: claims.playerId, handle }, secret);
    const res = NextResponse.json({ handle });
    res.cookies.set("orbis_session", newToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days — keep the persistent session alive on rename
    });
    return res;
  } finally {
    await pool.end();
  }
}
