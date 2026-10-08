import { describe, expect, it } from "vitest";
import { SESSION_TTL_SECONDS, sessionCookieOptions, signSession, verifySession } from "./session";

const SECRET = "x".repeat(32);
const NOW = 1_791_000_000;

describe("session tokens", () => {
  it("round-trips the user id", async () => {
    const token = await signSession("user-1", SECRET, NOW);
    expect(await verifySession(token, SECRET, NOW + 60)).toEqual({ userId: "user-1" });
  });

  it("expires after seven days", async () => {
    const token = await signSession("user-1", SECRET, NOW);
    expect(await verifySession(token, SECRET, NOW + SESSION_TTL_SECONDS + 1)).toBeNull();
  });

  it("rejects another secret, a tampered token and garbage", async () => {
    const token = await signSession("user-1", SECRET, NOW);
    expect(await verifySession(token, "y".repeat(32), NOW)).toBeNull();
    const [header, payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "user-2", iss: "cobro", exp: NOW + 100 })).toString("base64url");
    expect(await verifySession(`${header}.${forged}.${signature}`, SECRET, NOW)).toBeNull();
    expect(await verifySession(`${header}.${payload}`, SECRET, NOW)).toBeNull();
    expect(await verifySession("not-a-token", SECRET, NOW)).toBeNull();
  });

  it("sets an HTTP-only, same-site cookie for the whole app", () => {
    expect(sessionCookieOptions()).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL_SECONDS });
  });
});
