import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createPool, getPlayerState, ensurePlayer } from "@orbis/db";
import { verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/me — the signed-in player's dashboard state (spec §10). Auto-provisions
// the player so a freshly-joined session shows its starting balance immediately.
export async function GET() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });

  const token = (await cookies()).get("orbis_session")?.value;
  const claims = token ? verifySession(token, secret) : null;
  // Anonymous visitor: 200 with a null body, not 401. /api/me is polled every
  // few seconds by the dashboard to detect "have I joined yet?"; returning 401
  // is a valid-but-noisy answer that the browser logs as a failed request on
  // every poll. `null` is the honest "you're anonymous" response with no error.
  if (!claims) return NextResponse.json(null);

  const pool = createPool();
  try {
    await ensurePlayer(pool, { id: claims.playerId, handle: claims.handle });
    const state = await getPlayerState(pool, claims.playerId);
    return NextResponse.json(state);
  } finally {
    await pool.end();
  }
}
