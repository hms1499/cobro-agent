import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import { getDb } from "@/lib/db/client";
import { loadAppUser, type AppUser } from "@/lib/users/queries";
import { SESSION_COOKIE, verifySession } from "./session";

/** Reads the request's cookies: call it only inside a <Suspense> boundary, a Route Handler or a Server Action. */
export async function getCurrentUser(): Promise<AppUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySession(token, requireValue(parseServerEnv().SESSION_SECRET, "SESSION_SECRET"));
  if (!session) return null;
  return loadAppUser(getDb(), session.userId);
}

export async function requireUser(opts: { allowOnboarding?: boolean } = {}): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (!user.localCurrency && !opts.allowOnboarding) redirect("/app/onboarding");
  return user;
}
