import { cookies } from "next/headers";
import { verifyParaJwt, type ParaSession } from "@/lib/auth/para-jwt";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import { getDb } from "@/lib/db/client";
import { paraRestClient, paraSessionKeys } from "@/lib/users/para";
import { ensureTreasuryWallet, upsertUser } from "@/lib/users/provision";
import { loadAppUser } from "@/lib/users/queries";

/** Exchanges a Para session JWT for our own session cookie and provisions the user. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  if (!body || typeof body.token !== "string") return Response.json({ error: "token_required" }, { status: 400 });

  let session: ParaSession;
  try {
    session = await verifyParaJwt(body.token, paraSessionKeys());
  } catch {
    return Response.json({ error: "invalid_session" }, { status: 401 });
  }

  const db = getDb();
  const user = await upsertUser(db, session);
  try {
    await ensureTreasuryWallet(db, user.id, paraRestClient());
  } catch (error) {
    // The session still starts; the home page offers "Finish setup", which retries.
    console.error("Treasury wallet setup failed:", error instanceof Error ? error.message : error);
  }

  const token = await signSession(user.id, requireValue(parseServerEnv().SESSION_SECRET, "SESSION_SECRET"));
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
  const appUser = await loadAppUser(db, user.id);
  return Response.json({ next: appUser?.localCurrency ? "/app" : "/app/onboarding" });
}

export async function DELETE() {
  (await cookies()).delete(SESSION_COOKIE);
  return new Response(null, { status: 204 });
}
