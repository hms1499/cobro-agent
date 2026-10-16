import { cookies } from "next/headers";
import { after } from "next/server";
import { isTrustedJsonPost } from "@/lib/auth/csrf";
import { verifyParaJwt } from "@/lib/auth/para-jwt";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { startSession } from "@/lib/auth/start-session";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import { getDb } from "@/lib/db/client";
import { paraRestClient, paraSessionKeys } from "@/lib/users/para";
import { ensureTreasuryWallet, upsertUser } from "@/lib/users/provision";
import { hasFinishedOnboarding } from "@/lib/users/queries";

/** Wallet creation runs in after(): Para creates it, then we poll until ready (up to 30 s). */
export const maxDuration = 60;

/** Exchanges a Para session JWT for our own session cookie and provisions the user. */
export async function POST(request: Request) {
  // Without this, another site could sign a freelancer into the attacker's account (login CSRF).
  if (!isTrustedJsonPost(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const db = getDb();
  const result = await startSession(body, {
    verify: (token) => verifyParaJwt(token, paraSessionKeys()),
    upsertUser: (session) => upsertUser(db, session),
    provisionWallet: (userId) => ensureTreasuryWallet(db, userId, paraRestClient()),
    schedule: (task) => after(task),
    signSession: (userId) => signSession(userId, requireValue(parseServerEnv().SESSION_SECRET, "SESSION_SECRET")),
    hasCurrency: (paraUserId) => hasFinishedOnboarding(db, paraUserId),
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  (await cookies()).set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
  return Response.json({ next: result.next });
}

export async function DELETE() {
  (await cookies()).delete(SESSION_COOKIE);
  return new Response(null, { status: 204 });
}
