import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { signSession } from "@/lib/session";

export async function POST(req: Request) {
  const { handle } = (await req.json()) as { handle?: string };
  if (!handle || handle.length > 32) {
    return NextResponse.json({ error: "invalid handle" }, { status: 400 });
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }
  const playerId = randomUUID();
  const token = signSession({ playerId, handle }, secret);
  const res = NextResponse.json({ playerId, handle });
  res.cookies.set("orbis_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days — persist across browser restarts (not a per-tab session cookie)
  });
  return res;
}
