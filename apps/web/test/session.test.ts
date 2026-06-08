import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "../src/lib/session.js";

const secret = "test-secret";

describe("session token", () => {
  it("round-trips a player id and handle", () => {
    const token = signSession({ playerId: "p1", handle: "alice" }, secret);
    const claims = verifySession(token, secret);
    expect(claims).toEqual({ playerId: "p1", handle: "alice" });
  });

  it("rejects a tampered token", () => {
    const token = signSession({ playerId: "p1", handle: "alice" }, secret);
    expect(verifySession(token + "x", secret)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSession({ playerId: "p1", handle: "alice" }, secret);
    expect(verifySession(token, "other-secret")).toBeNull();
  });
});
